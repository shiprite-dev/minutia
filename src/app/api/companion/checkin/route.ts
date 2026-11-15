import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseDevice } from "@/lib/companion/validate";

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
  if (!device || typeof body.can_claim !== "boolean") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("companion_checkin", {
    p_device_id: device.id,
    p_device_name: device.name,
    p_can_claim: body.can_claim,
  });
  if (error) {
    return NextResponse.json({ error: "Check-in failed" }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    claim: row ? { meeting_id: row.meeting_id, series_id: row.series_id } : null,
  });
}
