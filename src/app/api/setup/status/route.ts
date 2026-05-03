import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function GET() {
  try {
    const supabase = createServiceRoleClient();

    const [configResult, adminResult] = await Promise.all([
      supabase
        .from("instance_config")
        .select("value")
        .eq("key", "setup_completed")
        .single(),
      supabase
        .from("profiles")
        .select("id")
        .eq("role", "admin")
        .limit(1),
    ]);

    const setupCompleted = configResult.data?.value === "true";
    const hasAdmin = (adminResult.data?.length ?? 0) > 0;

    return NextResponse.json({ setup_completed: setupCompleted, has_admin: hasAdmin });
  } catch {
    return NextResponse.json(
      { setup_completed: false, has_admin: false },
      { status: 500 }
    );
  }
}
