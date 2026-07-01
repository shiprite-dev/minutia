import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { rejectCrossOrigin } from "@/lib/request-origin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  displayInstanceConfigValue,
  prepareInstanceConfigValue,
  SECRET_CONFIG_KEYS,
} from "@/lib/instance-config";
import { getAdminCapabilities } from "@/lib/admin/capabilities";
import { rejectedConfigKeys } from "@/lib/admin/config-capabilities";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
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

  const config: Record<string, string | null> = {};
  for (const row of data ?? []) {
    config[row.key] = displayInstanceConfigValue(row);
  }

  return NextResponse.json(config);
}

export async function PUT(request: NextRequest) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const auth = await requireAdmin(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: Record<string, string | null>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const caps = getAdminCapabilities();
  const rejected = rejectedConfigKeys(Object.keys(body), caps);
  if (rejected.length > 0) {
    return NextResponse.json(
      {
        error: `These settings are not editable on this instance: ${rejected.join(", ")}`,
      },
      { status: 403 }
    );
  }

  const supabase = createServiceRoleClient();
  const entries = Object.entries(body);

  for (const [key, value] of entries) {
    const encrypted = SECRET_CONFIG_KEYS.has(key);

    const { error } = await supabase
      .from("instance_config")
      .upsert(
        {
          key,
          value: prepareInstanceConfigValue(key, value),
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
