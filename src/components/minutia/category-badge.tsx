"use client";

import { cn } from "@/lib/utils";
import { CATEGORY_CONFIG } from "@/lib/constants";
import type { IssueCategory } from "@/lib/types";

interface CategoryBadgeProps {
  category: IssueCategory;
  size?: "sm" | "md";
}

export function CategoryBadge({ category, size = "sm" }: CategoryBadgeProps) {
  const config = CATEGORY_CONFIG[category];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-ink-2",
        size === "sm" && "text-xs",
        size === "md" && "text-sm"
      )}
    >
      <span aria-hidden="true">{config.glyph}</span>
      <span>{config.label}</span>
    </span>
  );
}
