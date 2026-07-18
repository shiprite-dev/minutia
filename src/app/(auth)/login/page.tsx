"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Mail, ArrowRight, ExternalLink } from "lucide-react";
import { motion } from "motion/react";
import { GOOGLE_WORKSPACE_SCOPES } from "@/lib/google-oauth-scopes";
import { getSafeNext, buildCallbackUrl, LoadingDots, GoogleIcon } from "../_shared";

type FormState = "idle" | "loading" | "sent" | "error";
type InviteState = "idle" | "loading" | "sent" | "error";

const GUEST_LOGIN_ERROR_MESSAGE =
  "Guest login is unavailable because the local test user is missing or out of sync. Run `supabase db reset` to reseed test@example.com.";

const LOGIN_FOOTER_PHRASES = [
  "Own your meeting memory.",
  "Control every note, action, and decision.",
  "Keep meeting history portable.",
  "Inspect the source. Run it on your terms.",
  "Build on open source meeting memory.",
  "Host the workflow where your team works.",
  "Turn recurring meetings into durable context.",
  "Keep decisions and follow-ups in one system.",
  "Run the meeting memory layer yourself.",
  "Make every meeting leave a useful trail.",
  "Own the path from transcript to action.",
  "Self-host your team's meeting brain.",
] as const;

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formState, setFormState] = useState<FormState>("idle");
  const [inviteState, setInviteState] = useState<InviteState>("idle");
  const [inviteMessage, setInviteMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [sentMessage, setSentMessage] = useState(
    "We sent a magic link to"
  );
  const [resetCooldown, setResetCooldown] = useState(0); // seconds remaining
  const footerPhraseRef = useRef<HTMLSpanElement>(null);
  const supabase = createClient();

  useEffect(() => {
    const phrase = LOGIN_FOOTER_PHRASES[
      Math.floor(Math.random() * LOGIN_FOOTER_PHRASES.length)
    ];
    if (footerPhraseRef.current) {
      footerPhraseRef.current.textContent = phrase;
    }
  }, []);

  // Countdown timer for the password reset cooldown.
  useEffect(() => {
    if (resetCooldown <= 0) return;
    const timer = setTimeout(() => {
      setResetCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [resetCooldown]);

  const publicSignupEnabled =
    process.env.NEXT_PUBLIC_ENABLE_PUBLIC_SIGNUP === "true";
  const magicLinkEnabled =
    process.env.NEXT_PUBLIC_ENABLE_MAGIC_LINK === "true";
  const googleAuthEnabled =
    process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH === "true";
  const guestLoginEnabled =
    process.env.NEXT_PUBLIC_ENABLE_GUEST_LOGIN === "true";
  const secondaryAuthEnabled =
    magicLinkEnabled || googleAuthEnabled || guestLoginEnabled;
  const canSignIn = email.trim().length > 0 && password.length > 0;
  const nextPath = getSafeNext(searchParams.get("next"));
  const callbackUrl = buildCallbackUrl(nextPath);

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!canSignIn) return;

    setFormState("loading");
    setErrorMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setFormState("error");
      setErrorMessage(error.message);
    } else {
      window.location.replace(nextPath);
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setFormState("loading");
    setErrorMessage("");

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: callbackUrl,
      },
    });

    if (error) {
      setFormState("error");
      setErrorMessage(error.message);
    } else {
      setSentMessage("We sent a magic link to");
      setFormState("sent");
    }
  }

  async function handleForgotPassword() {
    if (!email.trim()) return;
    if (resetCooldown > 0 || formState === "loading") return;

    setFormState("loading");
    setErrorMessage("");

    const res = await fetch("/api/password-reset-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    const data = await res.json();

    if (!res.ok) {
      setFormState("error");
      if (res.status === 429) {
        setErrorMessage(
          data.error ||
            "You've requested too many password resets. Please wait a few minutes before trying again."
        );
      } else {
        setErrorMessage(data.error || "Failed to send password reset email");
      }
    } else {
      setSentMessage("We sent a password reset link to");
      setFormState("sent");
    }

    // 60-second cooldown regardless of outcome to prevent spamming.
    setResetCooldown(60);
  }

  async function handleGoogleLogin() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl,
        scopes: GOOGLE_WORKSPACE_SCOPES,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });

    if (error) {
      setFormState("error");
      setErrorMessage(error.message);
    }
  }

  async function handleGuestLogin() {
    setFormState("loading");
    setErrorMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email: "test@example.com",
      password: "password123",
    });

    if (error) {
      setFormState("error");
      setErrorMessage(
        error.message.toLowerCase().includes("invalid login credentials")
          ? GUEST_LOGIN_ERROR_MESSAGE
          : error.message
      );
    } else {
      window.location.replace(nextPath);
    }
  }

  async function handleInviteRequest() {
    if (!email.trim()) return;

    setInviteState("loading");
    setInviteMessage("");

    try {
      const res = await fetch("/api/invite-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), next: nextPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to request invite");
      setInviteState("sent");
      setInviteMessage("Invite request sent to the Minutia admin.");
    } catch (err) {
      setInviteState("error");
      setInviteMessage(err instanceof Error ? err.message : "Failed to request invite");
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
      className="w-full max-w-[400px]"
    >
      <div className="rounded-[20px] border border-rule bg-paper-2 px-8 py-10">
        {/* Logo */}
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            minutia
          </h1>
          <p className="mt-2 font-sans text-sm text-ink-3">
            The open-source meeting memory system.
          </p>
        </div>

        {formState === "sent" ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
            className="space-y-4 text-center"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
              <Mail className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="font-sans text-sm font-medium text-ink">
                Check your email
              </p>
              <p className="mt-1 font-sans text-sm text-ink-3">
                {sentMessage}{" "}
                <span className="font-medium text-ink-2">{email}</span>
              </p>
            </div>
            <button
              onClick={() => {
                setFormState("idle");
                setEmail("");
                setPassword("");
              }}
              className="font-sans text-sm text-ink-3 underline underline-offset-4 transition-colors hover:text-ink-2"
            >
              Use a different email
            </button>
          </motion.div>
        ) : (
          <>
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="font-sans text-ink-2">
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="h-10 rounded-[12px] border-rule bg-paper px-3 font-sans text-ink placeholder:text-ink-4 focus-visible:border-accent focus-visible:ring-accent/30"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="password" className="font-sans text-ink-2">
                    Password
                  </Label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={
                      formState === "loading" ||
                      !email.trim() ||
                      resetCooldown > 0
                    }
                    className="font-sans text-xs text-ink-3 underline underline-offset-4 transition-colors hover:text-ink-2 disabled:pointer-events-none disabled:opacity-40"
                  >
                    {resetCooldown > 0
                      ? `Forgot password? (${resetCooldown}s)`
                      : "Forgot password?"}
                  </button>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="Minimum 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="current-password"
                  className="h-10 rounded-[12px] border-rule bg-paper px-3 font-sans text-ink placeholder:text-ink-4 focus-visible:border-accent focus-visible:ring-accent/30"
                />
              </div>

              {formState === "error" && errorMessage && (
                <motion.p
                  role="alert"
                  aria-live="assertive"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="font-sans text-sm text-danger"
                >
                  {errorMessage}
                </motion.p>
              )}

              <Button
                type="submit"
                variant="accent"
                disabled={formState === "loading" || !canSignIn}
                className="h-10 w-full rounded-[12px] font-sans font-medium"
              >
                {formState === "loading" ? (
                  <span className="flex items-center gap-2">
                    <LoadingDots />
                    Signing in
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Sign in
                    <ArrowRight className="h-4 w-4" />
                  </span>
                )}
              </Button>

            </form>

            {secondaryAuthEnabled && (
              <div className="relative my-6 flex items-center">
                <Separator className="flex-1 bg-rule" />
                <span className="px-3 font-sans text-xs text-ink-4">
                  or continue with
                </span>
                <Separator className="flex-1 bg-rule" />
              </div>
            )}

            {magicLinkEnabled && (
              <form onSubmit={handleMagicLink}>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={formState === "loading" || !email.trim()}
                  className="mb-3 h-10 w-full rounded-[12px] border-rule bg-paper font-sans font-medium text-ink hover:bg-paper-3"
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Email magic link
                </Button>
              </form>
            )}

            {googleAuthEnabled && (
              <Button
                type="button"
                variant="outline"
                onClick={handleGoogleLogin}
                className="h-10 w-full rounded-[12px] border-rule bg-paper font-sans font-medium text-ink hover:bg-paper-3"
              >
                <GoogleIcon />
                Google
              </Button>
            )}

            {guestLoginEnabled && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleGuestLogin}
                disabled={formState === "loading"}
                className="h-10 w-full rounded-[12px] font-sans text-sm text-ink-3 hover:bg-paper-3 hover:text-ink-2"
              >
                {formState === "loading" ? (
                  <span className="flex items-center gap-2">
                    <LoadingDots />
                    Signing in
                  </span>
                ) : (
                  "Sign in as Guest"
                )}
              </Button>
            )}

            {publicSignupEnabled ? (
              <p className="mt-6 text-center font-sans text-sm text-ink-3">
                New to Minutia?{" "}
                <Link
                  href={`/signup${nextPath !== "/" ? `?next=${encodeURIComponent(nextPath)}` : ""}`}
                  className="inline-flex items-center gap-1 font-medium text-accent underline-offset-4 transition-colors hover:underline"
                >
                  Create an account
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </p>
            ) : (
              <div className="mt-5 rounded-[14px] border border-rule bg-paper px-4 py-3">
                <p className="font-sans text-xs font-medium text-ink">
                  Need access to this Minutia workspace?
                </p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="font-sans text-xs text-ink-4">
                    Enter your email and ask the admin for an invite.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleInviteRequest}
                    disabled={inviteState === "loading" || !email.trim()}
                    className="h-8 shrink-0 rounded-[10px] border-rule bg-paper text-xs text-ink hover:bg-paper-3"
                  >
                    {inviteState === "loading" ? "Sending" : "Request invite"}
                  </Button>
                </div>
                {inviteMessage && (
                  <p
                    className={`mt-2 font-sans text-xs ${
                      inviteState === "error" ? "text-danger" : "text-ink-3"
                    }`}
                  >
                    {inviteMessage}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <p
        data-testid="login-footer"
        className="mt-6 text-center font-sans text-xs text-ink-4"
      >
        <span ref={footerPhraseRef}>{LOGIN_FOOTER_PHRASES[0]}</span>{" "}
        <a
          href="https://github.com/shiprite-dev/minutia"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-ink-3 underline underline-offset-4 transition-colors hover:text-ink-2"
        >
          GitHub
          <ExternalLink className="h-3 w-3" />
        </a>
      </p>
    </motion.div>
  );
}

