import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const ENCRYPTED_KEYS = new Set([
  "smtp_pass",
  "ai_api_key",
  "google_client_secret",
]);

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("instance_config")
    .select("key, value, encrypted")
    .order("key");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const reveal = request.nextUrl.searchParams.get("reveal") === "true";

  const config: Record<string, string | null> = {};
  for (const row of data ?? []) {
    if (row.encrypted && !reveal) {
      config[row.key] = row.value ? "configured" : null;
    } else {
      config[row.key] = row.value;
    }
  }

  return NextResponse.json(config);
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: Record<string, string | null>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const entries = Object.entries(body);

  for (const [key, value] of entries) {
    const encrypted = ENCRYPTED_KEYS.has(key);

    const { error } = await supabase
      .from("instance_config")
      .upsert(
        {
          key,
          value,
          encrypted,
          updated_by: auth.userId === "setup" ? null : auth.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      );

    if (error) {
      return NextResponse.json(
        { error: `Failed to update "${key}": ${error.message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ updated: entries.length });
}
