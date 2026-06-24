import { escapeHtml } from "@/lib/escape-html";
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

function renderMarkdown(owners: OwnerReminder[], ctx: ReminderContext): string {
  const lines = [`# Open items in ${ctx.seriesName}`, ""];
  for (const owner of owners) {
    lines.push(`## ${ownerLabel(owner)}`);
    for (const issue of owner.issues) lines.push(`- ${issueLine(issue)}`);
    lines.push("");
  }
  lines.push(`${MINUTIA_BRANDING} - ${ctx.appUrl}`);
  return lines.join("\n");
}

function renderText(owners: OwnerReminder[], ctx: ReminderContext): string {
  const lines = [`Open items in ${ctx.seriesName}`, ""];
  for (const owner of owners) {
    lines.push(`${ownerLabel(owner)}:`);
    for (const issue of owner.issues) lines.push(`  - ${issueLine(issue)}`);
    lines.push("");
  }
  lines.push(`${MINUTIA_BRANDING} - ${ctx.appUrl}`);
  return lines.join("\n");
}

function renderHtml(owners: OwnerReminder[], ctx: ReminderContext): string {
  const parts = [`<h1>Open items in ${escapeHtml(ctx.seriesName)}</h1>`];
  for (const owner of owners) {
    parts.push(`<h2>${escapeHtml(ownerLabel(owner))}</h2>`);
    parts.push("<ul>");
    for (const issue of owner.issues) {
      parts.push(`<li>${escapeHtml(issue.title)} (#${issue.issue_number})</li>`);
    }
    parts.push("</ul>");
  }
  parts.push(
    `<p>${escapeHtml(MINUTIA_BRANDING)} - <a href="${escapeHtml(ctx.appUrl)}">${escapeHtml(ctx.appUrl)}</a></p>`
  );
  return parts.join("\n");
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
