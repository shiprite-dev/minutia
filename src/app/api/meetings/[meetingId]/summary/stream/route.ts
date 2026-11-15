import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAiAccess } from "@/lib/ai/access";
import { getAiConfig } from "@/lib/ai/config";
import { streamAi } from "@/lib/ai/stream";
import { paceWords } from "@/lib/ai/word-pacer";
import { SUMMARY_SYSTEM_PROMPT, buildSummaryPrompt } from "@/lib/summary/prompt";
import {
  formatSseFrame,
  formatSseMeta,
  SSE_DONE,
  SSE_ERROR,
  SSE_HEARTBEAT,
} from "@/lib/summary/sse";
import { userManagesSeries } from "@/lib/series/manage-access";
import { composeMeetingNotes } from "@/lib/ai/companion-notes";
import { pipeRecap } from "@/lib/summary/recap";
import { assembleFastTranscript } from "@/lib/transcription/fast-lane";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const { meetingId } = await params;

  const aiDenied = await requireAiAccess();
  if (aiDenied) return aiDenied;

  const aiConfig = await getAiConfig();
  if (!aiConfig) {
    return NextResponse.json({ error: "AI recap is not configured." }, { status: 503 });
  }
  const model = aiConfig.model;

  const supabase = await createClient();
  const { data: meeting, error } = await supabase
    .from("meetings")
    .select(
      "series_id, title, attendees, notes_markdown, raw_notes_markdown, companion_notes_markdown, transcript_raw, series:meeting_series!inner(name)"
    )
    .eq("id", meetingId)
    .single();

  if (error || !meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await userManagesSeries(meeting.series_id, user.id))) {
    return NextResponse.json(
      { error: "Only series owners and facilitators can write the recap." },
      { status: 403 }
    );
  }

  let transcript = meeting.transcript_raw?.trim() || composeMeetingNotes(meeting).trim();

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

  const regenerate = new URL(request.url).searchParams.get("regenerate") === "1";
  const encoder = new TextEncoder();
  const upstream = new AbortController();
  request.signal.addEventListener("abort", () => upstream.abort());

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(SSE_HEARTBEAT));
      controller.enqueue(encoder.encode(formatSseMeta(model)));
      try {
        const produced = await pipeRecap({
          words: paceWords(
            streamAi({
              system: SUMMARY_SYSTEM_PROMPT,
              prompt,
              signal: upstream.signal,
              reasoningEffort: "minimal",
            })
          ),
          emit: (word) => controller.enqueue(encoder.encode(formatSseFrame(word))),
          signal: upstream.signal,
          model,
          persist: async (row) => {
            const update = supabase.from("meetings").update(row).eq("id", meetingId);
            const { error } = await (regenerate ? update : update.is("recap_markdown", null));
            if (error) console.error(`Recap write failed for meeting ${meetingId}: ${error.message}`);
          },
        });
        if (!produced && !upstream.signal.aborted) controller.enqueue(encoder.encode(SSE_ERROR));
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
      "x-summary-model": model,
    },
  });
}
