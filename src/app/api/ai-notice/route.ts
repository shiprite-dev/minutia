import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getInstanceConfigMap } from "@/lib/instance-config";

// Thin BFF adapter: returns the neutral upsell destination for a given nudge
// slot. instance_config is admin-RLS-only, so the read uses the service-role
// client here (never in a client component). Only the non-secret notice URLs are
// exposed; no plan or price logic lives in this OSS route. Slot defaults to "ai"
// for back-compat with the original AI-unavailable notice.
const SLOT_CONFIG_KEYS: Record<string, string> = {
  ai: "ai_notice_url",
  capacity: "capacity_notice_url",
};

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const slot = new URL(request.url).searchParams.get("slot") ?? "ai";
  const key = SLOT_CONFIG_KEYS[slot] ?? SLOT_CONFIG_KEYS.ai;

  const config = await getInstanceConfigMap([key]);
  return NextResponse.json({ ctaUrl: config[key] ?? null });
}
