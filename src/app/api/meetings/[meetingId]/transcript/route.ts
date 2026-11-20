import { NextResponse, after, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasAiAccess } from "@/lib/ai/access";
import { markSuggestionsPending, recordNotOnPlan } from "@/lib/ai/suggestions-status";
import {
  extractSuggestions,
  retainAudio,
} from "@/lib/transcription/after-transcript";
import {
  assembleDeviceTranscript,
  DEVICE_TRANSCRIPT_MAX_BYTES,
  parseDeviceTranscript,
} from "@/lib/transcription/device";

export const runtime = "nodejs";

const STALE_PROCESSING_SECONDS = 15 * 60;
const MEETING_COLUMNS =
  "id, audio_duration_seconds, transcription_status, transcription_outcome, transcription_provider, transcription_model, transcript_raw, speaker_map";

type MeetingReplay = {
  transcription_outcome: string | null;
  transcription_provider: string | null;
  transcription_model: string | null;
  transcript_raw: string | null;
};

const replay = (m: MeetingReplay) => ({
  status: "completed",
  replay: true,
  outcome: m.transcription_outcome ?? null,
  transcript_length: (m.transcript_raw ?? "").length,
  model: m.transcription_model ?? "",
  provider: m.transcription_provider ?? "",
  audio_discarded: false,
});

async function readCapped(
  body: ReadableStream<Uint8Array> | null,
): Promise<string | null> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > DEVICE_TRANSCRIPT_MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  const requestId = crypto.randomUUID();
  const { meetingId } = await params;
  const respond = (body: Record<string, unknown>, status = 200) =>
    NextResponse.json({ ...body, request_id: requestId }, { status });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return respond({ error: "Not authenticated" }, 401);

  const tooLarge = () =>
    respond(
      { error: "Transcript is too large.", code: "payload_too_large" },
      413,
    );
  if (
    Number(request.headers.get("content-length")) > DEVICE_TRANSCRIPT_MAX_BYTES
  )
    return tooLarge();
  const raw = await readCapped(request.body);
  if (raw === null) return tooLarge();

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return respond(
      { error: "Invalid body.", code: "invalid_body", fields: ["body"] },
      400,
    );
  }
  const parsed = parseDeviceTranscript(json);
  if (!parsed.ok) {
    return respond(
      { error: "Invalid body.", code: "invalid_body", fields: parsed.fields },
      400,
    );
  }

  const { data: meeting } = await supabase
    .from("meetings")
    .select(MEETING_COLUMNS)
    .eq("id", meetingId)
    .single();
  if (!meeting) return respond({ error: "Meeting not found" }, 404);

  if (meeting.transcription_status === "completed")
    return respond(replay(meeting));

  const { data: profile } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .single();

  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_meeting_transcription",
    {
      p_meeting_id: meetingId,
      p_stale_seconds: STALE_PROCESSING_SECONDS,
    },
  );
  if (claimError)
    return respond({ error: "Could not save the transcript." }, 500);
  if (!claimed) {
    const { data: current } = await supabase
      .from("meetings")
      .select(MEETING_COLUMNS)
      .eq("id", meetingId)
      .single();
    if (current?.transcription_status === "completed")
      return respond(replay(current));
    return respond(
      {
        error: "Transcription is already in progress.",
        code: "processing_conflict",
      },
      409,
    );
  }

  const { value } = parsed;
  const assembled = assembleDeviceTranscript(value, {
    recorderName: profile?.name ?? null,
    priorSpeakerMap: meeting.speaker_map ?? null,
  });

  const { error: updateError } = await supabase
    .from("meetings")
    .update({
      transcript_raw: assembled.transcriptRaw,
      transcript_segments: assembled.segments,
      transcript_diarized: true,
      speaker_map: assembled.speakerMap,
      transcription_status: "completed",
      transcription_error_code: null,
      transcription_outcome: assembled.outcome,
      transcription_provider: "device",
      transcription_model: value.source.model,
      transcription_completed_at: new Date().toISOString(),
      transcript_language: value.language,
      transcription_source: value.source,
      ...(meeting.audio_duration_seconds == null
        ? { audio_duration_seconds: Math.round(value.duration_seconds) }
        : {}),
    })
    .eq("id", meetingId);

  if (updateError) {
    const { error } = await supabase
      .from("meetings")
      .update({
        transcription_status: "failed",
        transcription_started_at: null,
        transcription_error_code: null,
      })
      .eq("id", meetingId);
    if (error)
      console.error("[transcript] could not mark transcription failed", {
        meetingId,
        requestId,
      });
    return respond({ error: "Transcript could not be saved." }, 500);
  }

  const aiAllowed = await hasAiAccess();
  if (aiAllowed) await markSuggestionsPending(meetingId);
  else await recordNotOnPlan(meetingId);

  after(async () => {
    const extraction = aiAllowed
      ? await extractSuggestions(supabase, meetingId)
      : { extraction: "skipped" as const, extractionError: null };
    if (extraction.extraction === "failed") {
      console.error("[transcript] suggestion extraction failed", {
        meetingId,
        requestId,
        error: extraction.extractionError,
      });
      return;
    }
    await retainAudio(supabase, meetingId, requestId, extraction.extraction);
  });

  return respond({
    status: "completed",
    deferred: true,
    outcome: assembled.outcome,
    transcript_length: assembled.transcriptRaw.length,
    segments: assembled.segments.length,
    model: value.source.model,
    provider: "device",
    audio_discarded: false,
  });
}
