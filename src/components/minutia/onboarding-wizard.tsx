"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, Laptop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import {
  useCompleteOnboarding,
  useUpdateProfile,
} from "@/lib/hooks/use-profile";
import { useGoogleCalendarStatus } from "@/lib/hooks/use-google-calendar";
import { setStoredState as setTourState } from "@/components/minutia/first-run-tour";
import type { OrganizationOption, Profile } from "@/lib/types";

interface OnboardingWizardProps {
  profile: Profile;
  signupName: string | null;
  workspace: OrganizationOption | undefined;
}

export function OnboardingWizard({
  profile,
  signupName,
  workspace,
}: OnboardingWizardProps) {
  const router = useRouter();
  const knownName =
    profile.name && profile.name !== profile.email.split("@")[0]
      ? profile.name
      : signupName;
  const [name, setName] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const { data: calendar } = useGoogleCalendarStatus();
  const updateProfile = useUpdateProfile();
  const completeOnboarding = useCompleteOnboarding();

  async function finish() {
    setPending(true);
    const finalName = (knownName ?? name).trim();
    try {
      if (finalName && finalName !== profile.name) {
        await updateProfile.mutateAsync({ name: finalName });
        if (workspace?.name === `${profile.name}'s workspace`) {
          await createClient()
            .from("organizations")
            .update({ name: `${finalName}'s workspace` })
            .eq("id", workspace.id);
        }
      }
      setTourState(profile.id, "dismissed");
      await completeOnboarding.mutateAsync();
      router.push("/");
      router.refresh();
    } catch {
      setPending(false);
    }
  }

  return (
    <div
      data-testid="setup-screen"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-paper px-4 py-10"
    >
      <div className="w-full max-w-md">
        <div className="text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-accent/10 font-display text-xl font-bold text-accent">
            m
          </span>
          <h1 className="mt-4 font-display text-2xl font-semibold text-ink">
            {knownName
              ? `Welcome to Minutia, ${knownName}`
              : "Welcome to Minutia"}
          </h1>
          <p className="mt-1 text-sm text-ink-3">
            Two optional steps and you are ready.
          </p>
        </div>

        {!knownName && (
          <div className="mt-8 space-y-2">
            <Label htmlFor="setup-name" className="text-ink-2">
              What should we call you?
            </Label>
            <Input
              id="setup-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoFocus
              className="h-11 rounded-xl"
            />
          </div>
        )}

        <ul className="mt-8 divide-y divide-rule rounded-2xl border border-rule bg-card">
          <li className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
            <CalendarDays className="size-5 shrink-0 text-ink-3" />
            <div className="min-w-0 flex-1 basis-48">
              <p className="text-sm font-medium text-ink">Google Calendar</p>
              <p className="text-xs text-ink-3">
                {calendar?.connected
                  ? "Google Calendar connected"
                  : "Brings in your meetings so you never set them up by hand."}
              </p>
            </div>
            {calendar?.connected ? (
              <Check aria-hidden className="size-5 text-accent" />
            ) : (
              <Button asChild variant="outline" size="sm">
                <a href="/api/auth/google">Connect Google Calendar</a>
              </Button>
            )}
          </li>
          <li className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
            <Laptop className="size-5 shrink-0 text-ink-3" />
            <div className="min-w-0 flex-1 basis-48">
              <p className="text-sm font-medium text-ink">Get the Mac app</p>
              <p className="text-xs text-ink-3">
                Records your meetings and transcribes them on your Mac.
              </p>
            </div>
            <Button asChild variant="accent" size="sm">
              <a href="/download" target="_blank" rel="noreferrer">
                Download for Mac
              </a>
            </Button>
          </li>
        </ul>

        <Button
          variant="accent"
          onClick={finish}
          disabled={pending || (!knownName && !name.trim())}
          className="mt-6 h-11 w-full rounded-xl"
        >
          Continue
        </Button>
        <button
          type="button"
          onClick={finish}
          disabled={pending}
          className="mx-auto mt-3 block text-xs text-ink-4 transition-colors hover:text-ink-3"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
