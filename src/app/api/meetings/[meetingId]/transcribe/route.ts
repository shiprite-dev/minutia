import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAiAccess } from "@/lib/ai/access";
import { hasAiConfigured } from "@/lib/ai/config";
import { generateMeetingSuggestions } from "@/lib/ai/suggestions";
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
import { assembleFastTranscript, planSegmentResume, type SegmentRow } from "@/lib/transcription/fast-lane";

// Transcription is provider-bound and can run for minutes on a long recording.
export const runtime = "nodejs";
export const maxDuration = 300;

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
      return 503;
    default:
      return 502;
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const requestId = crypto.randomUUID();
  const { meetingId } = await params;

  const aiDenied = await requireAiAccess();
  if (aiDenied) {
    const body = (await aiDenied.json()) as Record<string, unknown>;
    return NextResponse.json({ ...body, request_id: requestId }, { status: aiDenied.status });
  }

  const supabase = await createClient();

  // RLS scopes this to the caller's owned series, so loading the row both finds
  // the meeting and authorizes access in one query.
  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .select(
      "id, audio_file_path, audio_duration_seconds, transcription_status, transcription_started_at, attendees, speaker_map"
    )
    .eq("id", meetingId)
    .single();

  if (meetingError || !meeting) {
    return NextResponse.json({ error: "Meeting not found", request_id: requestId }, { status: 404 });
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
      { error: "Transcription is already in progress.", request_id: requestId },
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
      { error: "Transcription is already in progress.", request_id: requestId },
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

    if (isDiarizingProviderConfigured()) {
      // Diarization needs the whole recording in one pass: splitting it would
      // sever speaker turns across chunk boundaries.
      // If the diarizing primary fails, the OpenRouter fallback receives this same
      // un-chunked blob and may reject very large recordings (best-effort).
      const result = await transcribeAudio(audioData, {
        fileName: `meeting-${meetingId}.webm`,
        mimeType,
        speakersExpected: attendees.length || undefined,
      });
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
        .select("seq, status, transcript_text, storage_path")
        .eq("meeting_id", meetingId)
        .order("seq", { ascending: true });

      // A query error means we cannot trust the segment view: fall through to the
      // full-file path rather than fail the run.
      const rows: SegmentRow[] = segmentsError ? [] : (segmentRows ?? []);
      const plan = planSegmentResume(rows);
      let resumed = false;

      if (plan.usable) {
        const recovered: SegmentRow[] = [];
        const missing: number[] = [];
        const nowIso = () => new Date().toISOString();

        for (const row of plan.retry) {
          const { data: segData, error: segDownloadError } = await supabase.storage
            .from(MEETING_AUDIO_BUCKET)
            .download(row.storage_path);

          if (segDownloadError || !segData) {
            await supabase
              .from("meeting_audio_segments")
              .update({ status: "failed", error_code: "download_failed", updated_at: nowIso() })
              .eq("meeting_id", meetingId)
              .eq("seq", row.seq);
            missing.push(row.seq);
            continue;
          }

          try {
            const result = await transcribeAudio(segData, {
              fileName: `seg-${row.seq}.webm`,
              mimeType: segData.type || "audio/webm",
            });
            const text = result.text.trim();
            await supabase
              .from("meeting_audio_segments")
              .update({
                status: "completed",
                transcript_text: text,
                error_code: null,
                size_bytes: segData.size,
                updated_at: nowIso(),
              })
              .eq("meeting_id", meetingId)
              .eq("seq", row.seq);
            if (!model) {
              model = result.model;
              provider = result.provider;
              durationSeconds = result.durationSeconds;
            }
            if (text) {
              recovered.push({ ...row, status: "completed", transcript_text: text });
            } else {
              missing.push(row.seq);
            }
          } catch (segError) {
            const code = segError instanceof TranscriptionError ? segError.code : "provider_error";
            await supabase
              .from("meeting_audio_segments")
              .update({ status: "failed", error_code: code, updated_at: nowIso() })
              .eq("meeting_id", meetingId)
              .eq("seq", row.seq);
            missing.push(row.seq);
          }
        }

        if (missing.length === 0) {
          // Every original segment now carries usable text: stitch the recap from
          // segment texts without re-transcribing the already-completed ones.
          const updatedRows = [...plan.completed, ...recovered];
          transcript = assembleFastTranscript(updatedRows);
          chunkCount = updatedRows.length;
          resumed = true;
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
          const result = await transcribeAudio(chunk, { fileName: `meeting-${meetingId}.webm`, mimeType });
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
    // resolutions and duplicates flagged). Best-effort: the transcript is
    // already saved, so a failure here must not fail the transcription.
    if (await hasAiConfigured()) {
      try {
        await generateMeetingSuggestions(supabase, meetingId);
      } catch (suggestionError) {
        console.error("[transcribe] context-aware suggestion extraction failed", {
          meetingId,
          requestId,
          error:
            suggestionError instanceof Error ? suggestionError.message : String(suggestionError),
        });
      }
    }

    return NextResponse.json({
      status: "completed",
      transcript_length: transcript.length,
      chunks: chunkCount,
      model,
      provider,
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
