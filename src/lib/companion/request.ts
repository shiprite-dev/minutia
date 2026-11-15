import { createClient } from "@/lib/supabase/client";

export async function requestCompanionRecord(meetingId: string) {
  try {
    await createClient().rpc("request_companion_record", {
      p_meeting_id: meetingId,
    });
  } catch {}
}

export async function recordInBrowser(meetingId: string) {
  try {
    await createClient().rpc("record_in_browser", { p_meeting_id: meetingId });
  } catch {}
}
