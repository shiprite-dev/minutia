import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid, parseDevice } from "@/lib/companion/validate";

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
  const device = body ? parseDevice(body) : null;
  if (
    !device ||
    !isUuid(body.meeting_id) ||
    !EVENTS.includes(body.event) ||
    (body.reason != null && typeof body.reason !== "string")
  ) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("companion_recording_event", {
    p_meeting_id: body.meeting_id,
    p_device_id: device.id,
    p_device_name: device.name,
    p_event: body.event,
    p_reason: body.reason ?? null,
  });
  if (error) {
    return NextResponse.json({ error: "Recording update failed" }, { status: 500 });
  }

  return NextResponse.json({ result: data });
}
