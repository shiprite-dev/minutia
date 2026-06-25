import type { Issue, Priority } from "@/lib/types";

export type OwnerReminder = {
  ownerUserId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  issues: Issue[];
};

export type ReminderContext = {
  seriesName: string;
  appUrl: string;
};

export type ReminderProfile = { email: string; name: string | null };

const PRIORITY_RANK: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function isOpen(issue: Issue): boolean {
  return issue.status !== "resolved" && issue.status !== "dropped";
}

function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    return byPriority !== 0 ? byPriority : a.issue_number - b.issue_number;
  });
}

export function gatherOwnerReminders(
  issues: Issue[],
  profilesById: Record<string, ReminderProfile>
): OwnerReminder[] {
  const groups = new Map<string, OwnerReminder>();

  for (const issue of issues.filter(isOpen)) {
    let key: string;
    let group: OwnerReminder;

    if (issue.owner_user_id) {
      key = issue.owner_user_id;
      const profile = profilesById[issue.owner_user_id];
      group = groups.get(key) ?? {
        ownerUserId: issue.owner_user_id,
        ownerName: profile?.name ?? issue.owner_name,
        ownerEmail: profile?.email ?? null,
        issues: [],
      };
    } else if (issue.owner_name && issue.owner_name.trim()) {
      key = `name:${issue.owner_name}`;
      group = groups.get(key) ?? {
        ownerUserId: null,
        ownerName: issue.owner_name,
        ownerEmail: null,
        issues: [],
      };
    } else {
      key = "unassigned";
      group = groups.get(key) ?? {
        ownerUserId: null,
        ownerName: null,
        ownerEmail: null,
        issues: [],
      };
    }

    group.issues.push(issue);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => ({ ...group, issues: sortIssues(group.issues) }))
    .sort((a, b) => {
      if (!a.ownerName && b.ownerName) return 1;
      if (a.ownerName && !b.ownerName) return -1;
      return (a.ownerName ?? "").localeCompare(b.ownerName ?? "");
    });
}
