import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getInstanceConfigMap } from "@/lib/instance-config";
import { getSmtpConfig } from "@/lib/email";
import {
  configStatus,
  overallHealth,
  type ServiceProbe,
} from "@/lib/admin/health";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = createServiceRoleClient();
  const probes: ServiceProbe[] = [];

  const dbRes = await supabase
    .from("profiles")
    .select("id", { head: true, count: "exact" });
  probes.push(
    dbRes.error
      ? { service: "database", status: "down", detail: "Database query failed" }
      : { service: "database", status: "ok" }
  );

  const bucketsRes = await supabase.storage.listBuckets();
  probes.push(
    !bucketsRes.error && Array.isArray(bucketsRes.data)
      ? { service: "storage", status: "ok" }
      : {
          service: "storage",
          status: "degraded",
          detail: "Storage unavailable",
        }
  );

  const smtp = await getSmtpConfig();
  probes.push({
    service: "email",
    status: configStatus(smtp ? "ok" : process.env.RESEND_API_KEY ?? ""),
  });

  const aiConfig = await getInstanceConfigMap(["ai_api_key"]);
  probes.push({ service: "ai", status: configStatus(aiConfig.ai_api_key) });

  return NextResponse.json({ overall: overallHealth(probes), services: probes });
}
