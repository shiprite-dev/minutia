"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Mail, ArrowRight, ExternalLink } from "lucide-react";
import { motion } from "motion/react";

type FormState = "idle" | "loading" | "sent" | "error";

const GUEST_LOGIN_ERROR_MESSAGE =
  "Guest login is unavailable because the local test user is missing or out of sync. Run `supabase db reset` to reseed test@example.com.";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [formState, setFormState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const supabase = createClient();

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setFormState("loading");
    setErrorMessage("");

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setFormState("error");
      setErrorMessage(error.message);
    } else {
      setFormState("sent");
    }
  }

  async function handleGoogleLogin() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
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
      window.location.href = "/";
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
                We sent a magic link to{" "}
                <span className="font-medium text-ink-2">{email}</span>
              </p>
            </div>
            <button
              onClick={() => {
                setFormState("idle");
                setEmail("");
              }}
              className="font-sans text-sm text-ink-3 underline underline-offset-4 transition-colors hover:text-ink-2"
            >
              Use a different email
            </button>
          </motion.div>
        ) : (
          <>
            {/* Magic link form */}
            <form onSubmit={handleMagicLink} className="space-y-4">
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

              {formState === "error" && errorMessage && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="font-sans text-sm text-danger"
                >
                  {errorMessage}
                </motion.p>
              )}

              <Button
                type="submit"
                disabled={formState === "loading" || !email.trim()}
                className="h-10 w-full rounded-[12px] bg-accent font-sans font-medium text-white hover:bg-accent-hover disabled:opacity-40"
              >
                {formState === "loading" ? (
                  <span className="flex items-center gap-2">
                    <LoadingDots />
                    Sending link
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Send magic link
                    <ArrowRight className="h-4 w-4" />
                  </span>
                )}
              </Button>
            </form>

            {/* Divider */}
            <div className="relative my-6 flex items-center">
              <Separator className="flex-1 bg-rule" />
              <span className="px-3 font-sans text-xs text-ink-4">
                or continue with
              </span>
              <Separator className="flex-1 bg-rule" />
            </div>

            {/* Google OAuth */}
            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleLogin}
              className="h-10 w-full rounded-[12px] border-rule bg-paper font-sans font-medium text-ink hover:bg-paper-3"
            >
              <GoogleIcon />
              Google
            </Button>

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
          </>
        )}
      </div>

      {/* Footer */}
      <p className="mt-6 text-center font-sans text-xs text-ink-4">
        Open source. Self-host free forever.{" "}
        <a
          href="https://github.com/minutia-dev/minutia"
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

function LoadingDots() {
  return (
    <span className="flex items-center gap-0.5" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="inline-block h-1 w-1 rounded-full bg-white"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{
            duration: 1,
            repeat: Infinity,
            delay: i * 0.2,
            ease: "easeInOut",
          }}
        />
      ))}
    </span>
  );
}

function GoogleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="mr-2"
    >
      <path
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}
