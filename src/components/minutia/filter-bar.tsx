"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { STATUS_CONFIG, ISSUE_STATUSES } from "@/lib/constants";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";

interface FilterBarProps {
  statusFilter: string | null;
  groupBy: string;
  sortBy: string;
  issueCounts: Record<string, number>;
  onStatusFilterChange: (status: string | null) => void;
  onGroupByChange: (groupBy: string) => void;
  onSortByChange: (sortBy: string) => void;
}

const groupByOptions = [
  { value: "none", label: "None" },
  { value: "series", label: "Series" },
  { value: "owner", label: "Owner" },
  { value: "priority", label: "Priority" },
  { value: "due", label: "Due Date" },
];

const sortByOptions = [
  { value: "priority", label: "Priority" },
  { value: "recency", label: "Recency" },
  { value: "age", label: "Age" },
  { value: "due", label: "Due Date" },
];

export function FilterBar({
  statusFilter,
  groupBy,
  sortBy,
  issueCounts,
  onStatusFilterChange,
  onGroupByChange,
  onSortByChange,
}: FilterBarProps) {
  const totalCount = Object.values(issueCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-3">
      {/* Status filter tabs */}
      <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Filter by status">
        <button
          type="button"
          role="tab"
          aria-selected={statusFilter === null}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
            statusFilter === null
              ? "bg-ink text-paper"
              : "bg-paper-2 text-ink-3 hover:text-ink-2 hover:bg-paper-3"
          )}
          onClick={() => onStatusFilterChange(null)}
        >
          All
          {totalCount > 0 && (
            <span
              className={cn(
                "text-[10px] tabular-nums",
                statusFilter === null ? "text-paper/70" : "text-ink-4"
              )}
            >
              {totalCount}
            </span>
          )}
        </button>

        {ISSUE_STATUSES.map((status) => {
          const config = STATUS_CONFIG[status];
          const count = issueCounts[status] ?? 0;
          const isActive = statusFilter === status;

          return (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                isActive
                  ? "bg-ink text-paper"
                  : "bg-paper-2 text-ink-3 hover:text-ink-2 hover:bg-paper-3"
              )}
              onClick={() => onStatusFilterChange(status)}
            >
              {config.label}
              {count > 0 && (
                <span
                  className={cn(
                    "text-[10px] tabular-nums",
                    isActive ? "text-paper/70" : "text-ink-4"
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Group by + Sort by */}
      <div className="flex items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="text-xs text-ink-3 gap-1">
              Group: {groupByOptions.find((o) => o.value === groupBy)?.label}
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {groupByOptions.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => onGroupByChange(option.value)}
                className={cn(groupBy === option.value && "font-medium")}
              >
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="text-xs text-ink-3 gap-1">
              Sort: {sortByOptions.find((o) => o.value === sortBy)?.label}
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {sortByOptions.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => onSortByChange(option.value)}
                className={cn(sortBy === option.value && "font-medium")}
              >
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
