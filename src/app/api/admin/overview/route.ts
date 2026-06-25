import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = createServiceRoleClient();

  const [usersRes, seriesRes, meetingsRes, openIssuesRes, configRes] =
    await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("meeting_series").select("*", { count: "exact", head: true }),
      supabase.from("meetings").select("*", { count: "exact", head: true }),
      supabase
        .from("issues")
        .select("*", { count: "exact", head: true })
        .not("status", "in", "(resolved,dropped)"),
      supabase
        .from("instance_config")
        .select("key, value")
        .in("key", ["instance_name", "hosted_mode"]),
    ]);

  const config: Record<string, string | null> = {};
  for (const row of configRes.data ?? []) {
    config[row.key] = row.value;
  }

  return NextResponse.json({
    users: usersRes.count ?? 0,
    series: seriesRes.count ?? 0,
    meetings: meetingsRes.count ?? 0,
    openIssues: openIssuesRes.count ?? 0,
    instanceName: config.instance_name || "Minutia",
    version: process.env.npm_package_version || "0.1.0",
    deploymentMode: config.hosted_mode === "true" ? "hosted" : "self-host",
  });
}
