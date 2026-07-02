"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Home,
  Layers,
  CheckCircle,
  Inbox,
  Settings,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useIssues } from "@/lib/hooks/use-issues";
import { useSeries } from "@/lib/hooks/use-series";
import { useDecisions } from "@/lib/hooks/use-decisions";
import { useUIStore } from "@/lib/stores/ui-store";
import { CATEGORY_CONFIG, STATUS_CONFIG } from "@/lib/constants";
import { formatIssueKey } from "@/lib/issue-utils";
import { IssueKey } from "@/components/minutia/issue-key";
import { MinutiaCategoryIcon } from "@/components/minutia/minutia-icons";
import type { IssueCategory } from "@/lib/types";

const NAV_ITEMS = [
  { label: "Go to OIL Board", href: "/", icon: Home },
  { label: "Go to Series", href: "/series", icon: Layers },
  { label: "Go to My Actions", href: "/actions", icon: CheckCircle },
  { label: "Go to Inbox", href: "/inbox", icon: Inbox },
  { label: "Go to Settings", href: "/settings", icon: Settings },
] as const;

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

export function CommandPalette() {
  const router = useRouter();
  const open = useUIStore((s) => s.commandPaletteOpen);
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);
  const closeCommandPalette = useUIStore((s) => s.closeCommandPalette);
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette);
  const { data: issues } = useIssues(undefined, open);
  const { data: seriesList } = useSeries(open);
  const { data: decisions } = useDecisions(undefined, undefined, open);

  // Cmd+K / Ctrl+K and "/" listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }
      if (e.key === "/" && !isEditableTarget(e.target)) {
        e.preventDefault();
        openCommandPalette();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggleCommandPalette, openCommandPalette]);

  const runCommand = useCallback(
    (command: () => void) => {
      closeCommandPalette();
      command();
    },
    [closeCommandPalette]
  );

  const displayedIssues = issues ?? [];

  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) openCommandPalette();
        else closeCommandPalette();
      }}
      className="sm:max-w-lg shadow-[0_16px_70px_-12px_oklch(0%_0_0/0.25)] backdrop:backdrop-blur-sm"
    >
      <CommandInput placeholder="Search pages, series, issues..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Navigation */}
        <CommandGroup heading="Navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.href}
                onSelect={() => runCommand(() => router.push(item.href))}
              >
                <Icon className="size-4 text-muted-foreground" />
                <span>{item.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        {/* Series */}
        {seriesList && seriesList.length > 0 && (
          <CommandGroup heading="Series">
            {seriesList.map((series) => (
              <CommandItem
                key={series.id}
                value={`series ${series.name}`}
                onSelect={() =>
                  runCommand(() => router.push(`/series/${series.id}`))
                }
              >
                <Layers className="size-4 text-muted-foreground" />
                <span>{series.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Issues */}
        {displayedIssues.length > 0 && (
          <CommandGroup heading="Issues">
            {displayedIssues.map((issue) => {
              const catConfig =
                CATEGORY_CONFIG[issue.category as IssueCategory];
              const statusConfig = STATUS_CONFIG[issue.status];
              const issueKey = formatIssueKey(issue);
              return (
                <CommandItem
                  key={issue.id}
                  value={`issue ${issue.title}`}
                  keywords={[issueKey, issue.category, statusConfig?.label ?? ""]}
                  onSelect={() =>
                    runCommand(() => router.push(`/issues/${issue.id}`))
                  }
                >
                  <MinutiaCategoryIcon
                    category={issue.category}
                    className="size-3.5 shrink-0 text-ink"
                    aria-label={catConfig?.label}
                  />
                  <IssueKey issue={issue} className="h-5 px-1.5 text-[10px]" />
                  <span className="truncate">{issue.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {statusConfig?.label}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {/* Decisions */}
        {decisions && decisions.length > 0 && (
          <CommandGroup heading="Decisions">
            {decisions.slice(0, 5).map((d) => (
              <CommandItem
                key={d.id}
                value={`decision ${d.title}`}
                onSelect={() =>
                  runCommand(() =>
                    router.push(
                      d.meeting_id
                        ? `/series/${d.series_id}/meetings/${d.meeting_id}`
                        : `/series/${d.series_id}`
                    )
                  )
                }
              >
                <span className="shrink-0 text-xs leading-none text-accent">&#9670;</span>
                <span className="truncate">{d.title}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  Decision
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
