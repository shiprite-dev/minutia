"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { HintTooltip } from "@/components/minutia/hint-tooltip";
import {
  getWidgetColSpan,
  getWidgetFootprint,
  useWidgetStore,
} from "@/lib/stores/widget-store";

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

  const footprint = widget ? getWidgetFootprint(widget.type) : undefined;
  const colSpan = widget ? getWidgetColSpan(widget) : 1;
  const rowSpan = footprint?.rowSpan ?? 1;
  const canResize = footprint?.resizable ?? false;
  const isWide = colSpan >= 2;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  function handleRemove() {
    removeWidget(id);
  }

  return (
    <motion.div
      ref={setNodeRef}
      data-testid={`widget-${id}`}
      data-widget-type={widget?.type}
      data-col-span={colSpan}
      data-row-span={rowSpan}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.05, duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 20 : undefined,
      }}
      className={cn("widget-cell group", isDragging && "is-dragging", className)}
    >
      <div className="widget-card-content relative h-full rounded-xl border border-rule bg-card p-6 min-w-0">
        <div
          className={cn(
            "absolute top-2.5 right-2.5 z-10 flex items-center gap-1 opacity-0 pointer-events-none transition-opacity",
            "group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
          )}
        >
          <HintTooltip label="Drag to reorder this widget.">
            <button
              type="button"
              {...attributes}
              {...listeners}
              className="widget-drag-handle flex items-center justify-center size-6 rounded-full bg-paper-2 text-ink-4 hover:text-ink hover:bg-paper-3 transition-colors cursor-grab active:cursor-grabbing touch-none"
              aria-label="Drag to reorder"
            >
              <GripVertical className="size-3" />
            </button>
          </HintTooltip>
          {canResize && (
            <HintTooltip label={isWide ? "Make this widget narrow." : "Make this widget wide."}>
              <button
                type="button"
                onClick={() => toggleSpan(id)}
                className="flex items-center justify-center size-6 rounded-full bg-paper-2 text-ink-4 hover:text-ink hover:bg-paper-3 transition-colors cursor-pointer"
                aria-label={isWide ? "Make narrow" : "Make wide"}
              >
                {isWide ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
              </button>
            </HintTooltip>
          )}
          <HintTooltip label="Remove this widget from the dashboard.">
            <button
              type="button"
              onClick={handleRemove}
              className="flex items-center justify-center size-6 rounded-full bg-paper-2 text-ink-4 hover:text-ink hover:bg-paper-3 transition-colors cursor-pointer"
              aria-label="Remove widget"
            >
              <X className="size-3" />
            </button>
          </HintTooltip>
        </div>
        {children}
      </div>
    </motion.div>
  );
}
