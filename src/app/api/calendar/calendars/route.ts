import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken, listCalendars } from "@/lib/google-calendar";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const token = await getValidAccessToken(user.id);
    const calendars = await listCalendars(token);
    return NextResponse.json(calendars);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
