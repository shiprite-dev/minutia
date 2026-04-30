"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CircleDot,
  SquareStack,
  CheckSquare,
  Bell,
  Settings,
  LogOut,
} from "lucide-react";
import { signOut } from "@/lib/supabase/auth-actions";
import { useSeries } from "@/lib/hooks/use-series";
import { useIssues } from "@/lib/hooks/use-issues";
import { useUnreadCount } from "@/lib/hooks/use-notifications";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/types";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function CountBadge({ count, accent }: { count: number; accent?: boolean }) {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "ml-auto text-xs tabular-nums font-medium",
        accent ? "text-accent" : "text-ink-4"
      )}
    >
      {count}
    </span>
  );
}

function UserInitials({ name, email }: { name: string | null; email: string }) {
  const display = name || email;
  const initials = display
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-medium font-mono text-paper">
      {initials}
    </div>
  );
}

interface AppSidebarProps {
  profile: Profile | null;
}

export function AppSidebar({ profile }: AppSidebarProps) {
  const pathname = usePathname();
  const { data: seriesList } = useSeries();
  const { data: issues } = useIssues();
  const { data: unreadCount } = useUnreadCount();

  const openIssues = (issues ?? []).filter(
    (i) => i.status !== "resolved" && i.status !== "dropped"
  );
  const outstandingCount = openIssues.length;
  const myActionsCount = profile
    ? openIssues.filter((i) => i.owner_user_id === profile.id).length
    : 0;

  const navItems = [
    { label: "Outstanding", href: "/", icon: CircleDot, count: outstandingCount },
    { label: "Series", href: "/series", icon: SquareStack, count: 0 },
    { label: "My actions", href: "/actions", icon: CheckSquare, count: myActionsCount },
    { label: "Inbox", href: "/inbox", icon: Bell, count: unreadCount ?? 0 },
  ] as const;

  return (
    <Sidebar>
      <SidebarHeader className="px-5 pt-10 pb-8">
        <Link href="/" className="flex items-center gap-2.5 font-display text-[22px] font-semibold tracking-tight text-ink">
          <span className="size-2.5 rounded-full bg-accent inline-block" />
          minutia
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <nav aria-label="Main navigation">
        <SidebarGroup className="px-3">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {navItems.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <SidebarMenuItem key={item.href} className="relative">
                    {active && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-3.5 bg-accent rounded-sm" />
                    )}
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      className={cn(
                        "h-9 rounded-md px-3 gap-3 text-[14px] text-ink-2 transition-all",
                        active && "text-ink font-medium"
                      )}
                    >
                      <Link href={item.href}>
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                        <CountBadge count={item.count} accent={item.href === "/" || item.href === "/actions"} />
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {seriesList && seriesList.length > 0 && (
          <SidebarGroup className="px-3 mt-4">
            <SidebarGroupLabel className="h-auto px-3 mb-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-ink-4">
              Series
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {seriesList.map((series) => {
                  const seriesActive = pathname.startsWith(`/series/${series.id}`);
                  return (
                    <SidebarMenuItem key={series.id}>
                      <SidebarMenuButton
                        asChild
                        isActive={seriesActive}
                        className={cn(
                          "h-9 rounded-md px-3 text-[14px] text-ink-2 transition-all",
                          seriesActive && "text-ink font-medium"
                        )}
                      >
                        <Link href={`/series/${series.id}`}>
                          <span>{series.name}</span>
                          <CountBadge count={series.open_issues_count} />
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        </nav>
      </SidebarContent>

      <SidebarFooter className="border-t border-rule px-3 py-4">
        <SidebarMenu className="mb-2">
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={isActive(pathname, "/settings")}
              tooltip="Settings"
              className={cn(
                "h-9 rounded-md px-3 gap-3 text-[14px] text-ink-2 transition-all",
                isActive(pathname, "/settings") && "text-ink font-medium"
              )}
            >
              <Link href="/settings">
                <Settings className="size-4" />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex items-center gap-2.5">
          <UserInitials
            name={profile?.name ?? null}
            email={profile?.email ?? ""}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs font-medium text-ink">
              {profile?.name || "User"}
            </span>
            <span className="truncate text-xs text-ink-4">
              Free plan
            </span>
          </div>
          <form action={signOut}>
            <Button
              type="submit"
              variant="ghost"
              size="icon-sm"
              className="text-ink-3 hover:text-ink"
            >
              <LogOut className="size-4" />
              <span className="sr-only">Sign out</span>
            </Button>
          </form>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
