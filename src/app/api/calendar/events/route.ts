import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken, listUpcomingEvents } from "@/lib/google-calendar";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const seriesId = request.nextUrl.searchParams.get("seriesId");
  if (!seriesId) {
    return NextResponse.json({ error: "seriesId required" }, { status: 400 });
  }

  const { data: series } = await supabase
    .from("meeting_series")
    .select("gcal_calendar_id, gcal_sync_enabled, name")
    .eq("id", seriesId)
    .eq("owner_id", user.id)
    .single();

  if (!series?.gcal_calendar_id || !series.gcal_sync_enabled) {
    return NextResponse.json([]);
  }

  try {
    const token = await getValidAccessToken(user.id);
    const events = await listUpcomingEvents(token, series.gcal_calendar_id, 5, series.name);
    return NextResponse.json(events);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
