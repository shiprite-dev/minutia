import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getInstanceConfigMap } from "@/lib/instance-config";
import { parseDue } from "@/lib/retro/parse-due";

export const dynamic = "force-dynamic";

// Account-gated graduation: turn a retro's action items into tracked Minutia
// issues under a new or existing series. Ownership is derived from the session,
// never the client. Reads of the default-deny retro_* tables use service-role;
// series/meeting/issue inserts use the user-scoped client so RLS enforces access.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const cfg = await getInstanceConfigMap(["retro_enabled"]);
  if (cfg.retro_enabled !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { target?: "new" | "existing"; name?: string; series_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const svc = createServiceRoleClient();
  const { data: board } = await svc
    .from("retro_boards")
    .select("id, name, saved_to_series_id")
    .eq("token", token)
    .single();
  if (!board) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }
  if (board.saved_to_series_id) {
    return NextResponse.json(
      { series_id: board.saved_to_series_id, issue_count: 0, already_saved: true },
      { status: 200 }
    );
  }

  const { data: actions } = await svc
    .from("retro_actions")
    .select("id, text, owner_name, due, color")
    .eq("board_id", board.id)
    .order("sort_order", { ascending: true });
  if (!actions || actions.length === 0) {
    return NextResponse.json({ error: "No action items to save" }, { status: 422 });
  }

  // Validate access to an existing target up front (read-only, before claiming).
  let existingSeriesId: string | null = null;
  if (body.target === "existing") {
    if (!body.series_id) {
      return NextResponse.json({ error: "series_id required" }, { status: 400 });
    }
    const { data: series } = await supabase
      .from("meeting_series")
      .select("id")
      .eq("id", body.series_id)
      .single();
    if (!series) {
      return NextResponse.json({ error: "Series not accessible" }, { status: 403 });
    }
    existingSeriesId = series.id;
  }

  // Atomic claim: prevents concurrent double-graduation (double-click, auto +
  // manual save). Only one request flips claimed_by from null; losers bail.
  const { data: claimed } = await svc
    .from("retro_boards")
    .update({ claimed_by: user.id })
    .eq("id", board.id)
    .is("claimed_by", null)
    .select("id")
    .maybeSingle();
  if (!claimed) {
    const { data: b2 } = await svc
      .from("retro_boards")
      .select("saved_to_series_id")
      .eq("id", board.id)
      .single();
    return NextResponse.json(
      { series_id: b2?.saved_to_series_id ?? null, issue_count: 0, already_saved: true },
      { status: b2?.saved_to_series_id ? 200 : 409 }
    );
  }
  // Release the claim if a later step fails, so the user can retry.
  const release = () =>
    svc.from("retro_boards").update({ claimed_by: null }).eq("id", board.id).is("saved_to_series_id", null);

  // Resolve the target series (create new only after claiming).
  let seriesId: string;
  if (existingSeriesId) {
    seriesId = existingSeriesId;
  } else {
    const { data: profile } = await supabase
      .from("profiles")
      .select("current_organization_id")
      .eq("id", user.id)
      .single();
    const { data: series, error } = await supabase
      .from("meeting_series")
      .insert({
        name: (body.name || board.name).slice(0, 120),
        description: "Created from a Minutia Retro",
        owner_id: user.id,
        organization_id: profile?.current_organization_id ?? null,
      })
      .select("id")
      .single();
    if (error || !series) {
      await release();
      return NextResponse.json({ error: "Could not create series" }, { status: 400 });
    }
    seriesId = series.id;
  }

  // A meeting to anchor the issues (issues.raised_in_meeting_id is required).
  const { count } = await supabase
    .from("meetings")
    .select("id", { count: "exact", head: true })
    .eq("series_id", seriesId);
  const { data: meeting, error: meetingErr } = await supabase
    .from("meetings")
    .insert({
      series_id: seriesId,
      sequence_number: (count ?? 0) + 1,
      title: "Retrospective",
      status: "completed",
    })
    .select("id")
    .single();
  if (meetingErr || !meeting) {
    await release();
    return NextResponse.json({ error: "Could not create meeting" }, { status: 400 });
  }

  // Insert one issue per action, individually, so we can link each back reliably.
  let issueCount = 0;
  for (const a of actions) {
    const due = parseDue(a.due) ? a.due : null;
    const { data: issue, error: issueErr } = await supabase
      .from("issues")
      .insert({
        series_id: seriesId,
        raised_in_meeting_id: meeting.id,
        title: a.text,
        category: "action",
        source: "retro",
        owner_name: a.owner_name ?? "",
        due_date: due,
      })
      .select("id")
      .single();
    if (issueErr || !issue) continue;
    issueCount += 1;
    await svc.from("retro_actions").update({ graduated_issue_id: issue.id }).eq("id", a.id);
  }

  // Persist the board (clear TTL) and record the conversion. If this final write
  // fails, release the claim so the board does not get stuck unsavable.
  const { error: finalErr } = await svc
    .from("retro_boards")
    .update({ saved_to_series_id: seriesId, claimed_by: user.id, expires_at: null })
    .eq("id", board.id);
  if (finalErr) {
    await release();
    return NextResponse.json({ error: "Could not finalize save" }, { status: 500 });
  }

  return NextResponse.json({ series_id: seriesId, issue_count: issueCount });
}
