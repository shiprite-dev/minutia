import type { Issue, Profile } from "./types";

export function isIssueAssignedToProfile(issue: Issue, profile: Profile) {
  if (issue.owner_user_id === profile.id) return true;

  const ownerName = issue.owner_name?.trim().toLowerCase();
  if (!ownerName) return false;

  return (
    ownerName === profile.email.toLowerCase() ||
    ownerName === profile.name?.trim().toLowerCase()
  );
}

export function isMyActionIssue(issue: Issue, profile: Profile) {
  return issue.category !== "info" && isIssueAssignedToProfile(issue, profile);
}
