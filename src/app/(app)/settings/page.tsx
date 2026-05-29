"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useProfile, useUpdateProfile } from "@/lib/hooks/use-profile";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sun,
  Moon,
  Monitor,
  Download,
  Calendar,
  Unplug,
  UserPlus,
  Users,
  Mail,
  UserMinus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIssues } from "@/lib/hooks/use-issues";
import { issuesToCsv, issuesToJson, downloadFile } from "@/lib/export";
import {
  useGoogleCalendarStatus,
  useDisconnectGoogle,
} from "@/lib/hooks/use-google-calendar";

const themeOptions = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

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

export default function SettingsPage() {
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const { theme, setTheme } = useTheme();
  const { data: allIssues } = useIssues();
  const { data: gcalStatus } = useGoogleCalendarStatus();
  const disconnectGoogle = useDisconnectGoogle();

  const [name, setName] = useState("");
  const [nameInitialized, setNameInitialized] = useState(false);
  const [orgAdmin, setOrgAdmin] = useState<OrgAdminData | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviteState, setInviteState] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [inviteMessage, setInviteMessage] = useState("");
  const [memberActionId, setMemberActionId] = useState<string | null>(null);
  const [memberMessage, setMemberMessage] = useState("");
  const [memberMessageState, setMemberMessageState] = useState<"success" | "error">("success");
  const [invitationActionId, setInvitationActionId] = useState<string | null>(null);

  // Sync profile name once loaded
  if (profile?.name && !nameInitialized) {
    setName(profile.name);
    setNameInitialized(true);
  }

  const isDirty = name !== (profile?.name ?? "");
  const isValid = name.trim().length >= 1 && name.length <= 100;

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    updateProfile.mutate({ name: name.trim() });
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteState("loading");
    setInviteMessage("");

    const res = await fetch("/api/admin/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setInviteState("error");
      setInviteMessage(data.error || "Failed to send invitation.");
      return;
    }

    setInviteState("sent");
    setInviteMessage("Invitation sent.");
    setInviteEmail("");
    await refreshOrgAdmin();
  }

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
    setMemberActionId(`remove:${member.user_id}`);
    setMemberMessage("");

    const res = await fetch("/api/admin/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: member.user_id }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setMemberMessageState("error");
      setMemberMessage(data.error || "Failed to remove member.");
      setMemberActionId(null);
      return;
    }

    setMemberMessageState("success");
    setMemberMessage(`${email} was removed.`);
    setMemberActionId(null);
    await refreshOrgAdmin();
  }

  async function handleRevokeInvitation(invitationId: string) {
    setInvitationActionId(invitationId);
    setInviteMessage("");

    const res = await fetch("/api/admin/invitations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: invitationId }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setInviteState("error");
      setInviteMessage(data.error || "Failed to revoke invitation.");
      setInvitationActionId(null);
      return;
    }

    setInviteState("sent");
    setInviteMessage("Invitation revoked.");
    setInvitationActionId(null);
    await refreshOrgAdmin();
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-4">
        <p className="text-sm text-ink-3">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="mx-auto w-full max-w-lg space-y-6">
        {/* Profile */}
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your display name and account details.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Display name</Label>
                <Input
                  id="name"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                {name.length > 0 && !isValid && (
                  <p className="text-xs text-danger">
                    Name must be between 1 and 100 characters.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Email</Label>
                <p className="text-sm text-ink-2">{profile?.email}</p>
              </div>

              <Button
                type="submit"
                size="sm"
                className="self-start"
                disabled={updateProfile.isPending || !isDirty || !isValid}
              >
                {updateProfile.isPending ? "Saving..." : "Save"}
              </Button>

              {updateProfile.isSuccess && (
                <p className="text-xs text-success">Profile updated.</p>
              )}
            </form>
          </CardContent>
        </Card>

        {orgAdmin && (
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
              <form onSubmit={handleInvite} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="invite-email">Invite by email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="teammate@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select
                    value={inviteRole}
                    onValueChange={(value) => setInviteRole(value as "member" | "admin")}
                  >
                    <SelectTrigger aria-label="Invitation role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" size="sm" disabled={inviteState === "loading" || !inviteEmail}>
                  <UserPlus className="size-3.5" />
                  {inviteState === "loading" ? "Sending" : "Invite"}
                </Button>
              </form>
              {inviteMessage && (
                <p className={cn("text-xs", inviteState === "error" ? "text-danger" : "text-success")}>
                  {inviteMessage}
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
                          onClick={() => handleRevokeInvitation(invite.id)}
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
        )}

        {/* Appearance */}
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>
              Choose how Minutia looks for you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              {themeOptions.map((option) => (
                <Button
                  key={option.value}
                  variant={theme === option.value ? "outline" : "ghost"}
                  size="sm"
                  onClick={() => setTheme(option.value)}
                  className={cn(
                    "gap-1.5",
                    theme === option.value &&
                      "border-rule-strong bg-paper-2 text-ink"
                  )}
                >
                  <option.icon className="size-3.5" />
                  {option.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Connected accounts */}
        <Card>
          <CardHeader>
            <CardTitle>Connected accounts</CardTitle>
            <CardDescription>
              Link external services to enhance your workflow.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center size-9 rounded-lg bg-paper-2">
                  <Calendar className="size-4 text-ink-2" />
                </div>
                <div>
                  <p className="text-sm font-medium text-ink">Google Calendar</p>
                  {gcalStatus?.connected ? (
                    <p className="text-xs text-ink-3">{gcalStatus.googleEmail}</p>
                  ) : (
                    <p className="text-xs text-ink-3">
                      Show real meeting times on your dashboard.
                    </p>
                  )}
                </div>
              </div>
              {gcalStatus?.connected ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => disconnectGoogle.mutate()}
                  disabled={disconnectGoogle.isPending}
                >
                  <Unplug className="size-3.5" />
                  {disconnectGoogle.isPending ? "Disconnecting..." : "Disconnect"}
                </Button>
              ) : (
                <Button variant="outline" size="sm" asChild>
                  <a href="/api/auth/google">Connect</a>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Export */}
        <Card>
          <CardHeader>
            <CardTitle>Export data</CardTitle>
            <CardDescription>
              Download all your issues as CSV or JSON.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!allIssues?.length}
                onClick={() => {
                  if (!allIssues) return;
                  downloadFile(
                    issuesToCsv(allIssues),
                    `minutia-issues-${new Date().toISOString().slice(0, 10)}.csv`,
                    "text/csv"
                  );
                }}
              >
                <Download className="size-3.5" />
                Export CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!allIssues?.length}
                onClick={() => {
                  if (!allIssues) return;
                  downloadFile(
                    issuesToJson(allIssues),
                    `minutia-issues-${new Date().toISOString().slice(0, 10)}.json`,
                    "application/json"
                  );
                }}
              >
                <Download className="size-3.5" />
                Export JSON
              </Button>
            </div>
            {allIssues && (
              <p className="mt-2 text-xs text-ink-3">
                {allIssues.length} issues available for export.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
