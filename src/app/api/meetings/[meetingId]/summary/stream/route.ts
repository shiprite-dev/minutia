import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAiAccess } from "@/lib/ai/access";
import { hasAiConfigured } from "@/lib/ai/config";
import { streamAi } from "@/lib/ai/stream";
import { paceWords } from "@/lib/ai/word-pacer";
import { SUMMARY_SYSTEM_PROMPT, buildSummaryPrompt } from "@/lib/summary/prompt";
import { formatSseFrame, SSE_DONE, SSE_HEARTBEAT } from "@/lib/summary/sse";
import { assembleFastTranscript } from "@/lib/transcription/fast-lane";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const { meetingId } = await params;

  const aiDenied = await requireAiAccess();
  if (aiDenied) return aiDenied;

  if (!(await hasAiConfigured())) {
    return NextResponse.json({ error: "AI recap is not configured." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: meeting, error } = await supabase
    .from("meetings")
    .select(
      "title, attendees, notes_markdown, raw_notes_markdown, transcript_raw, series:meeting_series!inner(name)"
    )
    .eq("id", meetingId)
    .single();

  if (error || !meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  let transcript =
    meeting.transcript_raw?.trim() ||
    meeting.raw_notes_markdown?.trim() ||
    meeting.notes_markdown?.trim() ||
    "";

  if (!transcript) {
    const { data: segmentRows } = await supabase
      .from("meeting_audio_segments")
      .select("seq, status, transcript_text, storage_path")
      .eq("meeting_id", meetingId)
      .order("seq", { ascending: true });
    transcript = assembleFastTranscript(segmentRows ?? []);
  }

  if (!transcript) {
    return NextResponse.json(
      { error: "Add notes or a transcript before generating a recap." },
      { status: 400 }
    );
  }

  const prompt = buildSummaryPrompt({
    title: meeting.title,
    seriesName: (meeting.series as unknown as { name: string } | null)?.name ?? "Untitled series",
    attendees: meeting.attendees ?? [],
    transcript,
  });

  const encoder = new TextEncoder();
  const upstream = new AbortController();
  request.signal.addEventListener("abort", () => upstream.abort());

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(SSE_HEARTBEAT));
      try {
        const deltas = streamAi({
          system: SUMMARY_SYSTEM_PROMPT,
          prompt,
          signal: upstream.signal,
          reasoningEffort: "minimal",
        });
        for await (const word of paceWords(deltas)) {
          controller.enqueue(encoder.encode(formatSseFrame(word)));
        }
      } catch {
        // Emit whatever was produced, then settle; the client renders partial text.
      } finally {
        controller.enqueue(encoder.encode(SSE_DONE));
        controller.close();
      }
    },
    cancel() {
      upstream.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
