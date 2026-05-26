import { escapeHtml } from "@/lib/email";

type OrganizationInviteEmailInput = {
  organizationName: string;
  role: "admin" | "member";
  appUrl: string;
};

export function buildExistingUserOrganizationInviteEmail({
  organizationName,
  role,
  appUrl,
}: OrganizationInviteEmailInput) {
  const settingsUrl = new URL("/settings", appUrl).toString();
  const roleLabel = role === "admin" ? "admin" : "member";
  const subject = `You have been added to ${organizationName} on Minutia`;

  const text = [
    `You have been added to ${organizationName} as an organization ${roleLabel}.`,
    "",
    `Open Minutia: ${settingsUrl}`,
  ].join("\n");

  const html = `
    <!doctype html>
    <html>
      <body style="margin:0;background:#fbfaf7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#171717;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbfaf7;padding:32px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e8e2d8;border-radius:16px;overflow:hidden;">
                <tr>
                  <td style="padding:26px 28px;">
                    <p style="margin:0 0 18px;color:#d4572a;font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">minutia</p>
                    <h1 style="margin:0;color:#171717;font-size:24px;font-weight:750;line-height:31px;">You have access to ${escapeHtml(organizationName)}</h1>
                    <p style="margin:12px 0 0;color:#6b665f;font-size:14px;line-height:22px;">You were added as an organization ${escapeHtml(roleLabel)}.</p>
                    <div style="margin-top:24px;">
                      <a href="${settingsUrl}" style="display:inline-block;border-radius:12px;background:#d4572a;color:#ffffff;font-size:14px;font-weight:750;line-height:20px;padding:12px 16px;text-decoration:none;">Open workspace</a>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return { subject, text, html };
}
