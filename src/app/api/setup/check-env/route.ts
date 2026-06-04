import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getSupabaseServerUrl } from "@/lib/supabase/url";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { requireSetupToken } from "@/lib/setup-token";

type EnvStatus = "ok" | "missing" | "weak";
type ServiceStatus = "healthy" | "unreachable";

interface CheckEnvResponse {
  env: {
    jwt_secret: EnvStatus;
    anon_key: EnvStatus;
    service_role_key: EnvStatus;
    site_url: EnvStatus;
    smtp_configured: boolean;
    ai_configured: boolean;
    google_configured: boolean;
  };
  db: {
    connected: boolean;
    latency_ms: number;
  };
  services: {
    auth: ServiceStatus;
    rest: ServiceStatus;
  };
}

async function checkService(url: string, key: string): Promise<ServiceStatus> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });
    clearTimeout(timeout);
    return res.ok ? "healthy" : "unreachable";
  } catch {
    return "unreachable";
  }
}

function checkEnvVar(name: string, minLength?: number): EnvStatus {
  const val = process.env[name];
  if (!val) return "missing";
  if (minLength && val.length < minLength) return "weak";
  return "ok";
}

async function isSetupCompleted() {
  try {
    const supabase = createServiceRoleClient();
    const { data } = await supabase
      .from("instance_config")
      .select("value")
      .eq("key", "setup_completed")
      .single();
    return data?.value === "true";
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const setupCompleted = await isSetupCompleted();
  const auth = setupCompleted ? await requireAdmin(request) : requireSetupToken(request);

  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const env = {
    jwt_secret: checkEnvVar("JWT_SECRET", 32),
    anon_key: checkEnvVar("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    service_role_key: checkEnvVar("SUPABASE_SERVICE_ROLE_KEY"),
    site_url: checkEnvVar("SITE_URL"),
    smtp_configured: !!process.env.SMTP_HOST,
    ai_configured: !!process.env.OPENROUTER_API_KEY || !!process.env.AI_API_KEY,
    google_configured: !!process.env.GOOGLE_CLIENT_ID,
  };

  let dbConnected = false;
  let dbLatency = 0;
  try {
    const supabase = createServiceRoleClient();
    const start = Date.now();
    const { error } = await supabase
      .from("instance_config")
      .select("key")
      .limit(1);
    dbConnected = !error;
    dbLatency = Date.now() - start;
  } catch {
    dbConnected = false;
  }

  const supabaseUrl = getSupabaseServerUrl();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  const [authStatus, restStatus] = await Promise.all([
    checkService(`${supabaseUrl}/auth/v1/health`, serviceKey),
    checkService(`${supabaseUrl}/rest/v1/instance_config?select=key&limit=1`, serviceKey),
  ]);

  const response: CheckEnvResponse = {
    env,
    db: { connected: dbConnected, latency_ms: dbLatency },
    services: { auth: authStatus, rest: restStatus },
  };

  return NextResponse.json(response);
}
