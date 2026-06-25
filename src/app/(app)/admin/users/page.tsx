"use client";

import { WorkspaceMembers } from "@/components/minutia/workspace-members";

export default function AdminUsersPage() {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="font-display text-lg font-semibold tracking-tight text-ink">
          Workspace members
        </h2>
        <p className="text-sm text-ink-3">
          Invite teammates, manage roles, and revoke pending invitations.
        </p>
      </div>
      <WorkspaceMembers />
    </div>
  );
}
