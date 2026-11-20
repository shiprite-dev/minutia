import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { publicAuthCallbackOrigin, safeAuthNextPath } from "@/lib/auth-callback-url";
import { checkHandoff, sha256Hex } from "@/lib/companion/web-handoff";

function field(form: FormData | null, name: string): string {
  const value = form?.get(name);
  return typeof value === "string" ? value : "";
}

// Redeems a one-time handoff minted for the Mac app's web window and sets this browser's own
// session cookies. A POST from another site is refused so nobody can sign a visitor into
// a different account.
export async function POST(request: Request) {
  const origin = publicAuthCallbackOrigin(request);
  const toLogin = () => NextResponse.redirect(`${origin}/login`, 303);

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") return toLogin();

  const form = await request.formData().catch(() => null);
  const tokenHash = field(form, "token_hash");
  const nonce = field(form, "nonce");
  if (!tokenHash || !nonce) return toLogin();

  const admin = createServiceRoleClient();
  const { data: row } = await admin
    .from("companion_web_handoffs")
    .select("id, token_digest, nonce_digest, created_at, used_at")
    .eq("token_digest", sha256Hex(tokenHash))
    .maybeSingle();
  if (!row || checkHandoff(row, { tokenHash, nonce, now: new Date() }) !== "ok") return toLogin();

  const { data: claimed } = await admin.rpc("claim_companion_web_handoff", { p_id: row.id });
  if (claimed !== true) return toLogin();

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (error) return toLogin();

  return NextResponse.redirect(`${origin}${safeAuthNextPath(field(form, "next"))}`, 303);
}
