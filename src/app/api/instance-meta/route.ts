import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getInstanceConfigMap } from "@/lib/instance-config";

export async function GET() {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("instance_config")
    .select("value")
    .eq("key", "setup_completed")
    .single();

  if (data?.value !== "true") {
    return NextResponse.json({ error: "Setup incomplete." }, { status: 503 });
  }

  const config = await getInstanceConfigMap(["instance_name"]);
  return NextResponse.json({
    name: config.instance_name || "Minutia",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  });
}
