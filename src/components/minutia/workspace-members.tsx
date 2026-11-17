"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm";
import { useProfile } from "@/lib/hooks/use-profile";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Users, Mail, UserMinus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { InviteForm } from "@/components/minutia/invite-form";

type OrgAdminData = {
  organization: { id: string; name: string; slug: string };
  members: {
    user_id: string;
    role: "admin" | "member";
    profiles?:
      | { email?: string; name?: string | null }
      | { email?: string; name?: string | null }[]
      | null;
  }[];
  invitations: {
    id: string;
    email: string;
    role: "admin" | "member";
    status: "pending" | "accepted" | "revoked";
  }[];
};

type OrgMember = OrgAdminData["members"][number];

function memberProfile(member: OrgMember) {
  return Array.isArray(member.profiles)
    ? member.profiles[0]
    : member.profiles;
}

function memberEmail(member: OrgMember) {
  return memberProfile(member)?.email ?? "Unknown email";
}

function memberName(member: OrgMember) {
  return memberProfile(member)?.name || memberEmail(member);
}

function roleMessageArticle(role: "admin" | "member") {
  return role === "admin" ? "an" : "a";
}

export function WorkspaceMembers() {
  const confirm = useConfirm();
  const { data: profile } = useProfile();

  const [orgAdmin, setOrgAdmin] = useState<OrgAdminData | null>(null);
  const [invitationMessage, setInvitationMessage] = useState("");
  const [invitationMessageState, setInvitationMessageState] = useState<"success" | "error">("success");
  const [memberActionId, setMemberActionId] = useState<string | null>(null);
  const [memberMessage, setMemberMessage] = useState("");
  const [memberMessageState, setMemberMessageState] = useState<"success" | "error">("success");
  const [invitationActionId, setInvitationActionId] = useState<string | null>(null);

  async function refreshOrgAdmin() {
    const res = await fetch("/api/admin/invitations");
    if (!res.ok) {
      setOrgAdmin(null);
      return;
    }
    setOrgAdmin(await res.json());
  }

  useEffect(() => {
    let cancelled = false;

    fetch("/api/admin/invitations")
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setOrgAdmin(data);
      })
      .catch(() => {
        if (!cancelled) setOrgAdmin(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleMemberRoleChange(member: OrgMember, role: "admin" | "member") {
    const email = memberEmail(member);
    setMemberActionId(`role:${member.user_id}`);
    setMemberMessage("");

    const res = await fetch("/api/admin/members", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: member.user_id, role }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setMemberMessageState("error");
      setMemberMessage(data.error || "Failed to update role.");
      setMemberActionId(null);
      return;
    }

    setMemberMessageState("success");
    setMemberMessage(`${email} is now ${roleMessageArticle(role)} ${role}.`);
    setMemberActionId(null);
    await refreshOrgAdmin();
  }

  async function handleRemoveMember(member: OrgMember) {
    const email = memberEmail(member);
    if (
      !(await confirm({
        title: "Remove member?",
        description: `${email} will lose access to this workspace.`,
        confirmLabel: "Remove",
        danger: true,
      }))
    )
      return;

    setMemberActionId(`remove:${member.user_id}`);
    setMemberMessage("");

    const res = await fetch("/api/admin/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: member.user_id }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message = data.error || "Failed to remove member.";
      setMemberMessageState("error");
      setMemberMessage(message);
      toast.error(message);
      setMemberActionId(null);
      return;
    }

    setMemberMessageState("success");
    setMemberMessage(`${email} was removed.`);
    setMemberActionId(null);
    await refreshOrgAdmin();
  }

  async function handleRevokeInvitation(invitationId: string, email: string) {
    if (
      !(await confirm({
        title: "Revoke invitation?",
        description: `The invite for ${email} will no longer work.`,
        confirmLabel: "Revoke",
        danger: true,
      }))
    )
      return;

    setInvitationActionId(invitationId);
    setInvitationMessage("");

    const res = await fetch("/api/admin/invitations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: invitationId }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message = data.error || "Failed to revoke invitation.";
      setInvitationMessageState("error");
      setInvitationMessage(message);
      toast.error(message);
      setInvitationActionId(null);
      return;
    }

    setInvitationMessageState("success");
    setInvitationMessage("Invitation revoked.");
    setInvitationActionId(null);
    await refreshOrgAdmin();
  }

  if (!orgAdmin) return null;

  return (
    <Card role="region" aria-labelledby="workspace-access-title">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle id="workspace-access-title">Workspace access</CardTitle>
            <CardDescription>
              Invite teammates into {orgAdmin.organization.name}.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="gap-1.5">
              <Users className="size-3" />
              {orgAdmin.members.length} members
            </Badge>
            <Badge variant="outline" className="gap-1.5">
              <Mail className="size-3" />
              {orgAdmin.invitations.filter((invite) => invite.status === "pending").length} pending
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <InviteForm
          organizationName={orgAdmin.organization.name}
          allowRoleChoice
          onInvited={refreshOrgAdmin}
        />
        {invitationMessage && (
          <p className={cn("text-xs", invitationMessageState === "error" ? "text-danger" : "text-success")}>
            {invitationMessage}
          </p>
        )}

        <section className="space-y-2" aria-labelledby="workspace-members-title">
          <div className="flex items-center justify-between">
            <h3 id="workspace-members-title" className="text-sm font-medium text-ink">
              Members
            </h3>
            <span className="text-xs text-ink-3">Role</span>
          </div>
          <div className="divide-y divide-rule rounded-lg border border-rule">
            {orgAdmin.members.map((member) => {
              const email = memberEmail(member);
              const isCurrentUser = member.user_id === profile?.id;
              const isBusy = memberActionId?.endsWith(member.user_id);
              const canManageMember = !isCurrentUser;

              return (
                <div key={member.user_id} className="grid gap-3 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium text-ink">{memberName(member)}</p>
                      {isCurrentUser && (
                        <Badge variant="secondary" className="h-5">You</Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-ink-3">{email}</p>
                  </div>
                  <Select
                    value={member.role}
                    onValueChange={(value) => handleMemberRoleChange(member, value as "admin" | "member")}
                    disabled={!canManageMember || isBusy}
                  >
                    <SelectTrigger
                      size="sm"
                      aria-label={`Role for ${email}`}
                      className="w-full sm:w-28"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${email} from workspace`}
                    disabled={!canManageMember || isBusy}
                    onClick={() => handleRemoveMember(member)}
                  >
                    <UserMinus className="size-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
          {memberMessage && (
            <p className={cn("text-xs", memberMessageState === "error" ? "text-danger" : "text-success")}>
              {memberMessage}
            </p>
          )}
        </section>

        <section className="space-y-2" aria-labelledby="workspace-invitations-title">
          <div className="flex items-center justify-between">
            <h3 id="workspace-invitations-title" className="text-sm font-medium text-ink">
              Pending invitations
            </h3>
            <span className="text-xs text-ink-3">Status</span>
          </div>
          <div className="divide-y divide-rule rounded-lg border border-rule">
            {orgAdmin.invitations
              .filter((invite) => invite.status === "pending")
              .map((invite) => (
                <div key={invite.id} className="grid gap-3 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{invite.email}</p>
                    <p className="text-xs capitalize text-ink-3">{invite.role} invitation</p>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {invite.status}
                  </Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Revoke invitation for ${invite.email}`}
                    disabled={invitationActionId === invite.id}
                    onClick={() => handleRevokeInvitation(invite.id, invite.email)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            {orgAdmin.invitations.filter((invite) => invite.status === "pending").length === 0 && (
              <div className="p-3 text-sm text-ink-3">No pending invitations.</div>
            )}
          </div>
        </section>
      </CardContent>

    </Card>
  );
}
