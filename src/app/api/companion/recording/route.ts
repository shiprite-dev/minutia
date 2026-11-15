import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const EVENTS = ["started", "failed", "stopped"];

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.meeting_id !== "string" ||
    typeof body.device_id !== "string" ||
    !body.device_id ||
    typeof body.device_name !== "string" ||
    !EVENTS.includes(body.event) ||
    (body.reason != null && typeof body.reason !== "string")
  ) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("companion_recording_event", {
    p_meeting_id: body.meeting_id,
    p_device_id: body.device_id,
    p_device_name: body.device_name,
    p_event: body.event,
    p_reason: body.reason ?? null,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ result: data });
}
