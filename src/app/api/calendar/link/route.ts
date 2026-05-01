import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { seriesId, calendarId } = await request.json();
  if (!seriesId || !calendarId) {
    return NextResponse.json({ error: "seriesId and calendarId required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("meeting_series")
    .update({ gcal_calendar_id: calendarId, gcal_sync_enabled: true })
    .eq("id", seriesId)
    .eq("owner_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
