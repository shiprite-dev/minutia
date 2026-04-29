"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { STATUS_CONFIG, ISSUE_STATUSES } from "@/lib/constants";
import type { IssueStatus } from "@/lib/types";

interface StatusChipProps {
  status: IssueStatus;
  onChange?: (newStatus: IssueStatus) => void;
  readonly?: boolean;
}

const statusColorMap: Record<IssueStatus, { bg: string; text: string }> = {
  open: { bg: "bg-paper-3", text: "text-ink" },
  in_progress: { bg: "bg-accent-soft", text: "text-accent" },
  pending: { bg: "bg-warn-soft", text: "text-warn" },
  resolved: { bg: "bg-success-soft", text: "text-success" },
  dropped: { bg: "bg-paper-3", text: "text-ink-3" },
};

export function StatusChip({ status, onChange, readonly }: StatusChipProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [focusedIndex, setFocusedIndex] = React.useState(-1);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const isInteractive = !readonly && !!onChange;

  const config = STATUS_CONFIG[status];
  const colors = statusColorMap[status];

  React.useEffect(() => {
    if (!expanded) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setExpanded(false);
        setFocusedIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [expanded]);

  function handleToggle() {
    if (!isInteractive) return;
    setExpanded((prev) => !prev);
    setFocusedIndex(-1);
  }

  function handleSelect(newStatus: IssueStatus) {
    if (newStatus !== status) {
      onChange?.(newStatus);
    }
    setExpanded(false);
    setFocusedIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isInteractive) return;

    if (!expanded) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleToggle();
      }
      return;
    }

    const statuses = ISSUE_STATUSES.filter((s) => s !== status);

    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        setFocusedIndex((prev) =>
          prev >= statuses.length - 1 ? 0 : prev + 1
        );
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        setFocusedIndex((prev) =>
          prev <= 0 ? statuses.length - 1 : prev - 1
        );
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < statuses.length) {
          handleSelect(statuses[focusedIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setExpanded(false);
        setFocusedIndex(-1);
        break;
    }
  }

  const otherStatuses = ISSUE_STATUSES.filter((s) => s !== status);

  return (
    <div ref={containerRef} className="inline-flex">
      <motion.div
        layout
        className="inline-flex items-center gap-1 overflow-hidden"
        transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <button
          type="button"
          role={isInteractive ? "combobox" : undefined}
          aria-expanded={isInteractive ? expanded : undefined}
          aria-label={`Status: ${config.label}`}
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
            colors.bg,
            colors.text,
            isInteractive && "cursor-pointer hover:opacity-80",
            !isInteractive && "cursor-default"
          )}
          onClick={handleToggle}
          onKeyDown={handleKeyDown}
          tabIndex={0}
        >
          {config.label}
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "auto", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
              className="flex items-center gap-1 overflow-hidden"
              role="listbox"
              aria-label="Select status"
            >
              {otherStatuses.map((s, i) => {
                const sConfig = STATUS_CONFIG[s];
                const sColors = statusColorMap[s];
                return (
                  <motion.button
                    key={s}
                    type="button"
                    role="option"
                    aria-selected={false}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    transition={{
                      duration: 0.12,
                      delay: i * 0.03,
                      ease: [0.2, 0.8, 0.2, 1],
                    }}
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium cursor-pointer transition-colors hover:opacity-80",
                      sColors.bg,
                      sColors.text,
                      focusedIndex === i && "ring-2 ring-ring"
                    )}
                    onClick={() => handleSelect(s)}
                    tabIndex={-1}
                  >
                    {sConfig.label}
                  </motion.button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
