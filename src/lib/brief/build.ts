import { escapeHtml } from "@/lib/escape-html";
import { renderEmailLayout } from "@/lib/email-layout";
import type { Issue, Priority } from "@/lib/types";
import { ownerMatchesRecipient } from "./match";

export type BriefIssue = Issue & { ownerEmail?: string | null };

export type BriefEmail = {
  email: string;
  subject: string;
  html: string;
  text: string;
};

export type BuildSeriesBriefInput = {
  series: { name: string; cadence?: string | null };
  nextMeeting?: { title?: string | null; date: Date | string } | null;
  openIssues: BriefIssue[];
  recipients: string[];
  guestUrl: string;
  instanceUrl?: string;
};

const PRIORITY_RANK: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const MAX_ALSO = 5;

function formatMeetingDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function byPriority(a: BriefIssue, b: BriefIssue): number {
  const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (rank !== 0) return rank;
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

function issueMetaText(issue: BriefIssue): string {
  const parts: string[] = [];
  if (issue.owner_name) parts.push(issue.owner_name);
  if (issue.due_date) parts.push(`due ${formatMeetingDate(issue.due_date)}`);
  return parts.join(" · ");
}

function issueRowsHtml(issues: BriefIssue[]): string {
  return issues
    .map((issue) => {
      const meta = issueMetaText(issue);
      return `
        <tr>
          <td style="padding:11px 0;border-top:1px solid #e8e2d8;" class="m-rule">
            <span style="display:block;color:#171717;font-size:15px;font-weight:600;line-height:21px;" class="m-ink">${escapeHtml(issue.title)}</span>
            ${meta ? `<span style="display:block;margin-top:3px;color:#6b665f;font-size:12px;line-height:17px;" class="m-muted">${escapeHtml(meta)}</span>` : ""}
          </td>
        </tr>`;
    })
    .join("");
}

function sectionHtml(title: string, issues: BriefIssue[], emptyNote: string): string {
  const body =
    issues.length === 0
      ? `<p style="margin:8px 0 0;color:#6b665f;font-size:14px;line-height:21px;" class="m-muted">${escapeHtml(emptyNote)}</p>`
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${issueRowsHtml(issues)}</table>`;
  return `
    <div style="margin-top:24px;">
      <p style="margin:0;color:#6b665f;font-size:11px;font-weight:700;line-height:16px;text-transform:uppercase;letter-spacing:.08em;" class="m-muted">${escapeHtml(title)}</p>
      ${body}
    </div>`;
}

function sectionText(title: string, issues: BriefIssue[], emptyNote: string): string {
  if (issues.length === 0) return `${title}\n  ${emptyNote}`;
  const lines = issues.map((issue) => {
    const meta = issueMetaText(issue);
    return `  - ${issue.title}${meta ? ` (${meta})` : ""}`;
  });
  return [title, ...lines].join("\n");
}

export function buildSeriesBrief(input: BuildSeriesBriefInput): BriefEmail[] {
  const { series, nextMeeting, openIssues, recipients, guestUrl, instanceUrl } =
    input;

  const dateLabel = nextMeeting ? formatMeetingDate(nextMeeting.date) : null;
  const cadence = series.cadence ? `${series.cadence} cadence` : null;
  const metaLine = [dateLabel, cadence].filter(Boolean).join(" · ");

  return recipients.map((email) => {
    const mine = openIssues.filter((issue) =>
      ownerMatchesRecipient(email, {
        ownerName: issue.owner_name,
        ownerEmail: issue.ownerEmail ?? null,
      })
    );
    const mineIds = new Set(mine.map((issue) => issue.id));
    const also = [...openIssues]
      .filter((issue) => !mineIds.has(issue.id))
      .sort(byPriority)
      .slice(0, MAX_ALSO);

    const subject = dateLabel
      ? `Brief: ${series.name} on ${dateLabel}`
      : `Brief: ${series.name}`;

    const bodyHtml =
      (metaLine
        ? `<p style="margin:14px 0 0;color:#6b665f;font-size:14px;line-height:21px;" class="m-muted">${escapeHtml(metaLine)}</p>`
        : "") +
      sectionHtml("Your open items", mine, "You have no open items right now. Nice.") +
      sectionHtml("Also on the log", also, "Nothing else open.");

    const cta = {
      label: "See the live log",
      href: `${guestUrl}?you=${encodeURIComponent(email)}`,
    };

    const html = renderEmailLayout({
      preheader: mine.length
        ? `You have ${mine.length} open item${mine.length === 1 ? "" : "s"} before ${series.name}`
        : `Pre-meeting brief for ${series.name}`,
      heading: series.name,
      bodyHtml,
      cta,
      footerNote: "You are on the attendee list for this series.",
      footerUrl: instanceUrl,
    });

    const text = [
      `Brief: ${series.name}`,
      metaLine,
      "",
      sectionText("Your open items", mine, "You have no open items right now. Nice."),
      "",
      sectionText("Also on the log", also, "Nothing else open."),
      "",
      `See the live log: ${cta.href}`,
      "",
      "Sent via Minutia",
    ]
      .filter((line) => line !== undefined)
      .join("\n");

    return { email, subject, html, text };
  });
}
