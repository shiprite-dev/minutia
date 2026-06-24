import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAiAccess } from "@/lib/ai/access";
import { MEETING_AUDIO_BUCKET } from "@/lib/audio";
import {
  chunkAudioBlob,
  isTranscriptionConfigured,
  transcribeAudio,
  TranscriptionError,
  type TranscriptionErrorCode,
} from "@/lib/transcription";

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
    .select("id, audio_file_path, audio_duration_seconds, transcription_status, transcription_started_at")
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

  // Atomically claim the meeting: flip to 'processing' only if it is not already
  // being processed, or if a prior run is stale (crashed without resetting).
  // This makes concurrent POSTs idempotent without a read-then-write race.
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("meetings")
    .update({ transcription_status: "processing", transcription_started_at: new Date().toISOString() })
    .eq("id", meetingId)
    .or(
      `transcription_status.neq.processing,transcription_status.is.null,transcription_started_at.lt.${staleBefore}`
    )
    .select("id")
    .maybeSingle();

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
    const chunks = await chunkAudioBlob(audioData, mimeType);

    // All-or-nothing: a provider failure on any chunk fails the whole run (the
    // catch below marks it 'failed'). Acceptable for v1; revisit with per-chunk
    // retry or partial-save if failures on long, multi-chunk meetings show up.
    const texts: string[] = [];
    let model = "";
    let provider = "";
    let durationSeconds: number | null = null;
    for (const chunk of chunks) {
      const result = await transcribeAudio(chunk, { fileName: `meeting-${meetingId}.webm`, mimeType });
      texts.push(result.text.trim());
      if (!model) {
        model = result.model;
        provider = result.provider;
        durationSeconds = result.durationSeconds;
      }
    }

    const transcript = texts.filter(Boolean).join("\n\n");

    const { error: updateError } = await supabase
      .from("meetings")
      .update({
        transcript_raw: transcript,
        transcription_status: "completed",
        transcription_model: model,
        transcription_provider: provider,
        transcription_completed_at: new Date().toISOString(),
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

    return NextResponse.json({
      status: "completed",
      transcript_length: transcript.length,
      chunks: chunks.length,
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
