import type { IssueCategory, IssueStatus, Priority, MeetingStatus, Cadence } from "./types";

export const ISSUE_CATEGORIES = ["action", "decision", "info", "risk", "blocker"] as const;
export const ISSUE_STATUSES = ["open", "in_progress", "pending", "resolved", "dropped"] as const;
export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const MEETING_STATUSES = ["upcoming", "live", "completed"] as const;
export const CADENCES = ["weekly", "biweekly", "monthly", "adhoc"] as const;

export const STATUS_CONFIG: Record<IssueStatus, { label: string; color: string }> = {
  open: { label: "Open", color: "ink" },
  in_progress: { label: "In Progress", color: "accent" },
  pending: { label: "Pending", color: "warn" },
  resolved: { label: "Resolved", color: "success" },
  dropped: { label: "Dropped", color: "ink-3" },
};

export const CATEGORY_CONFIG: Record<
  IssueCategory,
  { label: string; glyph: string; shortcut: string }
> = {
  action: { label: "Action", glyph: "●", shortcut: "a" },
  decision: { label: "Decision", glyph: "◆", shortcut: "d" },
  info: { label: "Info", glyph: "ℹ", shortcut: "i" },
  risk: { label: "Risk", glyph: "▲", shortcut: "r" },
  blocker: { label: "Blocker", glyph: "■", shortcut: "b" },
};

export const PRIORITY_CONFIG: Record<Priority, { label: string; order: number }> = {
  critical: { label: "Critical", order: 0 },
  high: { label: "High", order: 1 },
  medium: { label: "Medium", order: 2 },
  low: { label: "Low", order: 3 },
};
