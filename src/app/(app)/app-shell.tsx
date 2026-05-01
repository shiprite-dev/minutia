"use client";

import type { ReactNode } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/minutia/app-sidebar";
import { AppHeader } from "@/components/minutia/app-header";
import { CommandPalette } from "@/components/minutia/command-palette";
import { KeyboardShortcutsDialog } from "@/components/minutia/keyboard-shortcuts-dialog";
import { GotoShortcuts } from "@/components/minutia/goto-shortcuts";
import type { Profile } from "@/lib/types";

interface AppShellProps {
  profile: Profile | null;
  children: ReactNode;
}

export function AppShell({ profile, children }: AppShellProps) {
  return (
    <SidebarProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to content
      </a>
      <AppSidebar profile={profile} />
      <SidebarInset>
        <AppHeader profile={profile} />
        <main id="main-content" className="flex flex-1 flex-col overflow-y-auto bg-paper">
          {children}
        </main>
      </SidebarInset>
      <CommandPalette />
      <KeyboardShortcutsDialog />
      <GotoShortcuts />
    </SidebarProvider>
  );
}
