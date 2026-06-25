"use client";

import { useEffect, useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type ConfigMap = Record<string, string | null>;

// smtp_pass is a secret: GET returns "configured" (never the value). We only PUT
// it when the admin types a NEW value, so the placeholder reflects current state
// without ever rendering or overwriting the stored secret.
const TEXT_KEYS = [
  "instance_name",
  "smtp_host",
  "smtp_port",
  "smtp_user",
  "smtp_from",
  "slack_webhook_url",
  "reminder_webhook_url",
] as const;

function field(config: ConfigMap, key: string) {
  return config[key] ?? "";
}

export default function AdminSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [original, setOriginal] = useState<ConfigMap>({});
  const [form, setForm] = useState<ConfigMap>({});
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpPassConfigured, setSmtpPassConfigured] = useState(false);
  const [retroEnabled, setRetroEnabled] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveState, setSaveState] = useState<"success" | "error">("success");

  const [retroSaving, setRetroSaving] = useState(false);
  const [retroMessage, setRetroMessage] = useState("");
  const [retroMessageState, setRetroMessageState] = useState<"success" | "error">("success");

  const [testState, setTestState] = useState<"idle" | "sending">("idle");
  const [testMessage, setTestMessage] = useState("");
  const [testMessageState, setTestMessageState] = useState<"success" | "error">("success");

  useEffect(() => {
    let cancelled = false;

    fetch("/api/admin/config")
      .then(async (res) => (res.ok ? res.json() : {}))
      .then((cfg: ConfigMap) => {
        if (cancelled) return;
        setOriginal(cfg);
        setForm(cfg);
        setSmtpPassConfigured(cfg.smtp_pass === "configured");
        setRetroEnabled(cfg.retro_enabled === "true");
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function setKey(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setSaveMessage("");

    const changed: ConfigMap = {};
    for (const key of TEXT_KEYS) {
      if (field(form, key) !== field(original, key)) {
        changed[key] = field(form, key);
      }
    }
    // Only persist the SMTP password when the admin typed a new value; never
    // overwrite the stored secret with an empty string.
    if (smtpPass.trim().length > 0) {
      changed.smtp_pass = smtpPass;
    }

    if (Object.keys(changed).length === 0) {
      setSaving(false);
      setSaveState("success");
      setSaveMessage("No changes to save.");
      return;
    }

    const res = await fetch("/api/admin/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changed),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setSaveState("error");
      setSaveMessage(data.error || "Failed to save settings.");
      return;
    }

    setOriginal((prev) => ({ ...prev, ...changed }));
    if (changed.smtp_pass) {
      setSmtpPass("");
      setSmtpPassConfigured(true);
    }
    setSaveState("success");
    setSaveMessage("Settings saved.");
  }

  async function handleRetroToggle() {
    const next = !retroEnabled;
    setRetroEnabled(next);
    setRetroSaving(true);
    setRetroMessage("");

    const res = await fetch("/api/admin/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retro_enabled: next ? "true" : "false" }),
    });
    const data = await res.json().catch(() => ({}));

    setRetroSaving(false);
    if (!res.ok) {
      setRetroEnabled(!next);
      setRetroMessageState("error");
      setRetroMessage(data.error || "Failed to update setting.");
    } else {
      setRetroMessageState("success");
      setRetroMessage(next ? "Retro boards enabled." : "Retro boards disabled.");
    }
  }

  async function handleTestEmail() {
    setTestState("sending");
    setTestMessage("");

    const res = await fetch("/api/admin/smtp-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    setTestState("idle");

    if (!res.ok || !data.success) {
      setTestMessageState("error");
      setTestMessage(data.error || "Failed to send test email.");
      return;
    }
    setTestMessageState("success");
    setTestMessage(data.message || "Test email sent.");
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Instance identity</CardTitle>
          <CardDescription>How this Minutia instance presents itself.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="instance_name">Instance name</Label>
            <Input
              id="instance_name"
              placeholder="Minutia"
              value={field(form, "instance_name")}
              onChange={(e) => setKey("instance_name", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email (SMTP)</CardTitle>
          <CardDescription>
            Outbound email for invitations, reminders, and digests.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="smtp_host">SMTP host</Label>
              <Input
                id="smtp_host"
                placeholder="smtp.example.com"
                value={field(form, "smtp_host")}
                onChange={(e) => setKey("smtp_host", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="smtp_port">SMTP port</Label>
              <Input
                id="smtp_port"
                placeholder="587"
                inputMode="numeric"
                value={field(form, "smtp_port")}
                onChange={(e) => setKey("smtp_port", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="smtp_user">SMTP username</Label>
              <Input
                id="smtp_user"
                placeholder="apikey"
                value={field(form, "smtp_user")}
                onChange={(e) => setKey("smtp_user", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="smtp_pass">SMTP password</Label>
              <Input
                id="smtp_pass"
                type="password"
                placeholder={smtpPassConfigured ? "configured (leave blank to keep)" : "Enter a password"}
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="smtp_from">From address</Label>
              <Input
                id="smtp_from"
                type="email"
                placeholder="minutia@example.com"
                value={field(form, "smtp_from")}
                onChange={(e) => setKey("smtp_from", e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={testState === "sending"}
              onClick={handleTestEmail}
            >
              {testState === "sending" ? "Sending..." : "Send test email"}
            </Button>
            {testMessage && (
              <p className={cn("text-xs", testMessageState === "error" ? "text-danger" : "text-success")}>
                {testMessage}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Feature flags</CardTitle>
          <CardDescription>
            Toggle optional surfaces and configure reminder channels.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-ink">Free retro boards</p>
                <p className="text-xs text-ink-3">
                  Opens a public, no-login retrospective board at /retro on this instance.
                </p>
              </div>
              <Button
                type="button"
                variant={retroEnabled ? "outline" : "ghost"}
                size="sm"
                disabled={retroSaving}
                onClick={handleRetroToggle}
                className={cn(retroEnabled && "border-rule-strong bg-paper-2 text-ink")}
              >
                {retroSaving ? "Saving..." : retroEnabled ? "Disable" : "Enable"}
              </Button>
            </div>
            {retroMessage && (
              <p className={cn("text-xs", retroMessageState === "error" ? "text-danger" : "text-success")}>
                {retroMessage}
              </p>
            )}
          </div>

          <div className="grid gap-4 border-t border-rule pt-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="slack_webhook_url">Slack webhook URL</Label>
              <Input
                id="slack_webhook_url"
                placeholder="https://hooks.slack.com/services/..."
                value={field(form, "slack_webhook_url")}
                onChange={(e) => setKey("slack_webhook_url", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reminder_webhook_url">Reminder webhook URL</Label>
              <Input
                id="reminder_webhook_url"
                placeholder="https://example.com/webhooks/minutia"
                value={field(form, "reminder_webhook_url")}
                onChange={(e) => setKey("reminder_webhook_url", e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={saving} onClick={handleSave}>
          {saving ? "Saving..." : "Save changes"}
        </Button>
        {saveMessage && (
          <p className={cn("text-xs", saveState === "error" ? "text-danger" : "text-success")}>
            {saveMessage}
          </p>
        )}
      </div>
    </div>
  );
}
