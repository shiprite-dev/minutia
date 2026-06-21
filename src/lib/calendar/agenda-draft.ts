import type { IssueCategory } from "../types";

// Parses a calendar event description into draft agenda items. Pure, regex-based,
// no AI. A line becomes a draft only when it carries a list marker (bullet,
// number, checkbox) or an explicit "Label:" prefix; plain prose is left alone so
// we never draft from a meeting's descriptive blurb.

export type AgendaDraft = {
  title: string;
  category: IssueCategory;
};

export const MAX_AGENDA_DRAFTS = 25;
const MAX_TITLE_LENGTH = 500;

// "Label:" prefixes (colon required) that map a line to a category.
const LABELS: { pattern: RegExp; category: IssueCategory }[] = [
  { pattern: /^(?:action items?|actions?|to-?dos?)\s*:\s*/i, category: "action" },
  { pattern: /^(?:decisions?|decided|decide)\s*:\s*/i, category: "decision" },
  { pattern: /^(?:blockers?)\s*:\s*/i, category: "blocker" },
  { pattern: /^(?:risks?)\s*:\s*/i, category: "risk" },
  { pattern: /^(?:discussions?|discuss|topics?|agenda)\s*:\s*/i, category: "info" },
];

// Google Calendar descriptions are often lightweight HTML. Flatten the few tags
// that carry structure into newlines/bullets, then drop the rest.
function normalizeHtml(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\s*\/\s*(?:li|p|div|h[1-6]|tr|ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"');
}

function parseLine(raw: string): AgendaDraft | null {
  let text = raw.trim();
  if (!text) return null;

  let hasMarker = false;

  // Strip a leading bullet or numbered-list marker.
  const listMarker = text.match(/^(?:[-*•]|\d+[.)])\s+/);
  if (listMarker) {
    hasMarker = true;
    text = text.slice(listMarker[0].length).trim();
  }

  // Strip a checkbox marker, which may follow a list marker ("1. [ ] ...").
  let isCheckbox = false;
  const checkbox = text.match(/^(?:[-*•]\s*)?\[\s*([xX ]?)\s*\]\s*/);
  if (checkbox) {
    if (/[xX]/.test(checkbox[1])) return null; // pre-completed item, nothing to track
    hasMarker = true;
    isCheckbox = true;
    text = text.slice(checkbox[0].length).trim();
  }

  let category: IssueCategory | null = null;
  for (const { pattern, category: labelCategory } of LABELS) {
    const match = text.match(pattern);
    if (match) {
      category = labelCategory;
      text = text.slice(match[0].length).trim();
      break;
    }
  }

  if (!hasMarker && category === null) return null; // plain prose

  const title = text.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH);
  if (!title) return null;

  return { title, category: category ?? (isCheckbox ? "action" : "info") };
}

export function parseAgendaDrafts(description: string | null | undefined): AgendaDraft[] {
  if (!description) return [];

  const drafts: AgendaDraft[] = [];
  const seen = new Set<string>();

  for (const raw of normalizeHtml(description).split("\n")) {
    const draft = parseLine(raw);
    if (!draft) continue;

    const key = draft.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    drafts.push(draft);
    if (drafts.length >= MAX_AGENDA_DRAFTS) break;
  }

  return drafts;
}
