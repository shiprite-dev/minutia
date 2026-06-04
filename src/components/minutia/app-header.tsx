"use client";

import { usePathname } from "next/navigation";
import { Search, Calendar, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useUIStore } from "@/lib/stores/ui-store";
import { Separator } from "@/components/ui/separator";
import { HintTooltip } from "@/components/minutia/hint-tooltip";

const pageTitles: Record<string, string> = {
  "/": "OIL Board",
  "/dashboard": "OIL Board",
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

export function AppHeader() {
  const pathname = usePathname();
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);
  const calendarSidebarOpen = useUIStore((s) => s.calendarSidebarOpen);
  const toggleCalendarSidebar = useUIStore((s) => s.toggleCalendarSidebar);
  const title = resolveTitle(pathname);

  return (
    <header aria-label="Page header" className="flex h-12 shrink-0 items-center gap-2 border-b border-rule bg-paper px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 h-4" />
      <h1 className="text-sm font-medium font-display text-ink">{title}</h1>

      <div className="flex-1" />

      <HintTooltip label="Search pages, series, issues, and decisions with Command K.">
        <Button
          variant="ghost"
          size="sm"
          onClick={openCommandPalette}
          data-tour="command-palette"
          className="hidden gap-1.5 text-ink-3 hover:text-ink sm:flex"
        >
          <Search className="size-3.5" />
          <span className="text-xs">Search</span>
          <kbd className="pointer-events-none ml-1 inline-flex h-5 select-none items-center gap-0.5 rounded border border-rule bg-paper-2 px-1.5 font-mono text-[10px] font-medium text-ink-3">
            <span className="text-xs">&#8984;</span>K
          </kbd>
        </Button>
      </HintTooltip>

      <HintTooltip label="Search pages, series, issues, and decisions.">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={openCommandPalette}
          data-tour="command-palette"
          className="text-ink-3 hover:text-ink sm:hidden"
        >
          <Search className="size-4" />
          <span className="sr-only">Search</span>
        </Button>
      </HintTooltip>

      {/* Desktop: panel toggle */}
      <HintTooltip label={calendarSidebarOpen ? "Close the calendar agenda." : "Open the calendar agenda."}>
        <Button
          variant="ghost"
          size="icon"
          className="hidden size-8 text-ink-3 hover:text-ink md:flex"
          onClick={toggleCalendarSidebar}
          aria-label={calendarSidebarOpen ? "Close calendar" : "Open calendar"}
        >
          {calendarSidebarOpen ? (
            <PanelRightClose className="size-4" />
          ) : (
            <PanelRightOpen className="size-4" />
          )}
        </Button>
      </HintTooltip>

      {/* Mobile: calendar icon */}
      <HintTooltip label="Open the calendar agenda.">
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-ink-3 hover:text-ink md:hidden"
          onClick={toggleCalendarSidebar}
          aria-label="Open calendar"
        >
          <Calendar className="size-4" />
        </Button>
      </HintTooltip>

    </header>
  );
}
