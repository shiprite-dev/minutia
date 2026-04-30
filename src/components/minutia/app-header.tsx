"use client";

import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useUIStore } from "@/lib/stores/ui-store";
import { Separator } from "@/components/ui/separator";
import type { Profile } from "@/lib/types";

const pageTitles: Record<string, string> = {
  "/": "OIL Board",
  "/series": "Series",
  "/actions": "My Actions",
  "/inbox": "Inbox",
  "/settings": "Settings",
};

function resolveTitle(pathname: string): string {
  // Exact match first
  if (pageTitles[pathname]) return pageTitles[pathname];

  // Series detail
  if (/^\/series\/[^/]+$/.test(pathname)) return "Series";

  // Meeting detail
  if (/^\/series\/[^/]+\/meetings\/[^/]+$/.test(pathname)) return "Meeting";

  // Issue detail
  if (/^\/issues\/[^/]+$/.test(pathname)) return "Issue";

  // Fallback: try prefix match
  const prefix = Object.keys(pageTitles).find(
    (key) => key !== "/" && pathname.startsWith(key)
  );
  return prefix ? pageTitles[prefix] : "Minutia";
}

function UserAvatar({
  name,
  email,
}: {
  name: string | null;
  email: string;
}) {
  const display = name || email;
  const initials = display
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-paper-3 text-xs font-medium text-ink">
      {initials}
    </div>
  );
}

interface AppHeaderProps {
  profile: Profile | null;
}

export function AppHeader({ profile }: AppHeaderProps) {
  const pathname = usePathname();
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);
  const title = resolveTitle(pathname);

  return (
    <header aria-label="Page header" className="flex h-12 shrink-0 items-center gap-2 border-b border-rule bg-paper px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 h-4" />
      <h1 className="text-sm font-medium text-ink">{title}</h1>

      <div className="flex-1" />

      <Button
        variant="ghost"
        size="sm"
        onClick={openCommandPalette}
        className="hidden gap-1.5 text-ink-3 hover:text-ink sm:flex"
      >
        <Search className="size-3.5" />
        <span className="text-xs">Search</span>
        <kbd className="pointer-events-none ml-1 inline-flex h-5 select-none items-center gap-0.5 rounded border border-rule bg-paper-2 px-1.5 font-mono text-[10px] font-medium text-ink-3">
          <span className="text-xs">&#8984;</span>K
        </kbd>
      </Button>

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={openCommandPalette}
        className="text-ink-3 hover:text-ink sm:hidden"
      >
        <Search className="size-4" />
        <span className="sr-only">Search</span>
      </Button>

      {profile && (
        <UserAvatar
          name={profile.name}
          email={profile.email}
        />
      )}
    </header>
  );
}
