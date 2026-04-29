"use client";

import type { ReactNode } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/minutia/app-sidebar";
import { AppHeader } from "@/components/minutia/app-header";
import { CommandPalette } from "@/components/minutia/command-palette";
import type { Profile } from "@/lib/types";

interface AppShellProps {
  profile: Profile | null;
  children: ReactNode;
}

export function AppShell({ profile, children }: AppShellProps) {
  return (
    <SidebarProvider>
      <AppSidebar profile={profile} />
      <SidebarInset>
        <AppHeader profile={profile} />
        <main className="flex flex-1 flex-col overflow-y-auto bg-paper">
          {children}
        </main>
      </SidebarInset>
      <CommandPalette />
    </SidebarProvider>
  );
}
