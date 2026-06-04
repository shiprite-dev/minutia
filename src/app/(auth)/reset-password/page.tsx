"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LockKeyhole, ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormState = "idle" | "loading" | "success" | "error";

const RESET_LINK_ERROR =
  "Password reset link missing or expired. Request a new reset email.";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [formState, setFormState] = useState<FormState>("idle");
  const [message, setMessage] = useState("");
  const [openingLink, setOpeningLink] = useState(true);

  const passwordsMatch = password === passwordConfirm;
  const canSubmit = password.length >= 8 && passwordsMatch;

  useEffect(() => {
    let cancelled = false;

    async function openRecoverySession() {
      try {
        const supabase = createClient();
        const url = new URL(window.location.href);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const hashError = hash.get("error_description") || hash.get("error");

        if (hashError) {
          throw new Error(hashError);
        }

        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          window.history.replaceState({}, "", window.location.pathname);
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
      } catch (err) {
        if (!cancelled) {
          setFormState("error");
          setMessage(err instanceof Error ? err.message : RESET_LINK_ERROR);
        }
      } finally {
        if (!cancelled) {
          setOpeningLink(false);
        }
      }
    }

    openRecoverySession();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setFormState("loading");
    setMessage("");

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setFormState("error");
      setMessage(error.message);
      return;
    }

    await supabase.auth.signOut();
    setFormState("success");
    setPassword("");
    setPasswordConfirm("");
    setMessage("Password updated. Sign in with your new password.");
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
      className="w-full max-w-[400px]"
    >
      <div className="rounded-[20px] border border-rule bg-paper-2 px-8 py-10">
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            minutia
          </h1>
          <p className="mt-2 font-sans text-sm text-ink-3">
            Choose a new password.
          </p>
        </div>

        {formState === "success" ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
              <LockKeyhole className="h-5 w-5 text-accent" />
            </div>
            <p className="font-sans text-sm text-ink-3">{message}</p>
            <Button asChild className="h-10 w-full rounded-[12px] bg-accent font-sans font-medium text-white hover:bg-accent-hover">
              <Link href="/login">Back to sign in</Link>
            </Button>
          </div>
        ) : openingLink ? (
          <div className="rounded-[14px] border border-rule bg-paper px-4 py-4">
            <p className="font-sans text-sm text-ink-3">Opening reset link</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password" className="font-sans text-ink-2">
                New password
              </Label>
              <Input
                id="new-password"
                type="password"
                placeholder="Minimum 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="h-10 rounded-[12px] border-rule bg-paper px-3 font-sans text-ink placeholder:text-ink-4 focus-visible:border-accent focus-visible:ring-accent/30"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-password-confirm" className="font-sans text-ink-2">
                Confirm password
              </Label>
              <Input
                id="new-password-confirm"
                type="password"
                placeholder="Repeat password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="h-10 rounded-[12px] border-rule bg-paper px-3 font-sans text-ink placeholder:text-ink-4 focus-visible:border-accent focus-visible:ring-accent/30"
              />
            </div>

            {passwordConfirm && !passwordsMatch && (
              <p className="font-sans text-sm text-danger">
                Passwords do not match.
              </p>
            )}

            {formState === "error" && message && (
              <p className="font-sans text-sm text-danger">{message}</p>
            )}

            <Button
              type="submit"
              disabled={formState === "loading" || !canSubmit}
              className="h-10 w-full rounded-[12px] bg-accent font-sans font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {formState === "loading" ? (
                "Updating"
              ) : (
                <span className="flex items-center gap-2">
                  Update password
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
