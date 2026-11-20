"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { CalendarDays, Check, CircleAlert, Laptop } from "lucide-react";
import { toast } from "sonner";
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
  calendarConfigured: boolean;
  showMacApp: boolean;
}

const SAVE_TIMEOUT_MS = 10_000;

function isLocalPath(path: string) {
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\");
}

function destinationAfterSetup(next: string | null) {
  const origin = window.location.origin;
  try {
    const requested = next ? new URL(next, origin) : null;
    if (requested?.origin === origin) {
      const path = requested.pathname + requested.search + requested.hash;
      if (isLocalPath(path)) return path;
    }
  } catch {
    return "/";
  }
  const here = new URL(window.location.href);
  if (here.searchParams.has("gcal")) return "/";
  here.searchParams.delete("next");
  const path = here.pathname + here.search + here.hash;
  return isLocalPath(path) ? path : "/";
}

function SetupRow({
  icon,
  title,
  note,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  note: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-4 p-4">
      <span className="mt-0.5 shrink-0 text-ink-3">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-40">
          <p className="text-sm font-medium text-ink">{title}</p>
          {note}
        </div>
        {action}
      </div>
    </li>
  );
}

export function OnboardingWizard({
  profile,
  signupName,
  workspace,
  calendarConfigured,
  showMacApp,
}: OnboardingWizardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const calendarCancelled = searchParams.get("gcal") === "error";
  const knownName =
    profile.name && profile.name !== profile.email.split("@")[0]
      ? profile.name
      : signupName;
  const [name, setName] = React.useState("");
  const { data: calendar } = useGoogleCalendarStatus();

  const save = useMutation({
    networkMode: "always",
    mutationFn: (complete: boolean) =>
      Promise.race([
        persist(complete),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), SAVE_TIMEOUT_MS),
        ),
      ]),
    onError: () =>
      toast.error("Couldn't save. Check your connection and try again."),
  });
  const pending = save.isPending || save.isSuccess;

  async function persist(complete: boolean) {
    const supabase = createClient();
    const finalName =
      (knownName ?? name).trim() || profile.email.split("@")[0];
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
  }

  function finish() {
    save.mutate(true, {
      onSuccess: () => {
        router.push(destinationAfterSetup(searchParams.get("next")));
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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-paper px-4 pt-16 pb-10 sm:pt-24"
    >
      <form
        className="w-full max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          finish();
        }}
      >
        <div className="text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-accent/10 font-display text-xl font-bold text-accent-text">
            m
          </span>
          <h1 className="mt-4 font-display text-2xl font-semibold break-words text-ink">
            {knownName
              ? `Welcome to Minutia, ${knownName}`
              : "Welcome to Minutia"}
          </h1>
          <p className="mt-1 text-sm text-ink-3">
            {calendarConfigured
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
          {calendarConfigured && (
            <SetupRow
              icon={<CalendarDays className="size-5" />}
              title="Google Calendar"
              note={
                calendar?.connected ? (
                  <p className="text-xs text-ink-3">Google Calendar connected</p>
                ) : calendarCancelled ? (
                  <p
                    role="status"
                    className="flex items-center gap-1 text-xs text-danger-text"
                  >
                    <CircleAlert aria-hidden className="size-3.5 shrink-0" />
                    Not connected. Try again?
                  </p>
                ) : (
                  <p className="text-xs text-ink-3">
                    Brings in your meetings so you never set them up by hand.
                  </p>
                )
              }
              action={
                calendar?.connected ? (
                  <Check aria-hidden className="size-5 text-accent-text" />
                ) : (
                  <Button asChild variant="outline" size="sm">
                    <a href="/api/auth/google" onClick={connectCalendar}>
                      Connect Google Calendar
                    </a>
                  </Button>
                )
              }
            />
          )}
          {showMacApp && (
            <SetupRow
              icon={<Laptop className="size-5" />}
              title="Get the Mac app"
              note={
                <p className="text-xs text-ink-3">
                  Records your meetings and transcribes them on your Mac.
                </p>
              }
              action={
                <Button asChild variant="outline" size="sm">
                  <a href="/download" target="_blank" rel="noreferrer">
                    Download for Mac
                  </a>
                </Button>
              }
            />
          )}
        </ul>

        <Button
          type="submit"
          variant="accent"
          disabled={pending}
          className="mt-6 h-11 w-full rounded-xl"
        >
          {pending ? "Finishing..." : "Continue"}
        </Button>
      </form>
    </div>
  );
}
