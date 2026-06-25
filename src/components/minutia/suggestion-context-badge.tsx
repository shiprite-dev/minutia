"use client";

import Link from "next/link";
import { Sparkles, ArrowUpRight, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_CONFIG } from "@/lib/constants";
import type { IssueStatus, SuggestionType } from "@/lib/types";

// MIN-121: the cross-meeting story, told in one glance. Every AI suggestion
// wears a badge that says how it relates to the living OIL:
//   NEW                       a genuinely new item
//   UPDATES OIL-45 -> Resolved  this meeting moved an existing item
//   DUPLICATE OF OIL-67        already tracked; don't add it twice
// The three are deliberately distinct in hue (brand / status / caution) so the
// reviewer reads provenance before reading the item.

const STATUS_PALETTE: Record<IssueStatus, string> = {
  open: "bg-paper-2 text-ink-2 ring-rule",
  in_progress: "bg-accent-soft text-accent ring-accent/20",
  pending: "bg-warn-soft text-warn ring-warn/20",
  resolved: "bg-success-soft text-success ring-success/25",
  dropped: "bg-paper-2 text-ink-3 ring-rule",
};

const PILL_BASE =
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset transition-colors";

interface SuggestionContextBadgeProps {
  type: SuggestionType;
  relatedIssueNumber?: number | null;
  suggestedStatus?: IssueStatus | null;
  /** /issues/{id} when the referenced item is resolvable; renders as a link. */
  relatedHref?: string | null;
  className?: string;
}

export function SuggestionContextBadge({
  type,
  relatedIssueNumber,
  suggestedStatus,
  relatedHref,
  className,
}: SuggestionContextBadgeProps) {
  if (type === "new_item") {
    return (
      <span
        aria-label="New item"
        className={cn(PILL_BASE, "bg-accent-soft text-accent ring-accent/20", className)}
      >
        <Sparkles className="size-3 shrink-0" aria-hidden="true" />
        New
      </span>
    );
  }

  const key = relatedIssueNumber != null ? `OIL-${relatedIssueNumber}` : "an item";

  if (type === "duplicate_warning") {
    const content = (
      <>
        <Copy className="size-3 shrink-0" aria-hidden="true" />
        <span>Duplicate of</span>
        <span className="font-mono tracking-normal">{key}</span>
      </>
    );
    const palette = "bg-warn-soft text-warn ring-warn/25";
    return relatedHref ? (
      <Link
        href={relatedHref}
        aria-label={`Duplicate of ${key}, open item`}
        className={cn(PILL_BASE, palette, "hover:ring-warn/50", className)}
      >
        {content}
      </Link>
    ) : (
      <span aria-label={`Duplicate of ${key}`} className={cn(PILL_BASE, palette, className)}>
        {content}
      </span>
    );
  }

  // status_update: tone the badge by the target status, so "resolved" reads green.
  const palette = suggestedStatus ? STATUS_PALETTE[suggestedStatus] : STATUS_PALETTE.open;
  const content = (
    <>
      <ArrowUpRight className="size-3 shrink-0" aria-hidden="true" />
      <span>Updates</span>
      <span className="font-mono tracking-normal">{key}</span>
      {suggestedStatus && (
        <span className="opacity-80">&rarr; {STATUS_CONFIG[suggestedStatus].label}</span>
      )}
    </>
  );
  const label = `Updates ${key}${suggestedStatus ? ` to ${STATUS_CONFIG[suggestedStatus].label}` : ""}`;
  return relatedHref ? (
    <Link
      href={relatedHref}
      aria-label={`${label}, open item`}
      className={cn(PILL_BASE, palette, "hover:brightness-95", className)}
    >
      {content}
    </Link>
  ) : (
    <span aria-label={label} className={cn(PILL_BASE, palette, className)}>
      {content}
    </span>
  );
}
