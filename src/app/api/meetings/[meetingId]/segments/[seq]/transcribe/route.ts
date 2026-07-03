import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAiAccess } from "@/lib/ai/access";
import { MEETING_AUDIO_BUCKET } from "@/lib/audio";
import { segmentStoragePath } from "@/lib/audio/segments";
import {
  isTranscriptionConfigured,
  transcribeAudio,
  TranscriptionError,
  type TranscriptionErrorCode,
} from "@/lib/transcription";

// A single segment is short, but the provider round trip is still network-bound.
export const runtime = "nodejs";
export const maxDuration = 120;

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
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string; seq: string }> }
) {
  const requestId = crypto.randomUUID();
  const { meetingId, seq: seqRaw } = await params;

  const seq = Number(seqRaw);
  if (!Number.isInteger(seq) || seq < 0 || seq > 10000) {
    return NextResponse.json({ error: "Invalid segment.", request_id: requestId }, { status: 400 });
  }

  const aiDenied = await requireAiAccess();
  if (aiDenied) {
    const body = (await aiDenied.json()) as Record<string, unknown>;
    return NextResponse.json({ ...body, request_id: requestId }, { status: aiDenied.status });
  }

  let path: unknown;
  try {
    ({ path } = (await request.json()) as { path?: unknown });
  } catch {
    path = undefined;
  }
  if (path !== segmentStoragePath(meetingId, seq)) {
    return NextResponse.json({ error: "Invalid segment path.", request_id: requestId }, { status: 400 });
  }

  const supabase = await createClient();

  // RLS scopes this to the caller's accessible series, so loading the row both
  // finds the meeting and authorizes access in one query.
  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .select("id")
    .eq("id", meetingId)
    .single();

  if (meetingError || !meeting) {
    return NextResponse.json({ error: "Meeting not found.", request_id: requestId }, { status: 404 });
  }

  if (!isTranscriptionConfigured()) {
    return NextResponse.json(
      { error: "Transcription is not configured.", code: "TRANSCRIPTION_UNCONFIGURED", request_id: requestId },
      { status: 503 }
    );
  }

  // Register the segment row idempotently before claiming it. A concurrent
  // retry of the same seq is a no-op insert; the claim below decides who runs.
  const { error: upsertError } = await supabase
    .from("meeting_audio_segments")
    .upsert(
      { meeting_id: meetingId, seq, storage_path: path },
      { onConflict: "meeting_id,seq", ignoreDuplicates: true }
    );

  if (upsertError) {
    return NextResponse.json(
      { error: "Could not register the segment.", request_id: requestId },
      { status: 500 }
    );
  }

  // Atomic claim via RPC: self-host PostgREST ignores or=() on UPDATE.
  const { data: claimed, error: claimError } = await supabase.rpc("claim_segment_transcription", {
    p_meeting_id: meetingId,
    p_seq: seq,
  });

  if (claimError) {
    return NextResponse.json(
      { error: "Could not start segment transcription.", request_id: requestId },
      { status: 500 }
    );
  }
  if (claimed !== true) {
    return NextResponse.json(
      { error: "Segment transcription is already in progress.", request_id: requestId },
      { status: 409 }
    );
  }

  const markFailed = async (errorCode: string) => {
    const { error } = await supabase
      .from("meeting_audio_segments")
      .update({ status: "failed", error_code: errorCode, updated_at: new Date().toISOString() })
      .eq("meeting_id", meetingId)
      .eq("seq", seq);
    if (error) {
      console.error("[segment-transcribe] could not mark segment failed", {
        meetingId,
        seq,
        requestId,
        error: error.message,
      });
    }
  };

  try {
    const { data: audioData, error: downloadError } = await supabase.storage
      .from(MEETING_AUDIO_BUCKET)
      .download(path);

    if (downloadError || !audioData) {
      await markFailed("download_failed");
      return NextResponse.json(
        { error: "Could not read the segment audio.", request_id: requestId },
        { status: 502 }
      );
    }

    const result = await transcribeAudio(audioData, {
      fileName: `seg-${seq}.webm`,
      mimeType: audioData.type || "audio/webm",
      preferFast: true,
    });
    const transcript = result.text.trim();

    const { error: updateError } = await supabase
      .from("meeting_audio_segments")
      .update({
        status: "completed",
        transcript_text: transcript,
        model: result.model,
        provider: result.provider,
        error_code: null,
        size_bytes: audioData.size,
        updated_at: new Date().toISOString(),
      })
      .eq("meeting_id", meetingId)
      .eq("seq", seq);

    if (updateError) {
      await markFailed("save_failed");
      return NextResponse.json(
        { error: "Segment transcribed but could not be saved.", request_id: requestId },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: "completed",
      seq,
      transcript_length: transcript.length,
      provider: result.provider,
      model: result.model,
      request_id: requestId,
    });
  } catch (error) {
    if (error instanceof TranscriptionError) {
      await markFailed(error.code);
      return NextResponse.json(
        { error: "Segment transcription failed.", code: error.code, request_id: requestId },
        { status: statusForCode(error.code) }
      );
    }
    await markFailed("provider_error");
    return NextResponse.json(
      { error: "Segment transcription failed.", request_id: requestId },
      { status: 500 }
    );
  }
}
