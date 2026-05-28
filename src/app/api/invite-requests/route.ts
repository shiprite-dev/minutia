import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { absoluteAppUrl, escapeHtml, sendMail } from "@/lib/email";
import { createInviteRequestActionToken } from "@/lib/invite-request-actions";
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

async function getOrganizationTarget(
  supabase: ReturnType<typeof createServiceRoleClient>,
  organizationId: string
) {
  const [organizationResult, adminResult] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, name")
      .eq("id", organizationId)
      .single(),
    supabase
      .from("organization_members")
      .select("profiles!organization_members_user_id_fkey(email)")
      .eq("organization_id", organizationId)
      .eq("role", "admin")
      .limit(10),
  ]);

  if (organizationResult.error || !organizationResult.data) return null;

  return {
    organizationId: organizationResult.data.id,
    organizationName: organizationResult.data.name,
    adminEmails: (adminResult.data ?? [])
      .flatMap((admin) => admin.profiles ?? [])
      .map((profile) => profile.email)
      .filter(Boolean),
  };
}

async function getInviteTarget(
  supabase: ReturnType<typeof createServiceRoleClient>,
  nextPath: string
) {
  const token = shareTokenFromPath(nextPath);

  if (token) {
    const { data: share } = await supabase
      .from("guest_shares")
      .select("organization_id")
      .eq("token", token)
      .maybeSingle();

    if (share?.organization_id) {
      const shareTarget = await getOrganizationTarget(supabase, share.organization_id);
      if (shareTarget) return shareTarget;
    }
  }

  const { data: organizations } = await supabase
    .from("organizations")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(2);

  if (organizations?.length === 1) {
    const singleTarget = await getOrganizationTarget(supabase, organizations[0].id);
    if (singleTarget) return singleTarget;
  }

  return {
    organizationId: null,
    organizationName: "Minutia",
    adminEmails: await getGlobalAdminEmails(supabase),
  };
}

function reviewUrl(requestUrl: string, token: string, decision: "approve" | "reject") {
  const params = new URLSearchParams({ token, decision });
  return absoluteAppUrl(requestUrl, `/invite-requests/review?${params.toString()}`);
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
  const requestedEmail = parsed.data.email.toLowerCase();
  const nextPath = safeNextPath(parsed.data.next);
  const inviteTarget = await getInviteTarget(supabase, nextPath);
  const adminEmails = inviteTarget.adminEmails;
  const to = adminEmails.length
    ? adminEmails
    : [process.env.SMTP_ADMIN_EMAIL || process.env.EMAIL_FROM || "admin@localhost"];
  const requestedUrl = absoluteAppUrl(request.url, nextPath);

  const { data: inviteRequest, error: inviteRequestError } = await supabase
    .from("invite_requests")
    .insert({
      organization_id: inviteTarget.organizationId,
      email: requestedEmail,
      requested_path: nextPath,
    })
    .select("id, email, organization_id")
    .single();

  if (inviteRequestError || !inviteRequest) {
    return NextResponse.json(
      { error: "Failed to create invite request" },
      { status: 500 }
    );
  }

  const actionToken = createInviteRequestActionToken({
    requestId: inviteRequest.id,
    email: requestedEmail,
    organizationId: inviteRequest.organization_id,
  });
  const approveUrl = reviewUrl(request.url, actionToken, "approve");
  const rejectUrl = reviewUrl(request.url, actionToken, "reject");
  const actionNote = inviteTarget.organizationId
    ? `Approval adds them to ${inviteTarget.organizationName} as a member.`
    : "Approval uses the workspace you are signed into as an admin.";

  try {
    await sendMail({
      to,
      replyTo: requestedEmail,
      subject: "Minutia invite request",
      text: [
        `${requestedEmail} requested access to ${inviteTarget.organizationName}.`,
        `Requested page: ${requestedUrl}`,
        actionNote,
        "",
        `Approve request: ${approveUrl}`,
        `Reject request: ${rejectUrl}`,
        "",
        "Links open a review screen. Nothing changes until an admin confirms.",
      ].join("\n"),
      html: `
        <!doctype html>
        <html>
          <body style="margin:0;background:#f5f1e9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#171717;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1e9;padding:32px 16px;">
              <tr>
                <td align="center">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fffdf8;border:1px solid #e8e2d8;border-radius:18px;overflow:hidden;">
                    <tr>
                      <td style="padding:28px 30px 10px;">
                        <p style="margin:0 0 16px;color:#d4572a;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">minutia access</p>
                        <h1 style="margin:0;color:#171717;font-size:26px;font-weight:760;line-height:32px;">Approve access for ${escapeHtml(requestedEmail)}?</h1>
                        <p style="margin:12px 0 0;color:#6b665f;font-size:14px;line-height:22px;">A visitor asked to join ${escapeHtml(inviteTarget.organizationName)}. Review the request before changing workspace access.</p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:18px 30px 8px;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e2d8;border-radius:14px;background:#fbfaf7;">
                          <tr>
                            <td style="padding:16px;">
                              <p style="margin:0;color:#6b665f;font-size:11px;line-height:16px;text-transform:uppercase;letter-spacing:.08em;">Requester</p>
                              <p style="margin:5px 0 14px;color:#171717;font-size:16px;line-height:22px;font-weight:700;">${escapeHtml(requestedEmail)}</p>
                              <p style="margin:0;color:#6b665f;font-size:11px;line-height:16px;text-transform:uppercase;letter-spacing:.08em;">Requested page</p>
                              <a href="${requestedUrl}" style="display:block;margin-top:5px;color:#d4572a;font-size:13px;line-height:20px;text-decoration:underline;">${escapeHtml(requestedUrl)}</a>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:18px 30px 30px;">
                        <table role="presentation" cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="padding:0 10px 10px 0;">
                              <a href="${approveUrl}" style="display:inline-block;border-radius:12px;background:#171717;color:#ffffff;font-size:14px;font-weight:750;line-height:20px;padding:12px 18px;text-decoration:none;">Approve request</a>
                            </td>
                            <td style="padding:0 0 10px 0;">
                              <a href="${rejectUrl}" style="display:inline-block;border-radius:12px;border:1px solid #d8d0c3;color:#6b665f;font-size:14px;font-weight:750;line-height:20px;padding:11px 17px;text-decoration:none;">Reject request</a>
                            </td>
                          </tr>
                        </table>
                        <p style="margin:4px 0 0;color:#6b665f;font-size:12px;line-height:19px;">${escapeHtml(actionNote)} Buttons open a review screen first, so email previews cannot change access.</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
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
