import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { absoluteAppUrl, escapeHtml, sendMail } from "@/lib/email";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const schema = z.object({
  email: z.string().email(),
  next: z.string().optional(),
});

function safeNextPath(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function shareTokenFromPath(nextPath: string) {
  const pathname = new URL(nextPath, "http://localhost").pathname;
  const [, share, token] = pathname.split("/");
  return share === "share" && token ? decodeURIComponent(token) : null;
}

async function getGlobalAdminEmails(
  supabase: ReturnType<typeof createServiceRoleClient>
) {
  const { data: admins } = await supabase
    .from("profiles")
    .select("email")
    .eq("role", "admin")
    .limit(5);

  return (admins ?? [])
    .map((admin) => admin.email)
    .filter(Boolean);
}

async function getShareOrganizationAdminEmails(
  supabase: ReturnType<typeof createServiceRoleClient>,
  token: string | null
) {
  if (!token) return [];

  const { data: share } = await supabase
    .from("guest_shares")
    .select("organization_id")
    .eq("token", token)
    .maybeSingle();

  if (!share?.organization_id) return [];

  const { data: admins } = await supabase
    .from("organization_members")
    .select("profiles!organization_members_user_id_fkey(email)")
    .eq("organization_id", share.organization_id)
    .eq("role", "admin")
    .limit(10);

  return (admins ?? [])
    .flatMap((admin) => admin.profiles ?? [])
    .map((profile) => profile.email)
    .filter(Boolean);
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const supabase = createServiceRoleClient();
  const nextPath = safeNextPath(parsed.data.next);
  const shareAdminEmails = await getShareOrganizationAdminEmails(
    supabase,
    shareTokenFromPath(nextPath)
  );
  const adminEmails = shareAdminEmails.length
    ? shareAdminEmails
    : await getGlobalAdminEmails(supabase);
  const to = adminEmails.length
    ? adminEmails
    : [process.env.SMTP_ADMIN_EMAIL || process.env.EMAIL_FROM || "admin@localhost"];
  const requestedUrl = absoluteAppUrl(request.url, nextPath);

  try {
    await sendMail({
      to,
      replyTo: parsed.data.email,
      subject: "Minutia invite request",
      text: `${parsed.data.email} requested access to Minutia.\nRequested page: ${requestedUrl}`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#171717;">
          <p style="margin:0 0 18px;color:#d4572a;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">minutia</p>
          <h1 style="margin:0 0 12px;font-size:24px;line-height:30px;">Invite request</h1>
          <p style="margin:0 0 20px;color:#6b665f;font-size:14px;line-height:22px;">${escapeHtml(parsed.data.email)} requested access to your Minutia instance.</p>
          <div style="border:1px solid #e8e2d8;border-radius:14px;padding:16px;background:#fbfaf7;">
            <p style="margin:0;color:#6b665f;font-size:12px;line-height:18px;text-transform:uppercase;letter-spacing:.06em;">Requested page</p>
            <a href="${requestedUrl}" style="display:block;margin-top:6px;color:#d4572a;font-size:14px;line-height:22px;">${escapeHtml(requestedUrl)}</a>
          </div>
        </div>
      `,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send invite request" },
      { status: 500 }
    );
  }

  return NextResponse.json({ sent: true });
}
