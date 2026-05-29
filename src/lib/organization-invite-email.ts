import { escapeHtml } from "@/lib/email";

type OrganizationInviteEmailInput = {
  organizationName: string;
  role: "admin" | "member";
};

type NewUserOrganizationInviteEmailInput = OrganizationInviteEmailInput & {
  acceptUrl: string;
  invitedEmail?: string;
};

type ExistingUserOrganizationInviteEmailInput = OrganizationInviteEmailInput & {
  appUrl: string;
};

type InviteEmailHtmlInput = OrganizationInviteEmailInput & {
  headline: string;
  body: string;
  buttonLabel: string;
  buttonUrl: string;
  footer: string;
};

function roleCopy(role: "admin" | "member") {
  return role === "admin" ? "admin" : "member";
}

function buildEmailHtml({
  organizationName,
  role,
  headline,
  body,
  buttonLabel,
  buttonUrl,
  footer,
}: InviteEmailHtmlInput) {
  const safeOrganization = escapeHtml(organizationName);
  const safeRole = escapeHtml(roleCopy(role));
  const safeButtonUrl = escapeHtml(buttonUrl);

  return `
    <!doctype html>
    <html>
      <body style="margin:0;background:#f7f5ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#171717;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5ef;padding:36px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#fffdf8;border:1px solid #e2d8c8;border-radius:18px;overflow:hidden;box-shadow:0 18px 48px rgba(25,21,16,0.08);">
                <tr>
                  <td style="background:#171717;padding:14px 28px;">
                    <p style="margin:0;color:#fffaf1;font-size:12px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;">minutia</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:30px 28px 28px;">
                    <p style="margin:0 0 12px;color:#d4572a;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">${safeOrganization}</p>
                    <h1 style="margin:0;color:#171717;font-size:26px;font-weight:760;line-height:32px;">${escapeHtml(headline)}</h1>
                    <p style="margin:14px 0 0;color:#625d55;font-size:15px;line-height:24px;">${escapeHtml(body)}</p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;border-collapse:separate;border-spacing:0;border:1px solid #eadfce;border-radius:14px;background:#fbf7ef;">
                      <tr>
                        <td style="padding:14px 16px;">
                          <p style="margin:0;color:#8a7962;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">Access level</p>
                          <p style="margin:5px 0 0;color:#171717;font-size:14px;font-weight:700;text-transform:capitalize;">Organization ${safeRole}</p>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:22px 0 0;">
                      <a href="${safeButtonUrl}" style="display:inline-block;border-radius:12px;background:#d4572a;color:#ffffff;font-size:14px;font-weight:800;line-height:20px;padding:12px 18px;text-decoration:none;">${escapeHtml(buttonLabel)}</a>
                    </p>
                    <p style="margin:18px 0 0;color:#7a746c;font-size:12px;line-height:19px;">${escapeHtml(footer)}</p>
                  </td>
                </tr>
              </table>
              <p style="margin:16px 0 0;color:#8a857d;font-size:11px;line-height:18px;">If the button does not work, paste this link into your browser:<br><span style="word-break:break-all;">${safeButtonUrl}</span></p>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

export function buildNewUserOrganizationInviteEmail({
  organizationName,
  role,
  acceptUrl,
  invitedEmail,
}: NewUserOrganizationInviteEmailInput) {
  const roleLabel = roleCopy(role);
  const subject = `Set your Minutia password for ${organizationName}`;

  const text = [
    `You have been invited to ${organizationName} as an organization ${roleLabel}.`,
    invitedEmail ? `Invited email: ${invitedEmail}` : "",
    "",
    `Set your password: ${acceptUrl}`,
    "",
    "No temporary password is shared. This one-time link lets you choose your own password and open the workspace.",
  ].filter(Boolean).join("\n");

  const html = buildEmailHtml({
    organizationName,
    role,
    headline: "You have been invited to Minutia",
    body: `Use this invite to set your password and join ${organizationName}.`,
    buttonLabel: "Set password",
    buttonUrl: acceptUrl,
    footer: "No temporary password is shared. The invite link is one-time use and should only be opened by the invited teammate.",
  });

  return { subject, text, html };
}

export function buildExistingUserOrganizationInviteEmail({
  organizationName,
  role,
  appUrl,
}: ExistingUserOrganizationInviteEmailInput) {
  const settingsUrl = new URL("/settings", appUrl).toString();
  const roleLabel = roleCopy(role);
  const subject = `You have been added to ${organizationName} on Minutia`;

  const text = [
    `You have been added to ${organizationName} as an organization ${roleLabel}.`,
    "",
    `Open workspace: ${settingsUrl}`,
  ].join("\n");

  const html = buildEmailHtml({
    organizationName,
    role,
    headline: "You have access to a Minutia workspace",
    body: `You were added to ${organizationName}. Your existing Minutia sign-in still works.`,
    buttonLabel: "Open workspace",
    buttonUrl: settingsUrl,
    footer: "Use your existing password or magic link to sign in if this browser does not already have a session.",
  });

  return { subject, text, html };
}
