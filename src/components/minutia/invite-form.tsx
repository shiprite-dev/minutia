"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { UserPlus, Users, Sparkles, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { shouldPromptSeatBilling } from "@/lib/billing/seat-billing";
import { useAiAccess, useUpsellNoticeUrl } from "@/lib/hooks/use-ai-access";
import { resolveUpsellCta } from "@/lib/upsell";
import { startUpgrade } from "@/lib/billing/upgrade-actions";
import { parseInviteEmails } from "@/lib/invitations";

interface InviteFormProps {
  organizationName?: string;
  /** Invite from a series: the invitee also joins it. */
  seriesId?: string;
  defaultEmails?: string;
  allowRoleChoice?: boolean;
  onInvited?: () => Promise<void> | void;
}

type InviteLink = { email: string; url: string };

export function InviteForm({
  organizationName,
  seriesId,
  defaultEmails = "",
  allowRoleChoice = false,
  onInvited,
}: InviteFormProps) {
  // has_full_access entitlement (resolves to true when feature gating is off,
  // the self-host default). A free, gated workspace stays solo: inviting is
  // blocked until upgraded. The server route is the real enforcement, and its
  // upgrade-required answer lands in the same state.
  const { data: entitlement } = useAiAccess();
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const canInvite = entitlement?.hasAccess !== false && !upgradeRequired;
  // Upgrade destination for the invite CTA (only when gating is on): an in-app
  // checkout when configured, else an external link, else no button.
  const { data: upsell } = useUpsellNoticeUrl("capacity");
  const upsellCta = resolveUpsellCta(upsell?.ctaUrl);
  const [upgradePending, setUpgradePending] = useState(false);
  const [upgradeError, setUpgradeError] = useState(false);

  const [inviteEmail, setInviteEmail] = useState(defaultEmails);
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviteState, setInviteState] = useState<
    "idle" | "loading" | "sent" | "error"
  >("idle");
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([]);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [pendingInvite, setPendingInvite] = useState(false);

  async function handleUpgrade() {
    if (upgradePending) return;
    setUpgradePending(true);
    setUpgradeError(false);
    const ok = await startUpgrade();
    // On success the browser navigates away; only reset on failure.
    if (!ok) {
      setUpgradePending(false);
      setUpgradeError(true);
    }
  }

  async function submitInvite() {
    setInviteState("loading");
    setInviteMessage("");
    setInviteLinks([]);
    setCopiedLink(null);

    const links: InviteLink[] = [];
    let sent = 0;
    for (const email of parseInviteEmails(inviteEmail)) {
      const res = await fetch("/api/admin/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          role: inviteRole,
          ...(seriesId ? { series_id: seriesId } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.code === "INVITE_UPGRADE_REQUIRED") {
        setUpgradeRequired(true);
        setInviteState("idle");
        return;
      }
      if (!res.ok) {
        setInviteState("error");
        setInviteMessage(
          `${email}: ${data.error || "Failed to send invitation."}`,
        );
        setInviteLinks(links);
        if (sent > 0) await onInvited?.();
        return;
      }
      sent += 1;
      if (data.delivery === "link" && data.acceptUrl)
        links.push({ email, url: data.acceptUrl });
    }

    setInviteState("sent");
    setInviteEmail("");
    setInviteLinks(links);
    if (links.length < sent)
      setInviteMessage(
        sent > 1 ? `Invitation sent to ${sent} people.` : "Invitation sent.",
      );
    await onInvited?.();
  }

  async function copyInviteLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API unavailable (e.g. headless browser)
    }
    setCopiedLink(url);
    setTimeout(() => setCopiedLink(null), 2000);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (shouldPromptSeatBilling()) {
      setPendingInvite(true);
      return;
    }
    await submitInvite();
  }

  if (!canInvite) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/60 bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Users className="size-4" />
          </span>
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-ink">
              Bring your team into {organizationName ?? "this workspace"}
            </p>
            <p className="text-xs text-ink-3">
              This workspace is solo right now. Upgrade to invite teammates and
              assign work across your meetings.
            </p>
            {upgradeError && (
              <p className="text-xs text-danger">
                Could not start the upgrade. Please try again.
              </p>
            )}
          </div>
        </div>
        {upsell?.upgradeEnabled ? (
          <Button
            size="sm"
            className="shrink-0"
            onClick={handleUpgrade}
            loading={upgradePending}
          >
            {!upgradePending && <Sparkles className="size-3.5" />}
            {upgradePending ? "Starting" : "Upgrade workspace"}
          </Button>
        ) : upsellCta ? (
          <Button asChild size="sm" className="shrink-0">
            <a href={upsellCta.href} target="_blank" rel="noopener noreferrer">
              <Sparkles className="size-3.5" />
              {upsellCta.label}
            </a>
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <form
        onSubmit={handleInvite}
        className={cn(
          "grid gap-3 sm:items-end",
          allowRoleChoice
            ? "sm:grid-cols-[minmax(0,1fr)_9rem_auto]"
            : "sm:grid-cols-[minmax(0,1fr)_auto]",
        )}
      >
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Invite by email</Label>
          <Input
            id="invite-email"
            type="email"
            multiple
            placeholder="teammate@company.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
        </div>
        {allowRoleChoice && (
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select
              value={inviteRole}
              onValueChange={(value) =>
                setInviteRole(value as "member" | "admin")
              }
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
        )}
        <Button
          type="submit"
          size="sm"
          disabled={inviteState === "loading" || !inviteEmail.trim()}
        >
          <UserPlus className="size-3.5" />
          {inviteState === "loading" ? "Sending" : "Invite"}
        </Button>
      </form>
      {inviteMessage && (
        <p
          className={cn(
            "text-xs",
            inviteState === "error" ? "text-danger" : "text-success",
          )}
        >
          {inviteMessage}
        </p>
      )}
      {inviteLinks.length > 0 && (
        <div className="space-y-2 rounded-xl border border-dashed border-border/60 bg-muted/30 p-4">
          <p className="text-xs text-ink-3">
            Email isn&apos;t configured on this instance. Share{" "}
            {inviteLinks.length > 1 ? "these invite links" : "this invite link"}{" "}
            directly:
          </p>
          {inviteLinks.map((link) => (
            <div key={link.email} className="flex items-center gap-2">
              <Input
                readOnly
                aria-label={`Invite link for ${link.email}`}
                value={link.url}
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => copyInviteLink(link.url)}
              >
                {copiedLink === link.url ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                {copiedLink === link.url ? "Copied" : "Copy"}
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={pendingInvite}
        onOpenChange={(open) => {
          if (!open) setPendingInvite(false);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Add a seat?</DialogTitle>
            <DialogDescription>
              Adding a member adds a seat to your subscription and updates your
              bill.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingInvite(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                setPendingInvite(false);
                await submitInvite();
              }}
            >
              Add member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
