import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateMeetingSuggestions,
  isExplicitSkip,
} from "@/lib/ai/suggestions";
import { MEETING_AUDIO_BUCKET } from "@/lib/audio";
import {
  getInstanceConfigMap,
  InstanceConfigReadError,
} from "@/lib/instance-config";
import {
  resolveAudioRetention,
  shouldDiscardAudio,
  type ExtractionOutcomeForRetention,
} from "@/lib/audio/retention";

export async function extractSuggestions(
  supabase: SupabaseClient,
  meetingId: string,
) {
  let extraction: ExtractionOutcomeForRetention = "failed";
  let extractionError: string | null = null;
  try {
    const outcome = await generateMeetingSuggestions(supabase, meetingId);
    if (outcome.ok) {
      extraction = "completed";
    } else if (isExplicitSkip(outcome)) {
      extraction = "skipped";
    } else {
      extractionError = outcome.error;
    }
  } catch (suggestionError) {
    extractionError =
      suggestionError instanceof Error
        ? suggestionError.message
        : String(suggestionError);
  }
  return { extraction, extractionError };
}

/** Discards the raw recording only when policy says so, the transcript is saved and extraction finished or was skipped. Returns true only after every deletion and pointer clear succeeded. */
export async function retainAudio(
  supabase: SupabaseClient,
  meetingId: string,
  requestId: string,
  extraction: ExtractionOutcomeForRetention,
) {
  let audioDiscarded = false;
  try {
    const configMap = await getInstanceConfigMap(["audio_retention"]);
    const retention = resolveAudioRetention(configMap.audio_retention ?? null);
    if (shouldDiscardAudio(retention, "completed", extraction)) {
      const paths: string[] = [];
      const PAGE_SIZE = 100;
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data: objects, error: listError } = await supabase.storage
          .from(MEETING_AUDIO_BUCKET)
          .list(meetingId, { limit: PAGE_SIZE, offset });
        if (listError) throw listError;
        const page = objects ?? [];
        paths.push(...page.map((o) => `${meetingId}/${o.name}`));
        if (page.length < PAGE_SIZE) break;
      }
      if (paths.length) {
        const { error: removeError } = await supabase.storage
          .from(MEETING_AUDIO_BUCKET)
          .remove(paths);
        if (removeError) throw removeError;
      }
      const { error: meetingNullError } = await supabase
        .from("meetings")
        .update({ audio_file_path: null, audio_file_size_bytes: null })
        .eq("id", meetingId);
      if (meetingNullError) throw meetingNullError;
      const { error: segmentsDeleteError } = await supabase
        .from("meeting_audio_segments")
        .delete()
        .eq("meeting_id", meetingId);
      if (segmentsDeleteError) throw segmentsDeleteError;
      audioDiscarded = true;
    }
  } catch (retentionError) {
    audioDiscarded = false;
    console.error("[transcribe] retention discard failed", {
      meetingId,
      requestId,
      reason:
        retentionError instanceof InstanceConfigReadError
          ? "config_unavailable"
          : "cleanup_error",
      error:
        retentionError instanceof Error
          ? retentionError.message
          : String(retentionError),
    });
  }
  return audioDiscarded;
}
