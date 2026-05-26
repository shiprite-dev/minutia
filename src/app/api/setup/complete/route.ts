import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireSetupToken } from "@/lib/setup-token";

export async function POST(request: NextRequest) {
  const setupAuth = requireSetupToken(request);
  if (!setupAuth.authorized) {
    return NextResponse.json(
      { error: setupAuth.error },
      { status: setupAuth.status }
    );
  }

  const supabase = createServiceRoleClient();

  const { data: existingAdmins } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .limit(1);

  if (!existingAdmins || existingAdmins.length === 0) {
    return NextResponse.json(
      { error: "Cannot complete setup without an admin account" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("instance_config")
    .upsert(
      { key: "setup_completed", value: "true", updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ setup_completed: true });
}
