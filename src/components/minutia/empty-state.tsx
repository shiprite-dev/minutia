"use client";

import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

interface EmptyStateProps {
  variant: "no-series" | "no-issues" | "no-actions" | "no-meetings";
  onAction?: () => void;
}

const config: Record<
  EmptyStateProps["variant"],
  { message: string; sub?: string; cta?: string }
> = {
  "no-series": {
    message: "Every good log starts with one meeting.",
    sub: "Create a series to start tracking what matters.",
    cta: "Create your first series",
  },
  "no-issues": {
    message: "Nothing outstanding.",
    sub: "Enjoy the quiet.",
  },
  "no-actions": {
    message: "You owe nobody anything right now.",
    sub: "Keep it that way.",
  },
  "no-meetings": {
    message: "No meetings yet.",
    sub: "Start your first one above.",
  },
};

function RuleDivider() {
  return (
    <motion.div
      className="flex items-center gap-1 mb-5"
      aria-hidden="true"
      initial={{ opacity: 0, scaleX: 0 }}
      animate={{ opacity: 1, scaleX: 1 }}
      transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <span className="h-px w-8 bg-rule-strong" />
      <span className="size-1 rounded-full bg-accent" />
      <span className="h-px w-8 bg-rule-strong" />
    </motion.div>
  );
}

export function EmptyState({ variant, onAction }: EmptyStateProps) {
  const { message, sub, cta } = config[variant];

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <RuleDivider />

      <motion.p
        className="font-display text-base font-medium text-ink max-w-sm"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
      >
        {message}
      </motion.p>

      {sub && (
        <motion.p
          className={cn(
            "text-ink-3 max-w-sm mt-1.5",
            variant === "no-issues" || variant === "no-actions"
              ? "text-[13px] italic"
              : "text-sm"
          )}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {sub}
        </motion.p>
      )}

      {cta && onAction && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55, duration: 0.3 }}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={onAction}
            className="mt-5 text-accent hover:text-accent-hover gap-1"
          >
            {cta}
            <ArrowRight className="size-3.5" />
          </Button>
        </motion.div>
      )}
    </div>
  );
}
