"use client";

import { useEffect, useState, useCallback } from "react";
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
import { CATEGORY_CONFIG, STATUS_CONFIG } from "@/lib/constants";
import type { IssueCategory } from "@/lib/types";

const NAV_ITEMS = [
  { label: "Go to OIL Board", href: "/", icon: Home },
  { label: "Go to Series", href: "/series", icon: Layers },
  { label: "Go to My Actions", href: "/actions", icon: CheckCircle },
  { label: "Go to Inbox", href: "/inbox", icon: Inbox },
  { label: "Go to Settings", href: "/settings", icon: Settings },
] as const;

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { data: issues } = useIssues();
  const { data: seriesList } = useSeries();

  // Cmd+K / Ctrl+K listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const runCommand = useCallback(
    (command: () => void) => {
      setOpen(false);
      command();
    },
    []
  );

  const displayedIssues = (issues ?? []).slice(0, 10);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
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
              return (
                <CommandItem
                  key={issue.id}
                  value={`issue ${issue.title} ${issue.category}`}
                  onSelect={() =>
                    runCommand(() => router.push(`/issues/${issue.id}`))
                  }
                >
                  <span
                    className="shrink-0 text-xs leading-none text-muted-foreground"
                    title={catConfig?.label}
                  >
                    {catConfig?.glyph}
                  </span>
                  <span className="truncate">{issue.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {statusConfig?.label}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
