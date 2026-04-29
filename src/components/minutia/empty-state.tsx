"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

interface EmptyStateProps {
  variant: "no-series" | "no-issues" | "no-actions";
  onAction?: () => void;
}

const config: Record<
  EmptyStateProps["variant"],
  { message: string; cta?: string }
> = {
  "no-series": {
    message: "Every good log starts with one meeting.",
    cta: "Create your first series",
  },
  "no-issues": {
    message: "Nothing outstanding. Enjoy the quiet.",
  },
  "no-actions": {
    message: "You owe nobody anything right now. Keep it that way.",
  },
};

export function EmptyState({ variant, onAction }: EmptyStateProps) {
  const { message, cta } = config[variant];

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <p
        className={cn(
          "text-ink-2 max-w-sm",
          variant === "no-issues" ? "text-[13px]" : "text-sm"
        )}
      >
        {message}
      </p>

      {cta && onAction && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onAction}
          className="mt-4 text-accent hover:text-accent-hover gap-1"
        >
          {cta}
          <ArrowRight className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
