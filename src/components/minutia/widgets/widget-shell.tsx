"use client";

import * as React from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWidgetStore } from "@/lib/stores/widget-store";

export function WidgetShell({
  id,
  children,
  className,
  index = 0,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
  index?: number;
}) {
  const removeWidget = useWidgetStore((s) => s.removeWidget);
  const [hovered, setHovered] = React.useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20, transition: { duration: 0.15 } }}
      transition={{
        delay: index * 0.06,
        duration: 0.32,
        ease: [0.2, 0.8, 0.2, 1],
      }}
      className={cn("relative rounded-xl border border-rule bg-card p-6", className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <button
          type="button"
          onClick={() => removeWidget(id)}
          className="absolute top-2.5 right-2.5 z-10 flex items-center justify-center size-6 rounded-full bg-paper-2 text-ink-4 hover:text-ink hover:bg-paper-3 transition-colors cursor-pointer"
          aria-label="Remove widget"
        >
          <X className="size-3" />
        </button>
      )}
      {children}
    </motion.div>
  );
}
