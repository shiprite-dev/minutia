import { escapeHtml } from "@/lib/escape-html";
import { renderEmailLayout } from "@/lib/email-layout";
import type { Issue } from "@/lib/types";
import type { OwnerReminder, ReminderContext } from "./gather";

export const MINUTIA_BRANDING = "Sent via Minutia";

function ownerLabel(owner: OwnerReminder): string {
  return owner.ownerName?.trim() || "Unassigned";
}

function issueLine(issue: Issue): string {
  return `${issue.title} (#${issue.issue_number})`;
}

function digestSubject(ctx: ReminderContext): string {
  return `Open items in ${ctx.seriesName}`;
}

function totalIssues(owners: OwnerReminder[]): number {
  return owners.reduce((n, owner) => n + owner.issues.length, 0);
}

// A short, count-aware nudge so the reminder reads as a prompt to act, not just
// a flat list. Reads naturally for both the per-owner email and the full digest.
function leadLine(owners: OwnerReminder[], ctx: ReminderContext): string {
  const n = totalIssues(owners);
  const noun = n === 1 ? "item" : "items";
  return `${n} open ${noun} waiting in ${ctx.seriesName}. A quick nudge keeps them moving:`;
}

function renderMarkdown(owners: OwnerReminder[], ctx: ReminderContext): string {
  const lines = [`# Open items in ${ctx.seriesName}`, "", leadLine(owners, ctx), ""];
  for (const owner of owners) {
    lines.push(`## ${ownerLabel(owner)}`);
    for (const issue of owner.issues) lines.push(`- ${issueLine(issue)}`);
    lines.push("");
  }
  lines.push(`${MINUTIA_BRANDING} - ${ctx.appUrl}`);
  return lines.join("\n");
}

function renderText(owners: OwnerReminder[], ctx: ReminderContext): string {
  const lines = [`Open items in ${ctx.seriesName}`, "", leadLine(owners, ctx), ""];
  for (const owner of owners) {
    lines.push(`${ownerLabel(owner)}:`);
    for (const issue of owner.issues) lines.push(`  - ${issueLine(issue)}`);
    lines.push("");
  }
  lines.push(`${MINUTIA_BRANDING} - ${ctx.appUrl}`);
  return lines.join("\n");
}

function renderHtml(owners: OwnerReminder[], ctx: ReminderContext): string {
  const sections = owners
    .map((owner) => {
      const items = owner.issues
        .map(
          (issue) =>
            `<li style="margin:0 0 5px;color:#171717;font-size:15px;line-height:22px;" class="m-ink">${escapeHtml(issue.title)} (#${issue.issue_number})</li>`
        )
        .join("");
      return `
        <div style="margin-top:20px;">
          <p style="margin:0 0 6px;color:#6b665f;font-size:11px;font-weight:700;line-height:16px;text-transform:uppercase;letter-spacing:.08em;" class="m-muted">${escapeHtml(ownerLabel(owner))}</p>
          <ul style="margin:0;padding-left:18px;">${items}</ul>
        </div>`;
    })
    .join("");

  return renderEmailLayout({
    preheader: leadLine(owners, ctx),
    heading: `Open items in ${ctx.seriesName}`,
    intro: leadLine(owners, ctx),
    bodyHtml: sections,
    cta: { label: "Open in Minutia", href: ctx.appUrl },
    footerUrl: ctx.appUrl,
  });
}

export function formatReminderDigest(owners: OwnerReminder[], ctx: ReminderContext) {
  return {
    subject: digestSubject(ctx),
    markdown: renderMarkdown(owners, ctx),
    text: renderText(owners, ctx),
    html: renderHtml(owners, ctx),
    slackBlocks: buildSlackMessage(owners, ctx).blocks,
  };
}

export function formatOwnerEmail(owner: OwnerReminder, ctx: ReminderContext) {
  return {
    subject: `${ownerLabel(owner)}: open items in ${ctx.seriesName}`,
    text: renderText([owner], ctx),
    html: renderHtml([owner], ctx),
  };
}

export function buildSlackMessage(owners: OwnerReminder[], ctx: ReminderContext) {
  const blocks: unknown[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Open items in ${ctx.seriesName}*` },
    },
  ];

  for (const owner of owners) {
    const text = [
      `*${ownerLabel(owner)}*`,
      ...owner.issues.map((issue) => `• ${issueLine(issue)}`),
    ].join("\n");
    blocks.push({ type: "section", text: { type: "mrkdwn", text } });
  }

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `${MINUTIA_BRANDING} - ${ctx.appUrl}` }],
  });

  return {
    text: `Open items in ${ctx.seriesName} - ${MINUTIA_BRANDING} - ${ctx.appUrl}`,
    blocks,
  };
}

export function buildWebhookPayload(owners: OwnerReminder[], ctx: ReminderContext) {
  return {
    series: ctx.seriesName,
    url: ctx.appUrl,
    branding: MINUTIA_BRANDING,
    owners: owners.map((owner) => ({
      ownerName: owner.ownerName,
      ownerEmail: owner.ownerEmail,
      issues: owner.issues,
    })),
  };
}
