import { escapeHtml } from "@/lib/escape-html";

export const EMAIL_ACCENT = "#b23b2e";
export const MINUTIA_EMAIL_BRANDING = "Sent via Minutia";

const palette = {
  ink: "#171717",
  muted: "#6b665f",
  rule: "#e8e2d8",
  paper: "#fbfaf7",
  card: "#ffffff",
  accent: EMAIL_ACCENT,
};

export type EmailCta = {
  label: string;
  href: string;
};

export type EmailLayoutInput = {
  preheader: string;
  heading: string;
  intro?: string;
  bodyHtml: string;
  cta?: EmailCta;
  footerNote?: string;
  footerUrl?: string;
};

function ctaBlock(cta: EmailCta): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 4px;">
      <tr>
        <td style="border-radius:12px;background:${palette.accent};">
          <a href="${escapeHtml(cta.href)}" style="display:inline-block;padding:13px 22px;color:#ffffff;font-size:15px;font-weight:700;line-height:20px;text-decoration:none;border-radius:12px;">${escapeHtml(cta.label)}</a>
        </td>
      </tr>
    </table>
  `;
}

export function renderEmailLayout(input: EmailLayoutInput): string {
  const { preheader, heading, intro, bodyHtml, cta, footerNote, footerUrl } =
    input;

  const footerLink = footerUrl
    ? `<a href="${escapeHtml(footerUrl)}" style="color:${palette.muted};text-decoration:underline;">${escapeHtml(MINUTIA_EMAIL_BRANDING)}</a>`
    : escapeHtml(MINUTIA_EMAIL_BRANDING);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <style>
      @media (prefers-color-scheme: dark) {
        body, .m-bg { background: #14120f !important; }
        .m-card { background: #1d1a16 !important; border-color: #2c2823 !important; }
        .m-ink { color: #f3efe8 !important; }
        .m-muted { color: #a29b8f !important; }
        .m-rule { border-color: #2c2823 !important; }
      }
    </style>
  </head>
  <body class="m-bg" style="margin:0;background:${palette.paper};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${palette.ink};">
    <span class="m-muted" style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</span>
    <table role="presentation" class="m-bg" width="100%" cellpadding="0" cellspacing="0" style="background:${palette.paper};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" class="m-card" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${palette.card};border:1px solid ${palette.rule};border-radius:18px;overflow:hidden;">
            <tr>
              <td class="m-rule" style="padding:24px 28px 18px;border-bottom:1px solid ${palette.rule};">
                <span style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;letter-spacing:.01em;color:${palette.accent};">minutia</span>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 28px 30px;">
                <h1 class="m-ink" style="margin:0;color:${palette.ink};font-size:23px;font-weight:700;line-height:30px;">${escapeHtml(heading)}</h1>
                ${intro ? `<p class="m-muted" style="margin:10px 0 0;color:${palette.muted};font-size:15px;line-height:23px;">${escapeHtml(intro)}</p>` : ""}
                ${bodyHtml}
                ${cta ? ctaBlock(cta) : ""}
              </td>
            </tr>
            <tr>
              <td class="m-rule" style="padding:18px 28px 24px;border-top:1px solid ${palette.rule};">
                ${footerNote ? `<p class="m-muted" style="margin:0 0 8px;color:${palette.muted};font-size:12px;line-height:19px;">${escapeHtml(footerNote)}</p>` : ""}
                <p class="m-muted" style="margin:0;color:${palette.muted};font-size:12px;line-height:19px;">${footerLink}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
