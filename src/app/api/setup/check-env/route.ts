import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

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

async function checkService(url: string): Promise<ServiceStatus> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
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

export async function GET() {
  const env = {
    jwt_secret: checkEnvVar("JWT_SECRET", 32),
    anon_key: checkEnvVar("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    service_role_key: checkEnvVar("SUPABASE_SERVICE_ROLE_KEY"),
    site_url: checkEnvVar("SITE_URL"),
    smtp_configured: !!process.env.SMTP_HOST,
    ai_configured: !!process.env.AI_API_KEY,
    google_configured: !!process.env.GOOGLE_CLIENT_ID,
  };

  let dbConnected = false;
  let dbLatency = 0;
  try {
    const supabase = createServiceRoleClient();
    const start = Date.now();
    const { error } = await supabase.rpc("", {}).maybeSingle();
    if (error) {
      const { error: selectError } = await supabase
        .from("instance_config")
        .select("key")
        .limit(1);
      dbConnected = !selectError;
    } else {
      dbConnected = true;
    }
    dbLatency = Date.now() - start;
  } catch {
    dbConnected = false;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

  const [authStatus, restStatus] = await Promise.all([
    checkService(`${supabaseUrl}/auth/v1/health`),
    checkService(`${supabaseUrl}/rest/v1/`),
  ]);

  const response: CheckEnvResponse = {
    env,
    db: { connected: dbConnected, latency_ms: dbLatency },
    services: { auth: authStatus, rest: restStatus },
  };

  return NextResponse.json(response);
}
