import { createClient } from "@/lib/supabase/client";

export async function requestCompanionRecord(meetingId: string) {
  const { error } = await createClient().rpc("request_companion_record", {
    p_meeting_id: meetingId,
  });
  return !error;
}

export async function recordInBrowser(meetingId: string) {
  const { error } = await createClient().rpc("record_in_browser", {
    p_meeting_id: meetingId,
  });
  return !error;
}
