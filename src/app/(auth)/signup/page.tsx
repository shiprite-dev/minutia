"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Mail, ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { GOOGLE_WORKSPACE_SCOPES } from "@/lib/google-oauth-scopes";
import { getSafeNext, buildCallbackUrl, LoadingDots, GoogleIcon } from "../_shared";

type FormState = "idle" | "loading" | "sent" | "error";

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpForm />
    </Suspense>
  );
}

function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formState, setFormState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const supabase = createClient();

  // Public sign-up is managed-cloud only. If the flag is off, the route is
  // unreachable via middleware; this guard covers any client/server env skew.
  const publicSignupEnabled =
    process.env.NEXT_PUBLIC_ENABLE_PUBLIC_SIGNUP === "true";
  const magicLinkEnabled =
    process.env.NEXT_PUBLIC_ENABLE_MAGIC_LINK === "true";
  const googleAuthEnabled =
    process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH === "true";
  const secondaryAuthEnabled = magicLinkEnabled || googleAuthEnabled;

  const nextPath = getSafeNext(searchParams.get("next"));
  const loginHref = `/login${nextPath !== "/" ? `?next=${encodeURIComponent(nextPath)}` : ""}`;
  const callbackUrl = buildCallbackUrl(nextPath);
  const canCreate = email.trim().length > 0 && password.length >= 8;

  useEffect(() => {
    if (!publicSignupEnabled) router.replace(loginHref);
  }, [publicSignupEnabled, loginHref, router]);

  if (!publicSignupEnabled) return null;

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;

    setFormState("loading");
    setErrorMessage("");

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: callbackUrl,
        data: name.trim() ? { name: name.trim() } : undefined,
      },
    });

    if (error) {
      setFormState("error");
      setErrorMessage(error.message);
    } else if (data.session) {
      // Auto-confirmed signup (email confirmation disabled): new accounts still
      // get the onboarding confirmation beat via the ?confirmed=1 marker.
      const sep = nextPath.includes("?") ? "&" : "?";
      window.location.replace(`${nextPath}${sep}confirmed=1`);
    } else {
      setFormState("sent");
    }
  }

  async function handleMagicLink() {
    if (!email.trim()) return;

    setFormState("loading");
    setErrorMessage("");

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callbackUrl },
    });

    if (error) {
      setFormState("error");
      setErrorMessage(error.message);
    } else {
      setFormState("sent");
    }
  }

  async function handleGoogleSignUp() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl,
        scopes: GOOGLE_WORKSPACE_SCOPES,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });

    if (error) {
      setFormState("error");
      setErrorMessage(error.message);
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
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            minutia
          </h1>
          <p className="mt-2 font-sans text-sm text-ink-3">
            Create your account to get started.
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
                Confirm your account at{" "}
                <span className="font-medium text-ink-2">{email}</span>
              </p>
            </div>
            <button
              onClick={() => {
                setFormState("idle");
                setName("");
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
            <form onSubmit={handleCreateAccount} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="font-sans text-ink-2">
                  Name
                  <span className="ml-1 font-normal text-ink-4">(optional)</span>
                </Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Ada Lovelace"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  className="h-10 rounded-[12px] border-rule bg-paper px-3 font-sans text-ink placeholder:text-ink-4 focus-visible:border-accent focus-visible:ring-accent/30"
                />
              </div>
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
                <Label htmlFor="password" className="font-sans text-ink-2">
                  Password
                </Label>
                <Input
                  id="password"
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
                disabled={formState === "loading" || !canCreate}
                className="h-10 w-full rounded-[12px] bg-accent font-sans font-medium text-white hover:bg-accent-hover disabled:opacity-40"
              >
                {formState === "loading" ? (
                  <span className="flex items-center gap-2">
                    <LoadingDots />
                    Creating account
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Create account
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
              <Button
                type="button"
                variant="outline"
                onClick={handleMagicLink}
                disabled={formState === "loading" || !email.trim()}
                className="mb-3 h-10 w-full rounded-[12px] border-rule bg-paper font-sans font-medium text-ink hover:bg-paper-3"
              >
                <Mail className="mr-2 h-4 w-4" />
                Email magic link
              </Button>
            )}

            {googleAuthEnabled && (
              <Button
                type="button"
                variant="outline"
                onClick={handleGoogleSignUp}
                className="h-10 w-full rounded-[12px] border-rule bg-paper font-sans font-medium text-ink hover:bg-paper-3"
              >
                <GoogleIcon />
                Google
              </Button>
            )}

            <p className="mt-6 text-center font-sans text-sm text-ink-3">
              Already have an account?{" "}
              <Link
                href={loginHref}
                className="font-medium text-accent underline-offset-4 transition-colors hover:underline"
              >
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </motion.div>
  );
}
