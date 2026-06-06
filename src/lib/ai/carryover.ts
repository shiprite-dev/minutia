import { z } from "zod";
import { getTextFromOpenRouter } from "./ask-series-answer";

// Pure carry-over logic: turn a series' open issues into a ranked, scored
// accountability summary. The AI only narrates this; the numbers are computed
// here so they are deterministic and testable.
const DAY_MS = 86_400_000;
const STALE_DAYS = 30;

export type CarryoverIssue = {
  issue_number: number;
  title: string;
  category: string;
  status: string;
  priority?: string;
  owner_name: string | null;
  due_date: string | null; // YYYY-MM-DD
  created_at: string; // ISO timestamp
};

export type RankedCarryoverIssue = CarryoverIssue & {
  days_open: number;
  overdue: boolean;
};

export type CarryoverSummary = {
  total: number;
  overdue_count: number;
  no_owner_count: number;
  stale_count: number;
  issues: RankedCarryoverIssue[];
};

function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function summarizeCarryover(issues: CarryoverIssue[], today: Date): CarryoverSummary {
  const todayStr = toDateOnly(today);

  const ranked: RankedCarryoverIssue[] = issues.map((issue) => ({
    ...issue,
    overdue: issue.due_date != null && issue.due_date < todayStr,
    days_open: Math.max(
      0,
      Math.floor((today.getTime() - new Date(issue.created_at).getTime()) / DAY_MS)
    ),
  }));

  ranked.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.due_date !== b.due_date) {
      if (a.due_date == null) return 1;
      if (b.due_date == null) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    }
    return b.days_open - a.days_open; // staler first
  });

  return {
    total: ranked.length,
    overdue_count: ranked.filter((issue) => issue.overdue).length,
    no_owner_count: ranked.filter((issue) => !issue.owner_name).length,
    stale_count: ranked.filter((issue) => issue.days_open >= STALE_DAYS).length,
    issues: ranked,
  };
}

const briefingSchema = z.object({
  briefing_markdown: z.string().default(""),
  overdue_count: z.number().int().min(0).default(0),
  no_owner_count: z.number().int().min(0).default(0),
});

export type CarryoverBriefing = z.infer<typeof briefingSchema>;

export function parseCarryoverBriefing(providerData: unknown): CarryoverBriefing {
  return briefingSchema.parse(JSON.parse(getTextFromOpenRouter(providerData)));
}
