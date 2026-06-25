import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getInstanceConfigMap } from "@/lib/instance-config";

// Thin BFF adapter: returns the neutral upsell destination for the AI-unavailable
// notice. instance_config is admin-RLS-only, so the read uses the service-role
// client here (never in a client component). Only the non-secret ai_notice_url is
// exposed; no plan or price logic lives in this OSS route.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const config = await getInstanceConfigMap(["ai_notice_url"]);
  return NextResponse.json({ ctaUrl: config.ai_notice_url ?? null });
}
