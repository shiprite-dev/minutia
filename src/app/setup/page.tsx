"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Server,
  ShieldCheck,
  Settings2,
  Rocket,
  Mail,
  AlertTriangle,
  Loader2,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const TOTAL_STEPS = 4;

const stepMeta = [
  { label: "Environment", icon: Server },
  { label: "Admin Account", icon: ShieldCheck },
  { label: "Configure", icon: Settings2 },
  { label: "Ready", icon: Rocket },
];

const variants = {
  enter: (d: number) => ({ x: d > 0 ? 80 : -80, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (d: number) => ({ x: d > 0 ? -80 : 80, opacity: 0 }),
};

interface EnvCheck {
  env: {
    jwt_secret: string;
    anon_key: string;
    service_role_key: string;
    site_url: string;
    smtp_configured: boolean;
    ai_configured: boolean;
    google_configured: boolean;
  };
  db: { connected: boolean; latency_ms: number };
  services: { auth: string; rest: string };
}

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [direction, setDirection] = React.useState(1);

  const [envCheck, setEnvCheck] = React.useState<EnvCheck | null>(null);
  const [envLoading, setEnvLoading] = React.useState(true);
  const [envError, setEnvError] = React.useState<string | null>(null);

  const [adminEmail, setAdminEmail] = React.useState("");
  const [adminPassword, setAdminPassword] = React.useState("");
  const [adminPasswordConfirm, setAdminPasswordConfirm] = React.useState("");
  const [adminName, setAdminName] = React.useState("");
  const [adminCreating, setAdminCreating] = React.useState(false);
  const [adminCreated, setAdminCreated] = React.useState(false);
  const [adminError, setAdminError] = React.useState<string | null>(null);

  const [instanceName, setInstanceName] = React.useState("Minutia");
  const [smtpHost, setSmtpHost] = React.useState("");
  const [smtpPort, setSmtpPort] = React.useState("587");
  const [smtpUser, setSmtpUser] = React.useState("");
  const [smtpPass, setSmtpPass] = React.useState("");
  const [smtpTesting, setSmtpTesting] = React.useState(false);
  const [smtpTestResult, setSmtpTestResult] = React.useState<{ success: boolean; message: string } | null>(null);
  const [configSaving, setConfigSaving] = React.useState(false);

  const [seedDemo, setSeedDemo] = React.useState(true);
  const [completing, setCompleting] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((data) => {
        if (data.setup_completed) {
          router.replace("/");
          return;
        }
        runEnvCheck();
      })
      .catch(() => runEnvCheck());
  }, [router]);

  async function runEnvCheck() {
    setEnvLoading(true);
    setEnvError(null);
    try {
      const res = await fetch("/api/setup/check-env");
      if (!res.ok) throw new Error("Health check failed");
      const data = await res.json();
      setEnvCheck(data);
    } catch (err) {
      setEnvError(err instanceof Error ? err.message : "Failed to check environment");
    } finally {
      setEnvLoading(false);
    }
  }

  function goNext() {
    setDirection(1);
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }

  const envReady =
    envCheck &&
    envCheck.env.jwt_secret === "ok" &&
    envCheck.env.anon_key === "ok" &&
    envCheck.env.service_role_key === "ok" &&
    envCheck.db.connected;

  async function handleCreateAdmin() {
    setAdminCreating(true);
    setAdminError(null);
    try {
      const res = await fetch("/api/setup/create-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: adminEmail, password: adminPassword, name: adminName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create admin");
      setAdminCreated(true);
      setTimeout(goNext, 600);
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setAdminCreating(false);
    }
  }

  async function handleTestSmtp() {
    setSmtpTesting(true);
    setSmtpTestResult(null);
    try {
      await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smtp_host: smtpHost,
          smtp_port: smtpPort,
          smtp_user: smtpUser,
          smtp_pass: smtpPass,
        }),
      });

      const res = await fetch("/api/admin/smtp-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient_email: adminEmail }),
      });
      const data = await res.json();
      setSmtpTestResult({ success: data.success, message: data.message || data.error });
    } catch {
      setSmtpTestResult({ success: false, message: "Request failed" });
    } finally {
      setSmtpTesting(false);
    }
  }

  async function handleSaveConfig() {
    setConfigSaving(true);
    try {
      await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instance_name: instanceName,
          ...(smtpHost ? { smtp_host: smtpHost, smtp_port: smtpPort, smtp_user: smtpUser, smtp_pass: smtpPass } : {}),
        }),
      });
      goNext();
    } catch {
      // continue anyway
      goNext();
    } finally {
      setConfigSaving(false);
    }
  }

  async function handleComplete() {
    setCompleting(true);
    try {
      if (seedDemo) {
        await fetch("/api/setup/seed-demo", { method: "POST" });
      }
      await fetch("/api/setup/complete", { method: "POST" });
      router.push("/login");
    } catch {
      router.push("/login");
    }
  }

  const passwordsMatch = adminPassword === adminPasswordConfirm;
  const passwordValid = adminPassword.length >= 8;
  const adminFormValid =
    adminEmail.includes("@") && passwordValid && passwordsMatch && adminName.trim().length >= 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-paper">
      <div className="w-full max-w-lg px-6">
        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {stepMeta.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all",
                  i === step
                    ? "bg-accent/10 text-accent"
                    : i < step
                      ? "bg-accent/5 text-accent/60"
                      : "text-ink-4"
                )}
              >
                {i < step ? (
                  <CheckCircle2 className="size-3.5" />
                ) : (
                  <s.icon className="size-3.5" />
                )}
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {i < TOTAL_STEPS - 1 && (
                <div className={cn("w-6 h-px", i < step ? "bg-accent/30" : "bg-rule")} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="relative overflow-hidden rounded-2xl border border-rule bg-card p-8 min-h-[420px]">
          <AnimatePresence mode="wait" custom={direction}>
            {step === 0 && (
              <motion.div
                key="step-0"
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <StepEnvironment
                  envCheck={envCheck}
                  loading={envLoading}
                  error={envError}
                  ready={!!envReady}
                  onRetry={runEnvCheck}
                  onNext={goNext}
                />
              </motion.div>
            )}

            {step === 1 && (
              <motion.div
                key="step-1"
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <StepCreateAdmin
                  email={adminEmail}
                  onEmailChange={setAdminEmail}
                  password={adminPassword}
                  onPasswordChange={setAdminPassword}
                  passwordConfirm={adminPasswordConfirm}
                  onPasswordConfirmChange={setAdminPasswordConfirm}
                  name={adminName}
                  onNameChange={setAdminName}
                  formValid={adminFormValid}
                  passwordsMatch={passwordsMatch}
                  creating={adminCreating}
                  created={adminCreated}
                  error={adminError}
                  onSubmit={handleCreateAdmin}
                />
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step-2"
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <StepConfigure
                  instanceName={instanceName}
                  onInstanceNameChange={setInstanceName}
                  smtpHost={smtpHost}
                  onSmtpHostChange={setSmtpHost}
                  smtpPort={smtpPort}
                  onSmtpPortChange={setSmtpPort}
                  smtpUser={smtpUser}
                  onSmtpUserChange={setSmtpUser}
                  smtpPass={smtpPass}
                  onSmtpPassChange={setSmtpPass}
                  smtpTesting={smtpTesting}
                  smtpTestResult={smtpTestResult}
                  onTestSmtp={handleTestSmtp}
                  saving={configSaving}
                  onNext={handleSaveConfig}
                  onSkip={goNext}
                />
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step-3"
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <StepReady
                  seedDemo={seedDemo}
                  onSeedDemoChange={setSeedDemo}
                  completing={completing}
                  onComplete={handleComplete}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 0: Environment Check
// ---------------------------------------------------------------------------

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <div className={cn("size-2 rounded-full", ok ? "bg-success" : "bg-danger")} />
  );
}

function StepEnvironment({
  envCheck,
  loading,
  error,
  ready,
  onRetry,
  onNext,
}: {
  envCheck: EnvCheck | null;
  loading: boolean;
  error: string | null;
  ready: boolean;
  onRetry: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
          className="inline-flex items-center justify-center size-12 rounded-full bg-accent/10 mb-4"
        >
          <span className="font-display text-xl font-bold text-accent">m</span>
        </motion.div>
        <h2 className="font-display text-xl font-semibold text-ink">
          Instance Setup
        </h2>
        <p className="text-sm text-ink-3 mt-1">
          Checking your environment before getting started.
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-ink-3" />
          <span className="ml-2 text-sm text-ink-3">Checking services...</span>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-danger/20 bg-danger/5 p-3">
          <p className="text-sm text-danger">{error}</p>
          <Button variant="ghost" size="sm" onClick={onRetry} className="mt-2 text-danger">
            Retry
          </Button>
        </div>
      )}

      {envCheck && !loading && (
        <div className="space-y-2">
          <CheckRow label="JWT Secret" ok={envCheck.env.jwt_secret === "ok"} detail={envCheck.env.jwt_secret === "weak" ? "Too short (min 32 chars)" : undefined} />
          <CheckRow label="Anon Key" ok={envCheck.env.anon_key === "ok"} />
          <CheckRow label="Service Role Key" ok={envCheck.env.service_role_key === "ok"} />
          <CheckRow label="Database" ok={envCheck.db.connected} detail={envCheck.db.connected ? `${envCheck.db.latency_ms}ms` : "Unreachable"} icon={Database} />
          <CheckRow label="Auth Service" ok={envCheck.services.auth === "healthy"} icon={ShieldCheck} />
          <CheckRow label="REST API" ok={envCheck.services.rest === "healthy"} icon={Server} />

          <div className="border-t border-rule pt-2 mt-3">
            <p className="text-[11px] text-ink-4 mb-1">Optional services</p>
            <div className="flex flex-wrap gap-3">
              <OptionalBadge label="SMTP" configured={envCheck.env.smtp_configured} />
              <OptionalBadge label="AI" configured={envCheck.env.ai_configured} />
              <OptionalBadge label="Google OAuth" configured={envCheck.env.google_configured} />
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button variant="ghost" onClick={onRetry} disabled={loading} className="text-ink-3">
          Re-check
        </Button>
        <Button
          onClick={onNext}
          disabled={!ready}
          className="flex-1 h-11 rounded-xl bg-accent text-white hover:bg-accent-hover"
        >
          Continue
          <ArrowRight className="size-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

function CheckRow({
  label,
  ok,
  detail,
  icon: Icon,
}: {
  label: string;
  ok: boolean;
  detail?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-rule px-3 py-2.5">
      {Icon ? <Icon className="size-4 text-ink-3" /> : <Circle className="size-4 text-ink-4" />}
      <span className="text-sm text-ink flex-1">{label}</span>
      {detail && <span className="text-xs text-ink-4">{detail}</span>}
      <StatusDot ok={ok} />
    </div>
  );
}

function OptionalBadge({ label, configured }: { label: string; configured: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] font-medium",
        configured ? "bg-success/10 text-success" : "bg-paper-2 text-ink-4"
      )}
    >
      {label}: {configured ? "Yes" : "No"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Create Admin Account
// ---------------------------------------------------------------------------

function StepCreateAdmin({
  email,
  onEmailChange,
  password,
  onPasswordChange,
  passwordConfirm,
  onPasswordConfirmChange,
  name,
  onNameChange,
  formValid,
  passwordsMatch,
  creating,
  created,
  error,
  onSubmit,
}: {
  email: string;
  onEmailChange: (v: string) => void;
  password: string;
  onPasswordChange: (v: string) => void;
  passwordConfirm: string;
  onPasswordConfirmChange: (v: string) => void;
  name: string;
  onNameChange: (v: string) => void;
  formValid: boolean;
  passwordsMatch: boolean;
  creating: boolean;
  created: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">
          Create admin account
        </h2>
        <p className="text-sm text-ink-3 mt-1">
          This account will manage your Minutia instance.
        </p>
      </div>

      {created ? (
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="flex flex-col items-center justify-center py-8 gap-3"
        >
          <CheckCircle2 className="size-10 text-success" />
          <p className="text-sm font-medium text-ink">Admin account created</p>
        </motion.div>
      ) : (
        <>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="admin-name" className="text-ink-2">Display name</Label>
              <Input
                id="admin-name"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Your name"
                autoFocus
                className="h-10 rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="admin-email" className="text-ink-2">Email</Label>
              <Input
                id="admin-email"
                type="email"
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                placeholder="admin@yourcompany.com"
                className="h-10 rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="admin-password" className="text-ink-2">Password</Label>
              <Input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                placeholder="Min 8 characters"
                className="h-10 rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="admin-password-confirm" className="text-ink-2">Confirm password</Label>
              <Input
                id="admin-password-confirm"
                type="password"
                value={passwordConfirm}
                onChange={(e) => onPasswordConfirmChange(e.target.value)}
                placeholder="Repeat password"
                className="h-10 rounded-xl"
              />
              {passwordConfirm && !passwordsMatch && (
                <p className="text-xs text-danger">Passwords do not match</p>
              )}
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger/5 p-3">
              <AlertTriangle className="size-4 text-danger mt-0.5 shrink-0" />
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          <Button
            onClick={onSubmit}
            disabled={!formValid || creating}
            className="w-full h-11 rounded-xl bg-accent text-white hover:bg-accent-hover"
          >
            {creating ? (
              <>
                <Loader2 className="size-4 mr-1.5 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                Create admin
                <ArrowRight className="size-4 ml-1" />
              </>
            )}
          </Button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Configure Instance
// ---------------------------------------------------------------------------

function StepConfigure({
  instanceName,
  onInstanceNameChange,
  smtpHost,
  onSmtpHostChange,
  smtpPort,
  onSmtpPortChange,
  smtpUser,
  onSmtpUserChange,
  smtpPass,
  onSmtpPassChange,
  smtpTesting,
  smtpTestResult,
  onTestSmtp,
  saving,
  onNext,
  onSkip,
}: {
  instanceName: string;
  onInstanceNameChange: (v: string) => void;
  smtpHost: string;
  onSmtpHostChange: (v: string) => void;
  smtpPort: string;
  onSmtpPortChange: (v: string) => void;
  smtpUser: string;
  onSmtpUserChange: (v: string) => void;
  smtpPass: string;
  onSmtpPassChange: (v: string) => void;
  smtpTesting: boolean;
  smtpTestResult: { success: boolean; message: string } | null;
  onTestSmtp: () => void;
  saving: boolean;
  onNext: () => void;
  onSkip: () => void;
}) {
  const smtpFilled = smtpHost.trim().length > 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">
          Configure your instance
        </h2>
        <p className="text-sm text-ink-3 mt-1">
          All settings are optional and can be changed later in admin settings.
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="instance-name" className="text-ink-2">Instance name</Label>
          <Input
            id="instance-name"
            value={instanceName}
            onChange={(e) => onInstanceNameChange(e.target.value)}
            placeholder="Minutia"
            className="h-10 rounded-xl"
          />
        </div>

        <div className="border-t border-rule pt-3">
          <div className="flex items-center gap-2 mb-2">
            <Mail className="size-4 text-ink-3" />
            <span className="text-sm font-medium text-ink">Email (SMTP)</span>
            <span className="text-[10px] text-ink-4 ml-auto">Optional</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="smtp-host" className="text-xs text-ink-3">Host</Label>
              <Input id="smtp-host" value={smtpHost} onChange={(e) => onSmtpHostChange(e.target.value)} placeholder="smtp.gmail.com" className="h-9 rounded-lg text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="smtp-port" className="text-xs text-ink-3">Port</Label>
              <Input id="smtp-port" value={smtpPort} onChange={(e) => onSmtpPortChange(e.target.value)} placeholder="587" className="h-9 rounded-lg text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="smtp-user" className="text-xs text-ink-3">Username</Label>
              <Input id="smtp-user" value={smtpUser} onChange={(e) => onSmtpUserChange(e.target.value)} placeholder="user@gmail.com" className="h-9 rounded-lg text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="smtp-pass" className="text-xs text-ink-3">Password</Label>
              <Input id="smtp-pass" type="password" value={smtpPass} onChange={(e) => onSmtpPassChange(e.target.value)} placeholder="App password" className="h-9 rounded-lg text-sm" />
            </div>
          </div>

          {smtpFilled && (
            <div className="mt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onTestSmtp}
                disabled={smtpTesting}
                className="text-xs"
              >
                {smtpTesting ? (
                  <>
                    <Loader2 className="size-3 mr-1 animate-spin" />
                    Testing...
                  </>
                ) : (
                  "Send test email"
                )}
              </Button>
              {smtpTestResult && (
                <p className={cn("text-xs mt-1.5", smtpTestResult.success ? "text-success" : "text-danger")}>
                  {smtpTestResult.message}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-3 pt-1">
        <Button variant="ghost" onClick={onSkip} className="text-ink-3">
          Skip for now
        </Button>
        <Button
          onClick={onNext}
          disabled={saving}
          className="flex-1 h-11 rounded-xl bg-accent text-white hover:bg-accent-hover"
        >
          {saving ? (
            <>
              <Loader2 className="size-4 mr-1.5 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              Save & continue
              <ArrowRight className="size-4 ml-1" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Ready
// ---------------------------------------------------------------------------

function StepReady({
  seedDemo,
  onSeedDemoChange,
  completing,
  onComplete,
}: {
  seedDemo: boolean;
  onSeedDemoChange: (v: boolean) => void;
  completing: boolean;
  onComplete: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
          className="inline-flex items-center justify-center size-14 rounded-full bg-success/10 mb-4"
        >
          <CheckCircle2 className="size-7 text-success" />
        </motion.div>
        <h2 className="font-display text-xl font-semibold text-ink">
          Your instance is ready
        </h2>
        <p className="text-sm text-ink-3 mt-1">
          You can start tracking meeting issues right away.
        </p>
      </div>

      <label className="flex items-start gap-3 rounded-lg border border-rule p-3 cursor-pointer hover:bg-paper-2 transition-colors">
        <input
          type="checkbox"
          checked={seedDemo}
          onChange={(e) => onSeedDemoChange(e.target.checked)}
          className="mt-0.5 size-4 rounded border-rule text-accent focus:ring-accent"
        />
        <div>
          <p className="text-sm font-medium text-ink">Seed demo data</p>
          <p className="text-xs text-ink-3 mt-0.5">
            Create a sample meeting series with 5 issues to explore the interface.
          </p>
        </div>
      </label>

      <div className="space-y-2">
        {[
          "Admin account created with full instance access",
          "Instance settings can be changed anytime from admin panel",
          "Invite team members after signing in",
        ].map((text, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.08, duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
            className="flex items-center gap-2.5 text-sm text-ink-2"
          >
            <CheckCircle2 className="size-4 text-success shrink-0" />
            {text}
          </motion.div>
        ))}
      </div>

      <Button
        onClick={onComplete}
        disabled={completing}
        className="w-full h-11 rounded-xl bg-accent text-white hover:bg-accent-hover"
      >
        {completing ? (
          <>
            <Loader2 className="size-4 mr-1.5 animate-spin" />
            Finishing setup...
          </>
        ) : (
          <>
            Go to dashboard
            <Rocket className="size-4 ml-1" />
          </>
        )}
      </Button>
    </div>
  );
}
