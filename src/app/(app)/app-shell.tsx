"use client";

import * as React from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/minutia/app-sidebar";
import { AppHeader } from "@/components/minutia/app-header";
import { CommandPalette } from "@/components/minutia/command-palette";
import { KeyboardShortcutsDialog } from "@/components/minutia/keyboard-shortcuts-dialog";
import { GotoShortcuts } from "@/components/minutia/goto-shortcuts";
import { CalendarSidebar } from "@/components/minutia/calendar-sidebar";
import { OnboardingWizard } from "@/components/minutia/onboarding-wizard";
import { FirstRunTour } from "@/components/minutia/first-run-tour";
import type { OrganizationOption, Profile } from "@/lib/types";

interface AppShellProps {
  profile: Profile | null;
  organizations: OrganizationOption[];
  children: ReactNode;
}

export function AppShell({ profile, organizations, children }: AppShellProps) {
  const shellRef = React.useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  React.useEffect(() => {
    shellRef.current?.setAttribute("data-hydrated", "true");
  }, [pathname]);

  if (profile && !profile.has_completed_onboarding) {
    return (
      <div
        ref={shellRef}
        className="contents"
        data-minutia-app-shell
        data-hydrated="false"
      >
        <OnboardingWizard userName={profile.name} userEmail={profile.email} />
      </div>
    );
  }

  return (
    <div
      ref={shellRef}
      className="contents"
      data-minutia-app-shell
      data-hydrated="false"
    >
      <SidebarProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to content
      </a>
      <AppSidebar profile={profile} organizations={organizations} />
      <SidebarInset>
        <AppHeader />
        <div className="flex flex-1 overflow-hidden">
          <main id="main-content" className="flex flex-1 flex-col overflow-y-auto bg-paper">
            {children}
          </main>
          <CalendarSidebar />
        </div>
      </SidebarInset>
      <CommandPalette />
      <KeyboardShortcutsDialog />
      <GotoShortcuts />
      {profile && <FirstRunTour userId={profile.id} />}
      </SidebarProvider>
    </div>
  );
}
