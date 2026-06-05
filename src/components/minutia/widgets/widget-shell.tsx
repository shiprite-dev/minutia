"use client";

import * as React from "react";
import { motion } from "motion/react";
import { GripVertical, X, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { HintTooltip } from "@/components/minutia/hint-tooltip";
import { getWidgetLayout, getWidgetMinHeight, useWidgetStore } from "@/lib/stores/widget-store";
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
  const widgetIndex = useWidgetStore((s) => s.widgets.findIndex((w) => w.id === id));

  const registrySpan = widget ? getWidgetMeta(widget.type)?.span : undefined;
  const layout = widget ? getWidgetLayout(widget, Math.max(widgetIndex, index)) : undefined;
  const currentSpan = layout?.w && layout.w > 4 ? 2 : widget?.span ?? registrySpan ?? 1;
  const canResize = registrySpan !== undefined && widget?.type !== "outstanding";
  const minHeight = widget && layout ? getWidgetMinHeight(widget.type, layout.w) : 2;
  const gridAttrs = layout
    ? {
        "gs-id": id,
        "gs-x": layout.x,
        "gs-y": layout.y,
        "gs-w": layout.w,
        "gs-h": layout.h,
        "gs-min-w": 3,
        "gs-min-h": minHeight,
        ...(widget?.type === "outstanding" ? { "gs-no-resize": "true" } : {}),
      }
    : {};
  function handleRemove(event: React.MouseEvent<HTMLButtonElement>) {
    const canvas = event.currentTarget.closest("[data-testid='dashboard-widget-canvas']");
    removeWidget(id);
    canvas?.dispatchEvent(
      new CustomEvent("minutia:widget-remove", {
        detail: { id },
      })
    );
  }

  return (
    <motion.div
      data-testid={`widget-${id}`}
      data-widget-type={widget?.type}
      data-widget-width={layout?.w}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20, transition: { duration: 0.15 } }}
      transition={{
        delay: index * 0.06,
        duration: 0.32,
        ease: [0.2, 0.8, 0.2, 1],
      }}
      className={cn(
        "grid-stack-item group",
        className
      )}
      {...gridAttrs}
    >
      <div className="grid-stack-item-content relative rounded-xl border border-rule bg-card p-6">
        <div
          className={cn(
            "absolute top-2.5 right-2.5 z-10 flex items-center gap-1 opacity-0 pointer-events-none transition-opacity",
            "group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
          )}
        >
          <HintTooltip label="Drag to reorder this widget.">
            <button
              type="button"
              className="widget-drag-handle flex items-center justify-center size-6 rounded-full bg-paper-2 text-ink-4 hover:text-ink hover:bg-paper-3 transition-colors cursor-grab active:cursor-grabbing"
              aria-label="Drag to reorder"
            >
              <GripVertical className="size-3" />
            </button>
          </HintTooltip>
          {canResize && (
            <HintTooltip
              label={currentSpan === 2 ? "Make this widget narrow." : "Make this widget wide."}
            >
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
        <div className="widget-card-content min-w-0">
          {children}
        </div>
      </div>
    </motion.div>
  );
}
