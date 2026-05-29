"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { ArrowRight, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type InviteState = "loading" | "ready" | "saving" | "error";

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  );
}

function AcceptInviteForm() {
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<InviteState>("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const code = searchParams.get("code");
  const nextPath = getSafeNext(searchParams.get("next"));
  const passwordsMatch = passwordConfirm.length === 0 || password === passwordConfirm;
  const canSubmit =
    state === "ready" &&
    email.length > 0 &&
    password.length >= 8 &&
    password === passwordConfirm;

  useEffect(() => {
    let cancelled = false;

    async function loadInviteSession() {
      setState("loading");
      setErrorMessage("");

      try {
        const hash = new URLSearchParams(
          typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, "")
        );
        const hashError = hash.get("error_description") || hash.get("error");

        if (hashError) {
          throw new Error(hashError);
        }

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          const accessToken = hash.get("access_token");
          const refreshToken = hash.get("refresh_token");

          if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (error) throw error;

            window.history.replaceState(
              {},
              "",
              `${window.location.pathname}${window.location.search}`
            );
          }
        }

        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();

        if (error || !user?.email) {
          throw new Error("Invite link missing or expired. Ask your admin to resend it.");
        }

        if (!cancelled) {
          setEmail(user.email);
          setState("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setState("error");
          setErrorMessage(
            err instanceof Error
              ? err.message
              : "Invite link missing or expired. Ask your admin to resend it."
          );
        }
      }
    }

    loadInviteSession();

    return () => {
      cancelled = true;
    };
  }, [code, supabase]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setState("saving");
    setErrorMessage("");

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setState("ready");
      setErrorMessage(error.message);
      return;
    }

    window.location.assign(nextPath);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
      className="w-full max-w-[430px]"
    >
      <div className="rounded-[20px] border border-rule bg-paper-2 px-8 py-10 shadow-[0_18px_50px_rgba(20,16,12,0.08)]">
        <div className="mb-8">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-[14px] bg-accent-soft">
            <KeyRound className="h-5 w-5 text-accent" />
          </div>
          <p className="font-sans text-xs font-extrabold uppercase tracking-[0.12em] text-accent">
            Minutia invite
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">
            Set your password
          </h1>
          <p className="mt-2 font-sans text-sm leading-6 text-ink-3">
            Your workspace invite is tied to this email. Choose a password to finish
            joining Minutia.
          </p>
        </div>

        {state === "loading" ? (
          <div className="rounded-[14px] border border-rule bg-paper px-4 py-4">
            <div className="flex items-center gap-3">
              <LoadingDots />
              <p className="font-sans text-sm text-ink-3">Opening invite</p>
            </div>
          </div>
        ) : state === "error" ? (
          <div className="space-y-4">
            <div className="rounded-[14px] border border-danger/25 bg-danger-soft px-4 py-3">
              <p className="font-sans text-sm font-medium text-danger">
                {errorMessage}
              </p>
            </div>
            <Button
              type="button"
              onClick={() => {
                window.location.href = "/login";
              }}
              className="h-10 w-full rounded-[12px] bg-accent font-sans font-medium text-white hover:bg-accent-hover"
            >
              Open login
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email" className="font-sans text-ink-2">
                Email address
              </Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" />
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  readOnly
                  aria-readonly="true"
                  autoComplete="email"
                  className="h-10 rounded-[12px] border-rule bg-paper pl-9 font-sans text-ink focus-visible:border-accent focus-visible:ring-accent/30"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-password" className="font-sans text-ink-2">
                Password
              </Label>
              <Input
                id="invite-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
                placeholder="Minimum 8 characters"
                className="h-10 rounded-[12px] border-rule bg-paper font-sans text-ink placeholder:text-ink-4 focus-visible:border-accent focus-visible:ring-accent/30"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-password-confirm" className="font-sans text-ink-2">
                Confirm password
              </Label>
              <Input
                id="invite-password-confirm"
                type="password"
                value={passwordConfirm}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
                placeholder="Repeat password"
                aria-invalid={!passwordsMatch}
                className="h-10 rounded-[12px] border-rule bg-paper font-sans text-ink placeholder:text-ink-4 focus-visible:border-accent focus-visible:ring-accent/30"
              />
              {!passwordsMatch && (
                <p className="font-sans text-xs text-danger">Passwords must match.</p>
              )}
            </div>

            {errorMessage && (
              <p className="font-sans text-sm text-danger">{errorMessage}</p>
            )}

            <div className="rounded-[14px] border border-rule bg-paper px-4 py-3">
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-success" />
                <p className="font-sans text-xs leading-5 text-ink-3">
                  Minutia does not send temporary passwords. This password is created
                  only by you.
                </p>
              </div>
            </div>

            <Button
              type="submit"
              disabled={!canSubmit}
              className="h-10 w-full rounded-[12px] bg-accent font-sans font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {state === "saving" ? (
                <span className="flex items-center gap-2">
                  <LoadingDots />
                  Saving
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Set password
                  <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </form>
        )}
      </div>
    </motion.div>
  );
}

function getSafeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function LoadingDots() {
  return (
    <span className="flex items-center gap-0.5" aria-label="Loading">
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="inline-block h-1 w-1 rounded-full bg-current"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{
            duration: 1,
            repeat: Infinity,
            delay: index * 0.2,
            ease: "easeInOut",
          }}
        />
      ))}
    </span>
  );
}
