import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { publicAuthCallbackOrigin, safeAuthNextPath } from "@/lib/auth-callback-url";
import { checkHandoff, isTrustedSubmit, sha256Hex } from "@/lib/companion/web-handoff";

function field(form: FormData | null, name: string): string {
  const value = form?.get(name);
  return typeof value === "string" ? value : "";
}

// Redeems a one-time handoff minted for the Mac app's web window. The sign-in token is minted
// and verified here, in one step, so it never leaves the server.
export async function POST(request: Request) {
  const origin = publicAuthCallbackOrigin(request);
  const toLogin = () => NextResponse.redirect(`${origin}/login`, 303);

  if (!isTrustedSubmit(request.headers.get("sec-fetch-site"), request.headers.get("origin"), origin)) {
    return toLogin();
  }

  const form = await request.formData().catch(() => null);
  const handoffId = field(form, "handoff_id");
  const nonce = field(form, "nonce");
  if (!handoffId || !nonce) return toLogin();

  const admin = createServiceRoleClient();
  const { data: row } = await admin
    .from("companion_web_handoffs")
    .select("id, user_id, handoff_digest, nonce_digest, created_at, used_at")
    .eq("handoff_digest", sha256Hex(handoffId))
    .maybeSingle();
  if (!row || checkHandoff(row, { handoffId, nonce, now: new Date() }) !== "ok") return toLogin();

  const { data: claimed } = await admin.rpc("claim_companion_web_handoff", { p_id: row.id });
  if (claimed !== true) return toLogin();

  const {
    data: { user: owner },
  } = await admin.auth.admin.getUserById(row.user_id);
  if (!owner?.email || !owner.email_confirmed_at) return toLogin();

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: owner.email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) return toLogin();

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (error) return toLogin();

  return NextResponse.redirect(`${origin}${safeAuthNextPath(field(form, "next"))}`, 303);
}
