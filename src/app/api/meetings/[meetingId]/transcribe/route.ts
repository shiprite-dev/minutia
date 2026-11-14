import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAiAccess } from "@/lib/ai/access";
import { generateMeetingSuggestions, isExplicitSkip } from "@/lib/ai/suggestions";
import { MEETING_AUDIO_BUCKET } from "@/lib/audio";
import {
  assembleDiarizedTranscript,
  chunkAudioBlob,
  isDiarizingProviderConfigured,
  isTranscriptionConfigured,
  transcribeAudio,
  TranscriptionError,
  type TranscriptionErrorCode,
  type TranscriptionSegment,
} from "@/lib/transcription";
import {
  assembleFastTranscript,
  isTerminalNoSpeech,
  planSegmentResume,
  segmentsCoverExpected,
  type SegmentRow,
} from "@/lib/transcription/fast-lane";
import { assembleChannelTranscript, attributionSource } from "@/lib/transcription/channels";
import { transcribeDualSegment } from "@/lib/transcription/dual";
import { getInstanceConfigMap, InstanceConfigReadError } from "@/lib/instance-config";
import { resolveAudioRetention, shouldDiscardAudio, type ExtractionOutcomeForRetention } from "@/lib/audio/retention";

// Transcription is provider-bound and can run for minutes on a long recording.
export const runtime = "nodejs";
export const maxDuration = 300;

// One absolute deadline for the whole request, shared by every provider
// attempt, retry, and chunk: 270s of work plus a 30s reserve for persistence
// and post-processing. No provider call ever borrows time outside this budget.
const REQUEST_BUDGET_MS = 270_000;

// A 'processing' row older than this is treated as a crashed run and reclaimable.
// Comfortably exceeds maxDuration so a live run is never stolen out from under itself.
const STALE_PROCESSING_MS = 15 * 60 * 1000;

/** A run that started within the staleness window is genuinely still in progress. */
function isFreshRun(startedAt: string | null): boolean {
  if (!startedAt) return true; // processing without a start time: treat as in-progress
  return Date.parse(startedAt) >= Date.now() - STALE_PROCESSING_MS;
}

/** Best-effort content type from the stored object's extension. */
function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "m4a" || ext === "mp4") return "audio/mp4";
  if (ext === "ogg") return "audio/ogg";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  return "audio/webm";
}

/** Map a transcription failure cause to the right HTTP status. */
function statusForCode(code: TranscriptionErrorCode): number {
  switch (code) {
    case "timeout":
      return 504;
    case "rate_limit":
      return 429;
    case "unsupported_format":
      return 415;
    case "no_api_key":
    case "provider_not_configured":
    case "auth_error":
      return 503;
    default:
      return 502;
  }
}

type MeetingTranscriptionOutcome = "speech" | "no_speech" | null;

/**
 * Meeting-level outcome. Speech requires committed text. No-speech requires
 * positive terminal-silence evidence covering the selected input: either every
 * selected segment row is completed with a persisted no_speech outcome, or every
 * provider result that fed the transcript reported no_speech. Empty text alone
 * is never silence, so an unexplained empty transcript stays unknown (null).
 */
function deriveMeetingOutcome(
  transcript: string,
  providerOutcomes: Array<"speech" | "no_speech" | undefined>,
  segmentRows: SegmentRow[] | null
): MeetingTranscriptionOutcome {
  if (transcript.trim() !== "") return "speech";
  if (segmentRows?.length && segmentRows.every(isTerminalNoSpeech)) return "no_speech";
  if (providerOutcomes.length > 0 && providerOutcomes.every((outcome) => outcome === "no_speech")) {
    return "no_speech";
  }
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const requestId = crypto.randomUUID();
  const { meetingId } = await params;

  // The client reports how many segments the fast lane produced. The segment
  // resume path may only run when the persisted rows exactly cover that count,
  // so a tail segment whose row has not registered yet can never truncate the
  // transcript. Legacy callers send {} => expectedSegments null => full file.
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const expectedSegments =
    Number.isInteger(body.expected_segments) && (body.expected_segments as number) >= 1
      ? (body.expected_segments as number)
      : null;

  const aiDenied = await requireAiAccess();
  if (aiDenied) {
    const body = (await aiDenied.json()) as Record<string, unknown>;
    return NextResponse.json({ ...body, request_id: requestId }, { status: aiDenied.status });
  }

  const supabase = await createClient();
  const deadlineAt = Date.now() + REQUEST_BUDGET_MS;

  // RLS scopes this to the caller's owned series, so loading the row both finds
  // the meeting and authorizes access in one query.
  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .select(
      "id, audio_file_path, audio_duration_seconds, transcription_status, transcription_started_at, transcription_outcome, attendees, speaker_map, transcript_raw, transcription_model, transcription_provider"
    )
    .eq("id", meetingId)
    .single();

  if (meetingError || !meeting) {
    return NextResponse.json({ error: "Meeting not found", request_id: requestId }, { status: 404 });
  }

  // Idempotent replay: a completed meeting returns its persisted result without
  // a provider call, re-billing, or touching storage. This must run BEFORE the
  // missing-audio check, or a replay after audio discard looks like an error.
  if (meeting.transcription_status === "completed") {
    return NextResponse.json(
      {
        status: "completed",
        replay: true,
        outcome: meeting.transcription_outcome ?? null,
        transcript_length: (meeting.transcript_raw ?? "").length,
        model: meeting.transcription_model ?? "",
        provider: meeting.transcription_provider ?? "",
        audio_discarded: false,
        request_id: requestId,
      },
      { status: 200 }
    );
  }

  if (!meeting.audio_file_path) {
    return NextResponse.json(
      { error: "No audio recording found for this meeting.", request_id: requestId },
      { status: 400 }
    );
  }

  // Fast idempotency check: a fresh in-progress run blocks regardless of provider
  // config. Stale runs fall through to be reclaimed by the atomic claim below.
  if (meeting.transcription_status === "processing" && isFreshRun(meeting.transcription_started_at)) {
    return NextResponse.json(
      { error: "Transcription is already in progress.", code: "processing_conflict", request_id: requestId },
      { status: 409 }
    );
  }

  // Verify a provider is configured before claiming the row, so a misconfigured
  // instance never leaves a meeting stuck mid-transcription.
  if (!isTranscriptionConfigured()) {
    return NextResponse.json(
      { error: "Transcription is not configured.", code: "TRANSCRIPTION_UNCONFIGURED", request_id: requestId },
      { status: 503 }
    );
  }

  // Atomic claim via RPC: self-host PostgREST ignores or=() on UPDATE.
  const { data: claimed, error: claimError } = await supabase.rpc("claim_meeting_transcription", {
    p_meeting_id: meetingId,
    p_stale_seconds: Math.floor(STALE_PROCESSING_MS / 1000),
  });

  if (claimError) {
    return NextResponse.json(
      { error: "Could not start transcription.", request_id: requestId },
      { status: 500 }
    );
  }
  if (!claimed) {
    return NextResponse.json(
      { error: "Transcription is already in progress.", code: "processing_conflict", request_id: requestId },
      { status: 409 }
    );
  }

  const markFailed = async () => {
    const { error } = await supabase
      .from("meetings")
      .update({ transcription_status: "failed", transcription_started_at: null })
      .eq("id", meetingId);
    // A failed reset would silently strand the row in 'processing' (until the
    // staleness window above reclaims it), so surface it rather than swallow it.
    if (error) {
      console.error("[transcribe] could not mark transcription failed", {
        meetingId,
        requestId,
        error: error.message,
      });
    }
  };

  try {
    const { data: audioData, error: downloadError } = await supabase.storage
      .from(MEETING_AUDIO_BUCKET)
      .download(meeting.audio_file_path);

    if (downloadError || !audioData) {
      await markFailed();
      return NextResponse.json(
        { error: "Could not read the meeting recording.", request_id: requestId },
        { status: 502 }
      );
    }

    const mimeType = audioData.type || mimeFromPath(meeting.audio_file_path);
    const attendees: string[] = meeting.attendees ?? [];

    let transcript = "";
    let model = "";
    let provider = "";
    let durationSeconds: number | null = null;
    let segments: TranscriptionSegment[] | null = null;
    let speakerMap: Record<string, string | null> | null = null;
    let chunkCount = 1;
    let providerOutcomes: Array<"speech" | "no_speech" | undefined> = [];
    let selectedSegmentRows: SegmentRow[] | null = null;

    if (isDiarizingProviderConfigured()) {
      // Diarization needs the whole recording in one pass: splitting it would
      // sever speaker turns across chunk boundaries.
      // If the diarizing primary fails, the OpenRouter fallback receives this same
      // un-chunked blob and may reject very large recordings (best-effort).
      const result = await transcribeAudio(audioData, {
        fileName: `meeting-${meetingId}.webm`,
        mimeType,
        speakersExpected: attendees.length || undefined,
        deadlineAt,
      });
      providerOutcomes = [result.outcome];
      model = result.model;
      provider = result.provider;
      durationSeconds = result.durationSeconds;
      if (result.segments?.length) {
        const assembled = assembleDiarizedTranscript(result.segments, attendees, meeting.speaker_map ?? undefined);
        transcript = assembled.transcriptRaw;
        segments = assembled.segments;
        speakerMap = assembled.speakerMap;
      } else {
        transcript = result.text.trim();
      }
    } else {
      // Resumable final pass: when the fast lane already transcribed segments,
      // reuse the completed texts and only re-transcribe the gaps, so a provider
      // hiccup on one segment never re-runs the whole recording. Falls back to
      // full-file chunking when no segments exist or a gap cannot be recovered.
      const { data: segmentRows, error: segmentsError } = await supabase
        .from("meeting_audio_segments")
        .select(
          "seq, status, transcript_text, storage_path, model, provider, transcription_outcome, them_storage_path, offset_seconds, transcript_segments, recorded_by"
        )
        .eq("meeting_id", meetingId)
        .order("seq", { ascending: true });

      // A query error means we cannot trust the segment view: fall through to the
      // full-file path rather than fail the run.
      const rows: SegmentRow[] = segmentsError ? [] : (segmentRows ?? []);
      const plan = planSegmentResume(rows);
      let resumed = false;

      // Only trust the segment rows when they exactly cover the count the client
      // reported at stop: the tail row must be registered and the seqs must be a
      // contiguous 0..n-1 range. Otherwise use the safe full-file path.
      if (plan.usable && segmentsCoverExpected(rows, expectedSegments)) {
        const recovered: SegmentRow[] = [];
        const missing: number[] = [];
        const nowIso = () => new Date().toISOString();

        for (const row of plan.retry) {
          // Claim the segment before touching it so this final pass never
          // transcribes a seq concurrently with the per-segment route. A held
          // claim (or a claim error) means another worker owns it: treat the
          // seq as a gap and fall back to the full-file path.
          const { data: claimed, error: claimError } = await supabase.rpc("claim_segment_transcription", {
            p_meeting_id: meetingId,
            p_seq: row.seq,
          });
          if (claimError || claimed !== true) {
            missing.push(row.seq);
            continue;
          }

          const { data: segData, error: segDownloadError } = await supabase.storage
            .from(MEETING_AUDIO_BUCKET)
            .download(row.storage_path);
          const themDownload = row.them_storage_path
            ? await supabase.storage.from(MEETING_AUDIO_BUCKET).download(row.them_storage_path)
            : null;

          if (segDownloadError || !segData || (themDownload && (themDownload.error || !themDownload.data))) {
            const { error: failWriteError } = await supabase
              .from("meeting_audio_segments")
              .update({ status: "failed", error_code: "download_failed", updated_at: nowIso() })
              .eq("meeting_id", meetingId)
              .eq("seq", row.seq);
            // A failed failure-state write is a persistence problem, not a
            // recoverable gap: surface it instead of silently re-running work.
            if (failWriteError) {
              await markFailed();
              return NextResponse.json(
                { error: "Transcription could not be recorded.", request_id: requestId },
                { status: 500 }
              );
            }
            missing.push(row.seq);
            continue;
          }

          try {
            let result: { model: string; provider: string; durationSeconds: number | null };
            let text: string;
            let outcome: "speech" | "no_speech" | null;
            let channelSegments: TranscriptionSegment[] | null = null;
            if (row.offset_seconds != null) {
              const dual = await transcribeDualSegment({
                meAudio: segData,
                themAudio: themDownload?.data ?? null,
                offsetSeconds: row.offset_seconds,
                fileName: row.storage_path.split("/").pop() ?? `seg-${row.seq}.m4a`,
                mimeType: segData.type || mimeFromPath(row.storage_path),
                deadlineAt,
              });
              result = dual;
              text = dual.transcriptText;
              outcome = dual.outcome;
              channelSegments = dual.merged;
            } else {
              const single = await transcribeAudio(segData, {
                fileName: `seg-${row.seq}.webm`,
                mimeType: segData.type || "audio/webm",
                deadlineAt,
              });
              result = single;
              text = single.text.trim();
              outcome = single.outcome ?? (text ? "speech" : null);
            }
            const { error: saveError } = await supabase
              .from("meeting_audio_segments")
              .update({
                status: "completed",
                transcript_text: text,
                transcription_outcome: outcome,
                ...(channelSegments ? { transcript_segments: channelSegments } : {}),
                error_code: null,
                size_bytes: segData.size + (themDownload?.data?.size ?? 0),
                updated_at: nowIso(),
              })
              .eq("meeting_id", meetingId)
              .eq("seq", row.seq);
            // A recovered segment only counts once its write is durable;
            // otherwise a DB hiccup would silently drop it from the transcript.
            if (saveError) {
              await markFailed();
              return NextResponse.json(
                { error: "Transcription completed but could not be saved.", request_id: requestId },
                { status: 500 }
              );
            }
            if (!model) {
              model = result.model;
              provider = result.provider;
              durationSeconds = result.durationSeconds;
            }
            const recoveredSegments = channelSegments ? { transcript_segments: channelSegments } : {};
            if (text) {
              recovered.push({ ...row, ...recoveredSegments, status: "completed", transcript_text: text });
            } else if (outcome === "no_speech") {
              // Confirmed silence is terminal: it covers its seq without text
              // and must not be retried forever.
              recovered.push({
                ...row,
                ...recoveredSegments,
                status: "completed",
                transcript_text: "",
                transcription_outcome: "no_speech",
              });
            } else {
              missing.push(row.seq);
            }
          } catch (segError) {
            const code = segError instanceof TranscriptionError ? segError.code : "provider_error";
            const { error: failWriteError } = await supabase
              .from("meeting_audio_segments")
              .update({ status: "failed", error_code: code, updated_at: nowIso() })
              .eq("meeting_id", meetingId)
              .eq("seq", row.seq);
            if (failWriteError) {
              await markFailed();
              return NextResponse.json(
                { error: "Transcription could not be recorded.", request_id: requestId },
                { status: 500 }
              );
            }
            missing.push(row.seq);
          }
        }

        if (missing.length === 0) {
          // Every original segment now carries usable text: stitch the recap from
          // segment texts without re-transcribing the already-completed ones.
          const updatedRows = [...plan.completed, ...recovered];
          selectedSegmentRows = updatedRows;
          if (attributionSource({ diarizingConfigured: false, rows: updatedRows }) === "channels") {
            const recorderId = [...updatedRows].sort((a, b) => a.seq - b.seq)[0]?.recorded_by;
            const { data: recorder } = recorderId
              ? await supabase.from("profiles").select("name").eq("id", recorderId).single()
              : { data: null };
            const assembled = assembleChannelTranscript(updatedRows, recorder?.name ?? null, meeting.speaker_map);
            transcript = assembled.transcriptRaw;
            if (assembled.transcriptDiarized) {
              segments = assembled.segments;
              speakerMap = assembled.speakerMap;
            }
          } else {
            transcript = assembleFastTranscript(updatedRows);
          }
          chunkCount = updatedRows.length;
          resumed = true;

          // When every segment was already completed the retry loop never ran, so
          // model/provider are still blank. Seed them from the first pre-transcribed
          // segment that recorded them so the meeting is not stamped with an empty
          // provider/model on the fast-lane happy path.
          if (!model) {
            const seed = updatedRows.find((r) => r.model);
            if (seed) {
              model = seed.model ?? "";
              provider = seed.provider ?? "";
            }
          }
        } else {
          console.error("[transcribe] segment resume incomplete, falling back to full-file chunking", {
            meetingId,
            requestId,
            missing,
          });
        }
      }

      if (!resumed) {
        const chunks = await chunkAudioBlob(audioData, mimeType);
        chunkCount = chunks.length;

        const texts: string[] = [];
        for (const chunk of chunks) {
          const result = await transcribeAudio(chunk, {
            fileName: `meeting-${meetingId}.webm`,
            mimeType,
            deadlineAt,
          });
          providerOutcomes.push(result.outcome);
          texts.push(result.text.trim());
          if (!model) {
            model = result.model;
            provider = result.provider;
            durationSeconds = result.durationSeconds;
          }
        }
        transcript = texts.filter(Boolean).join("\n\n");
      }
    }

    // A persisted outcome is never overwritten; an unknown one stays unwritten
    // unless this run produced positive evidence.
    const existingOutcome: MeetingTranscriptionOutcome = meeting.transcription_outcome ?? null;
    const derivedOutcome = deriveMeetingOutcome(transcript, providerOutcomes, selectedSegmentRows);
    const effectiveOutcome = existingOutcome ?? derivedOutcome;

    const { error: updateError } = await supabase
      .from("meetings")
      .update({
        transcript_raw: transcript,
        transcription_status: "completed",
        transcription_model: model,
        transcription_provider: provider,
        transcription_completed_at: new Date().toISOString(),
        transcript_segments: segments,
        transcript_diarized: !!segments,
        speaker_map: speakerMap,
        // Backfill duration from the provider only if the upload did not record it.
        ...(meeting.audio_duration_seconds == null && durationSeconds != null
          ? { audio_duration_seconds: Math.round(durationSeconds) }
          : {}),
        ...(existingOutcome == null && derivedOutcome != null
          ? { transcription_outcome: derivedOutcome }
          : {}),
      })
      .eq("id", meetingId);

    if (updateError) {
      await markFailed();
      return NextResponse.json(
        { error: "Transcription completed but could not be saved.", request_id: requestId },
        { status: 500 }
      );
    }

    // MIN-121: now that a transcript exists, run context-aware extraction so the
    // facilitator finds suggestions waiting (deduped against the OIL, with
    // resolutions and duplicates flagged). Extraction completed or being
    // explicitly skipped (no AI configured, nothing to extract) gates audio
    // cleanup; a failed extraction retains the audio for a later retry via the
    // suggestions endpoint. The transcript itself stays committed either way.
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
      // Config read failures land here: never confuse "cannot read config"
      // with an explicit skip. The transcript stays; audio is retained.
      extractionError = suggestionError instanceof Error ? suggestionError.message : String(suggestionError);
    }

    if (extraction === "failed") {
      console.error("[transcribe] context-aware suggestion extraction failed", {
        meetingId,
        requestId,
        error: extractionError,
      });
      return NextResponse.json(
        {
          error: "Transcription completed but suggestion extraction failed.",
          code: "extraction_failed",
          transcription_status: "completed",
          outcome: effectiveOutcome,
          transcript_length: transcript.length,
          audio_discarded: false,
          request_id: requestId,
        },
        { status: 500 }
      );
    }

    // Audio retention: discard the raw recording only when the instance policy
    // says so AND the transcript is durably saved AND extraction finished (or
    // was explicitly skipped). Best-effort per-operation verification: every
    // phase must succeed before audio_discarded is reported true.
    let audioDiscarded = false;
    try {
      const configMap = await getInstanceConfigMap(["audio_retention"]);
      const retention = resolveAudioRetention(configMap.audio_retention ?? null);
      if (shouldDiscardAudio(retention, "completed", extraction)) {
        // Enumerate every page of the meeting's folder before deleting so a
        // paginated listing cannot leave objects behind.
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
          const { error: removeError } = await supabase.storage.from(MEETING_AUDIO_BUCKET).remove(paths);
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
        // Verified completion: every deletion and pointer clear succeeded.
        audioDiscarded = true;
      }
    } catch (retentionError) {
      // A failed config read (InstanceConfigReadError) or any failed deletion
      // phase postpones cleanup: never report discarded, never clear pointers
      // on a partial delete. A later successful retry completes it idempotently.
      audioDiscarded = false;
      const failedRead = retentionError instanceof InstanceConfigReadError;
      console.error("[transcribe] retention discard failed", {
        meetingId,
        requestId,
        reason: failedRead ? "config_unavailable" : "cleanup_error",
        error: retentionError instanceof Error ? retentionError.message : String(retentionError),
      });
    }

    return NextResponse.json({
      status: "completed",
      outcome: effectiveOutcome,
      transcript_length: transcript.length,
      chunks: chunkCount,
      model,
      provider,
      audio_discarded: audioDiscarded,
      request_id: requestId,
    });
  } catch (error) {
    await markFailed();
    if (error instanceof TranscriptionError) {
      return NextResponse.json(
        { error: "Transcription failed.", code: error.code, request_id: requestId },
        { status: statusForCode(error.code) }
      );
    }
    return NextResponse.json(
      { error: "Transcription failed.", request_id: requestId },
      { status: 500 }
    );
  }
}
