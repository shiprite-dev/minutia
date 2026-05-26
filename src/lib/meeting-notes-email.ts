import type { Decision, Issue, Meeting } from "@/lib/types";
import { escapeHtml } from "@/lib/email";

type MeetingEmailInput = {
  meeting: Meeting;
  seriesName: string;
  raisedIssues: Issue[];
  resolvedIssues: Issue[];
  carriedIssues: Issue[];
  decisions: Decision[];
  appUrl: string;
};

const brand = {
  ink: "#171717",
  muted: "#6b665f",
  rule: "#e8e2d8",
  paper: "#fbfaf7",
  accent: "#d4572a",
  success: "#2f7d4f",
};

function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function issueUrl(appUrl: string, issueId: string) {
  return new URL(`/issues/${issueId}`, appUrl).toString();
}

function issueRows(issues: Issue[], appUrl: string) {
  if (issues.length === 0) {
    return `<p style="margin:0;color:${brand.muted};font-size:14px;line-height:22px;">No items in this section.</p>`;
  }

  return issues
    .map((issue) => {
      const url = issueUrl(appUrl, issue.id);
      const meta = [
        issue.category,
        issue.status.replaceAll("_", " "),
        issue.owner_name ? `Owner: ${issue.owner_name}` : null,
        issue.due_date ? `Due: ${formatDate(issue.due_date)}` : null,
      ].filter(Boolean);

      return `
        <tr>
          <td style="padding:14px 0;border-top:1px solid ${brand.rule};">
            <a href="${url}" style="color:${brand.ink};font-size:15px;font-weight:650;line-height:22px;text-decoration:none;">${escapeHtml(issue.title)}</a>
            ${issue.description ? `<p style="margin:6px 0 0;color:${brand.muted};font-size:13px;line-height:20px;">${escapeHtml(issue.description)}</p>` : ""}
            <p style="margin:8px 0 0;color:${brand.muted};font-size:11px;line-height:16px;text-transform:uppercase;letter-spacing:.06em;">${escapeHtml(meta.join(" · "))}</p>
          </td>
          <td style="padding:14px 0 14px 16px;border-top:1px solid ${brand.rule};text-align:right;white-space:nowrap;">
            <a href="${url}" style="display:inline-block;border:1px solid ${brand.rule};border-radius:999px;color:${brand.accent};font-size:12px;font-weight:650;line-height:18px;padding:7px 12px;text-decoration:none;">Open issue</a>
          </td>
        </tr>
      `;
    })
    .join("");
}

function decisionRows(decisions: Decision[]) {
  if (decisions.length === 0) {
    return `<p style="margin:0;color:${brand.muted};font-size:14px;line-height:22px;">No decisions logged.</p>`;
  }

  return decisions
    .map(
      (decision) => `
        <div style="border-top:1px solid ${brand.rule};padding:14px 0;">
          <p style="margin:0;color:${brand.ink};font-size:15px;font-weight:650;line-height:22px;">${escapeHtml(decision.title)}</p>
          ${decision.rationale ? `<p style="margin:6px 0 0;color:${brand.muted};font-size:13px;line-height:20px;">${escapeHtml(decision.rationale)}</p>` : ""}
          ${decision.made_by ? `<p style="margin:8px 0 0;color:${brand.muted};font-size:11px;line-height:16px;text-transform:uppercase;letter-spacing:.06em;">By ${escapeHtml(decision.made_by)}</p>` : ""}
        </div>
      `
    )
    .join("");
}

function notesBlock(notes: string) {
  const trimmed = notes.trim();
  if (!trimmed) {
    return `<p style="margin:0;color:${brand.muted};font-size:14px;line-height:22px;">No freeform notes captured.</p>`;
  }

  return trimmed
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 12px;color:${brand.ink};font-size:14px;line-height:23px;">${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

function section(title: string, count: number, body: string) {
  return `
    <section style="margin-top:28px;">
      <div style="margin-bottom:10px;">
        <p style="margin:0;color:${brand.muted};font-size:11px;font-weight:700;line-height:16px;text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(title)} (${count})</p>
      </div>
      ${body}
    </section>
  `;
}

export function buildMeetingNotesEmail(input: MeetingEmailInput) {
  const {
    meeting,
    seriesName,
    raisedIssues,
    resolvedIssues,
    carriedIssues,
    decisions,
    appUrl,
  } = input;
  const meetingUrl = new URL(`/series/${meeting.series_id}/meetings/${meeting.id}`, appUrl).toString();
  const subject = `${seriesName}: ${meeting.title} notes`;
  const allIssueCount = raisedIssues.length + resolvedIssues.length + carriedIssues.length;

  const html = `
    <!doctype html>
    <html>
      <body style="margin:0;background:${brand.paper};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${brand.ink};">
        <div style="display:none;max-height:0;overflow:hidden;">${allIssueCount} tracked items, ${decisions.length} decisions, and meeting notes from Minutia.</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${brand.paper};padding:32px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid ${brand.rule};border-radius:20px;overflow:hidden;">
                <tr>
                  <td style="padding:26px 28px 22px;border-bottom:1px solid ${brand.rule};">
                    <p style="margin:0 0 18px;color:${brand.accent};font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">minutia</p>
                    <h1 style="margin:0;color:${brand.ink};font-size:26px;font-weight:750;line-height:32px;">${escapeHtml(meeting.title)}</h1>
                    <p style="margin:8px 0 0;color:${brand.muted};font-size:14px;line-height:22px;">${escapeHtml(seriesName)} · ${formatDate(meeting.date)}</p>
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;">
                      <tr>
                        <td style="padding-right:10px;"><span style="display:inline-block;border-radius:999px;background:${brand.ink};color:#fff;font-size:12px;font-weight:700;line-height:18px;padding:8px 13px;">${raisedIssues.length} raised</span></td>
                        <td style="padding-right:10px;"><span style="display:inline-block;border-radius:999px;background:${brand.success};color:#fff;font-size:12px;font-weight:700;line-height:18px;padding:8px 13px;">${resolvedIssues.length} resolved</span></td>
                        <td><span style="display:inline-block;border-radius:999px;background:${brand.paper};border:1px solid ${brand.rule};color:${brand.ink};font-size:12px;font-weight:700;line-height:18px;padding:7px 12px;">${decisions.length} decisions</span></td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px;">
                    ${section("Items raised", raisedIssues.length, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${issueRows(raisedIssues, appUrl)}</table>`)}
                    ${section("Resolved this meeting", resolvedIssues.length, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${issueRows(resolvedIssues, appUrl)}</table>`)}
                    ${section("Carried forward", carriedIssues.length, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${issueRows(carriedIssues, appUrl)}</table>`)}
                    ${section("Decisions", decisions.length, decisionRows(decisions))}
                    ${section("Notes", 1, notesBlock(meeting.notes_markdown ?? ""))}
                    <div style="margin-top:30px;padding-top:22px;border-top:1px solid ${brand.rule};">
                      <a href="${meetingUrl}" style="display:inline-block;border-radius:12px;background:${brand.accent};color:#fff;font-size:14px;font-weight:750;line-height:20px;padding:12px 16px;text-decoration:none;">Open meeting in Minutia</a>
                      <p style="margin:14px 0 0;color:${brand.muted};font-size:12px;line-height:20px;">Issue links open in Minutia. If you are not signed in, you will be asked to sign in first. If you do not have access, request an invite from the login screen.</p>
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

  const textLines = [
    `${meeting.title} - ${seriesName}`,
    formatDate(meeting.date),
    "",
    `Items raised (${raisedIssues.length})`,
    ...raisedIssues.map((issue) => `- ${issue.title}: ${issueUrl(appUrl, issue.id)}`),
    "",
    `Resolved this meeting (${resolvedIssues.length})`,
    ...resolvedIssues.map((issue) => `- ${issue.title}: ${issueUrl(appUrl, issue.id)}`),
    "",
    `Carried forward (${carriedIssues.length})`,
    ...carriedIssues.map((issue) => `- ${issue.title}: ${issueUrl(appUrl, issue.id)}`),
    "",
    `Decisions (${decisions.length})`,
    ...decisions.map((decision) => `- ${decision.title}`),
    "",
    "Notes",
    meeting.notes_markdown || "No freeform notes captured.",
    "",
    `Open meeting: ${meetingUrl}`,
  ];

  return { subject, html, text: textLines.join("\n") };
}

export function extractEmails(values: string[]): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];
  const regex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

  for (const value of values) {
    for (const match of value.match(regex) ?? []) {
      const email = match.toLowerCase();
      if (!seen.has(email)) {
        seen.add(email);
        emails.push(email);
      }
    }
  }

  return emails;
}
