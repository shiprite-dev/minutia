import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncCalendarAgendaForUser } from "@/lib/google-calendar-agenda-service";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .single<{ current_organization_id: string | null }>();

  if (profileError || !profile?.current_organization_id) {
    return NextResponse.json({ error: "Workspace required" }, { status: 409 });
  }

  try {
    const agenda = await syncCalendarAgendaForUser({
      userId: user.id,
      organizationId: profile.current_organization_id,
      selfEmail: user.email,
    });
    return NextResponse.json(agenda);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Calendar agenda failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
