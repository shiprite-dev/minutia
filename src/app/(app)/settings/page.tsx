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
import { Sun, Moon, Monitor, Download, Calendar, Unplug, UserPlus } from "lucide-react";
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
    profiles?: { email?: string; name?: string | null } | null;
  }[];
  invitations: {
    id: string;
    email: string;
    role: "admin" | "member";
    status: "pending" | "accepted" | "revoked";
  }[];
};

type HostedOrgData = {
  organizations: { id: string; name: string; slug: string; created_at: string }[];
};

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
  const [hostedOrgs, setHostedOrgs] = useState<HostedOrgData | null>(null);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgAdminEmail, setNewOrgAdminEmail] = useState("");
  const [newOrgState, setNewOrgState] = useState<"idle" | "loading" | "created" | "error">("idle");
  const [newOrgMessage, setNewOrgMessage] = useState("");

  // Sync profile name once loaded
  if (profile?.name && !nameInitialized) {
    setName(profile.name);
    setNameInitialized(true);
  }

  const isDirty = name !== (profile?.name ?? "");
  const isValid = name.trim().length >= 1 && name.length <= 100;

  useEffect(() => {
    fetch("/api/admin/invitations")
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then(setOrgAdmin)
      .catch(() => setOrgAdmin(null));

    fetch("/api/admin/organizations")
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then(setHostedOrgs)
      .catch(() => setHostedOrgs(null));
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
    const refreshed = await fetch("/api/admin/invitations").then((r) => r.json());
    setOrgAdmin(refreshed);
  }

  async function handleCreateOrganization(e: React.FormEvent) {
    e.preventDefault();
    setNewOrgState("loading");
    setNewOrgMessage("");

    const res = await fetch("/api/admin/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newOrgName,
        admin_email: newOrgAdminEmail,
      }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setNewOrgState("error");
      setNewOrgMessage(data.error || "Failed to create organization.");
      return;
    }

    setNewOrgState("created");
    setNewOrgMessage("Organization created and admin invited.");
    setNewOrgName("");
    setNewOrgAdminEmail("");
    const refreshed = await fetch("/api/admin/organizations").then((r) => r.json());
    setHostedOrgs(refreshed);
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
          <Card>
            <CardHeader>
              <CardTitle>Workspace access</CardTitle>
              <CardDescription>
                Invite teammates into {orgAdmin.organization.name}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleInvite} className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                <Input
                  type="email"
                  placeholder="teammate@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "member" | "admin")}
                  className="h-10 rounded-md border border-rule bg-paper px-3 text-sm text-ink"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
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
              <div className="space-y-2">
                {orgAdmin.members.map((member) => (
                  <div key={member.user_id} className="flex items-center justify-between border-b border-rule pb-2 text-sm last:border-b-0">
                    <div>
                      <p className="font-medium text-ink">{member.profiles?.name || member.profiles?.email}</p>
                      <p className="text-xs text-ink-3">{member.profiles?.email}</p>
                    </div>
                    <span className="rounded-md bg-paper-2 px-2 py-1 text-xs capitalize text-ink-2">
                      {member.role}
                    </span>
                  </div>
                ))}
                {orgAdmin.invitations
                  .filter((invite) => invite.status === "pending")
                  .map((invite) => (
                    <div key={invite.id} className="flex items-center justify-between border-b border-rule pb-2 text-sm last:border-b-0">
                      <div>
                        <p className="font-medium text-ink">{invite.email}</p>
                        <p className="text-xs text-ink-3">Pending invitation</p>
                      </div>
                      <span className="rounded-md bg-paper-2 px-2 py-1 text-xs capitalize text-ink-2">
                        {invite.role}
                      </span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {hostedOrgs && (
          <Card>
            <CardHeader>
              <CardTitle>Hosted organizations</CardTitle>
              <CardDescription>
                Create isolated customer spaces. Available only in hosted mode.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleCreateOrganization} className="grid gap-3">
                <Input
                  placeholder="Organization name"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                />
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <Input
                    type="email"
                    placeholder="admin@customer.com"
                    value={newOrgAdminEmail}
                    onChange={(e) => setNewOrgAdminEmail(e.target.value)}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={newOrgState === "loading" || !newOrgName || !newOrgAdminEmail}
                  >
                    <UserPlus className="size-3.5" />
                    {newOrgState === "loading" ? "Creating" : "Create"}
                  </Button>
                </div>
              </form>
              {newOrgMessage && (
                <p className={cn("text-xs", newOrgState === "error" ? "text-danger" : "text-success")}>
                  {newOrgMessage}
                </p>
              )}
              <div className="space-y-2">
                {hostedOrgs.organizations.map((organization) => (
                  <div key={organization.id} className="flex items-center justify-between border-b border-rule pb-2 text-sm last:border-b-0">
                    <div>
                      <p className="font-medium text-ink">{organization.name}</p>
                      <p className="text-xs text-ink-3">{organization.slug}</p>
                    </div>
                  </div>
                ))}
              </div>
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
