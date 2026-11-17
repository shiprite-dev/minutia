"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { CalendarDays, Check, Laptop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { useGoogleCalendarStatus } from "@/lib/hooks/use-google-calendar";
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
  const calendarCancelled = useSearchParams().get("gcal") === "error";
  const knownName =
    profile.name && profile.name !== profile.email.split("@")[0]
      ? profile.name
      : signupName;
  const [name, setName] = React.useState("");
  const { data: calendar } = useGoogleCalendarStatus();

  const save = useMutation({
    mutationFn: async (complete: boolean) => {
      const supabase = createClient();
      const finalName = (knownName ?? name).trim();
      if (finalName && finalName !== profile.name) {
        const { error } = await supabase
          .from("profiles")
          .update({ name: finalName })
          .eq("id", profile.id);
        if (error) throw error;
        if (
          workspace?.memberCount === 1 &&
          workspace.name === `${profile.name}'s workspace`
        ) {
          const { error: renameError } = await supabase
            .from("organizations")
            .update({ name: `${finalName}'s workspace` })
            .eq("id", workspace.id);
          if (renameError) throw renameError;
        }
      }
      const { error: metadataError } = await supabase.auth.updateUser({
        data: {
          ...(finalName && { name: finalName }),
          ...(complete && { setup_completed: true }),
        },
      });
      if (metadataError) throw metadataError;
      if (complete) {
        const { error: completeError } = await supabase
          .from("profiles")
          .update({ has_completed_onboarding: true })
          .eq("id", profile.id);
        if (completeError) throw completeError;
      }
    },
  });
  const pending = save.isPending || save.isSuccess;

  function finish() {
    save.mutate(true, {
      onSuccess: () => {
        router.push("/");
        router.refresh();
      },
    });
  }

  function connectCalendar(e: React.MouseEvent<HTMLAnchorElement>) {
    if (knownName || !name.trim()) return;
    e.preventDefault();
    save.mutate(false, {
      onSuccess: () => window.location.assign("/api/auth/google"),
    });
  }

  return (
    <div
      data-testid="setup-screen"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-paper px-4 py-10"
    >
      <form
        className="w-full max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          finish();
        }}
      >
        <div className="text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-accent/10 font-display text-xl font-bold text-accent">
            m
          </span>
          <h1 className="mt-4 font-display text-2xl font-semibold break-words text-ink">
            {knownName
              ? `Welcome to Minutia, ${knownName}`
              : "Welcome to Minutia"}
          </h1>
          <p className="mt-1 text-sm text-ink-3">
            {calendar?.configured
              ? "Two optional steps and you are ready."
              : "One optional step and you are ready."}
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
              maxLength={100}
              autoFocus
              className="h-11 rounded-xl"
            />
          </div>
        )}

        <ul className="mt-8 divide-y divide-rule rounded-2xl border border-rule bg-card">
          {calendar?.configured && (
            <li className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
              <CalendarDays className="size-5 shrink-0 text-ink-3" />
              <div className="min-w-0 flex-1 basis-40">
                <p className="text-sm font-medium text-ink">Google Calendar</p>
                <p className="text-xs text-ink-3">
                  {calendar.connected
                    ? "Google Calendar connected"
                    : calendarCancelled
                      ? "Google Calendar was not connected. Try again or skip it for now."
                      : "Brings in your meetings so you never set them up by hand."}
                </p>
              </div>
              {calendar.connected ? (
                <Check aria-hidden className="size-5 text-accent" />
              ) : (
                <Button asChild variant="outline" size="sm">
                  <a href="/api/auth/google" onClick={connectCalendar}>
                    Connect Google Calendar
                  </a>
                </Button>
              )}
            </li>
          )}
          <li className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
            <Laptop className="size-5 shrink-0 text-ink-3" />
            <div className="min-w-0 flex-1 basis-40">
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
          type="submit"
          variant="accent"
          disabled={pending || (!knownName && !name.trim())}
          className="mt-6 h-11 w-full rounded-xl"
        >
          {pending ? "Finishing..." : "Continue"}
        </Button>
        <button
          type="button"
          onClick={finish}
          disabled={pending}
          className="mx-auto mt-3 block text-xs text-ink-4 transition-colors hover:text-ink-3"
        >
          Skip
        </button>
      </form>
    </div>
  );
}
