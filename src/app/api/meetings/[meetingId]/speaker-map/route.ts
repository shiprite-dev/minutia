import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAiAccess } from "@/lib/ai/access";
import { hasAiConfigured } from "@/lib/ai/config";
import { generateMeetingSuggestions } from "@/lib/ai/suggestions";
import { userManagesSeries } from "@/lib/series/manage-access";
import { flattenSegments } from "@/lib/transcription";

const requestSchema = z.object({
  speaker: z.string().min(1).max(100),
  attendee: z.string().max(200).nullable(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const requestId = crypto.randomUUID();
  const { meetingId } = await params;

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body", request_id: requestId }, { status: 400 });
  }
  const attendee = body.attendee?.trim() || null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS-scoped: finds the meeting and (with the manage check below) authorizes
  // the correction in one query, mirroring the suggestions route.
  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .select("series_id, transcript_segments, speaker_map")
    .eq("id", meetingId)
    .single();
  if (meetingError || !meeting) {
    return NextResponse.json({ error: "Meeting not found", request_id: requestId }, { status: 404 });
  }

  // Correcting attribution rewrites transcript_raw, so restrict it to those who
  // manage the series (mirrors the suggestions route's generate gate). The
  // separate AI re-extraction below has its own entitlement gate.
  if (!user || !(await userManagesSeries(meeting.series_id, user.id))) {
    return NextResponse.json(
      { error: "Only series owners and facilitators can correct speakers.", request_id: requestId },
      { status: 403 }
    );
  }

  if (!meeting.transcript_segments?.length) {
    return NextResponse.json(
      { error: "This meeting has no diarized transcript to correct.", request_id: requestId },
      { status: 400 }
    );
  }

  const speakerMap = { ...(meeting.speaker_map ?? {}), [body.speaker]: attendee };
  const transcriptRaw = flattenSegments(meeting.transcript_segments, speakerMap);

  const { error: updateError } = await supabase
    .from("meetings")
    .update({ speaker_map: speakerMap, transcript_raw: transcriptRaw })
    .eq("id", meetingId);
  if (updateError) {
    return NextResponse.json(
      { error: "Could not save the speaker correction.", request_id: requestId },
      { status: 500 }
    );
  }

  // MIN-121 extraction is keyed off transcript_raw, so a speaker correction can
  // change owners/details it picked up. Gated on AI access: the correction above
  // already ran for any manager, this is only the best-effort re-extraction, so a
  // denied or unconfigured instance silently skips it rather than failing the PATCH
  // (mirrors the transcribe route).
  const aiDenied = await requireAiAccess();
  if (!aiDenied && (await hasAiConfigured())) {
    try {
      await generateMeetingSuggestions(supabase, meetingId);
    } catch (suggestionError) {
      console.error("[speaker-map] context-aware suggestion extraction failed", {
        meetingId,
        requestId,
        error: suggestionError instanceof Error ? suggestionError.message : String(suggestionError),
      });
    }
  }

  return NextResponse.json({ speaker_map: speakerMap, transcript_raw: transcriptRaw, request_id: requestId });
}
