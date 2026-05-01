"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWidgetStore } from "@/lib/stores/widget-store";
import { getWidgetMeta } from "./widget-registry";

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
  const toggleSpan = useWidgetStore((s) => s.toggleSpan);
  const widget = useWidgetStore((s) => s.widgets.find((w) => w.id === id));
  const [hovered, setHovered] = React.useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const registrySpan = widget ? getWidgetMeta(widget.type)?.span : undefined;
  const currentSpan = widget?.span ?? registrySpan ?? 1;
  const canResize = registrySpan !== undefined;

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: isDragging ? 0.5 : 1, x: 0 }}
      exit={{ opacity: 0, x: -20, transition: { duration: 0.15 } }}
      transition={{
        delay: index * 0.06,
        duration: 0.32,
        ease: [0.2, 0.8, 0.2, 1],
      }}
      className={cn(
        "relative rounded-xl border border-rule bg-card p-6",
        isDragging && "z-50 shadow-lg",
        className
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...attributes}
    >
      {hovered && (
        <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1">
          <button
            ref={setActivatorNodeRef}
            type="button"
            className="flex items-center justify-center size-6 rounded-full bg-paper-2 text-ink-4 hover:text-ink hover:bg-paper-3 transition-colors cursor-grab active:cursor-grabbing"
            aria-label="Drag to reorder"
            {...listeners}
          >
            <GripVertical className="size-3" />
          </button>
          {canResize && (
            <button
              type="button"
              onClick={() => toggleSpan(id)}
              className="flex items-center justify-center size-6 rounded-full bg-paper-2 text-ink-4 hover:text-ink hover:bg-paper-3 transition-colors cursor-pointer"
              aria-label={currentSpan === 2 ? "Make narrow" : "Make wide"}
            >
              {currentSpan === 2 ? (
                <Minimize2 className="size-3" />
              ) : (
                <Maximize2 className="size-3" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => removeWidget(id)}
            className="flex items-center justify-center size-6 rounded-full bg-paper-2 text-ink-4 hover:text-ink hover:bg-paper-3 transition-colors cursor-pointer"
            aria-label="Remove widget"
          >
            <X className="size-3" />
          </button>
        </div>
      )}
      {children}
    </motion.div>
  );
}
