"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Plus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWidgetStore } from "@/lib/stores/widget-store";
import { WIDGET_REGISTRY, type WidgetMeta } from "./widget-registry";

const GROUP_LABELS: Record<string, string> = {
  pulse: "Health",
  agenda: "Meeting",
  workload: "People",
};

export function AddWidgetButton() {
  const [open, setOpen] = React.useState(false);
  const { widgets, addWidget, resetToDefault } = useWidgetStore();
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const activeTypes = new Set(widgets.map((w) => w.type));

  const groups = React.useMemo(() => {
    const map = new Map<string, WidgetMeta[]>();
    for (const w of WIDGET_REGISTRY) {
      const list = map.get(w.group) ?? [];
      list.push(w);
      map.set(w.group, list);
    }
    return map;
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={cn(
          "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors cursor-pointer",
          "border border-dashed border-rule-strong text-ink-3 hover:text-ink hover:border-ink-3"
        )}
      >
        <Plus className="size-3.5" />
        Add widget
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 mt-2 z-50 w-80 rounded-xl border border-rule bg-card p-4 shadow-xl"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-ink">Widgets</p>
              <button
                type="button"
                onClick={() => {
                  resetToDefault();
                  setOpen(false);
                }}
                className="flex items-center gap-1.5 text-[11px] text-ink-4 hover:text-ink transition-colors cursor-pointer"
              >
                <RotateCcw className="size-3" />
                Reset
              </button>
            </div>

            <div className="space-y-4">
              {Array.from(groups.entries()).map(([group, items]) => (
                <div key={group}>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-ink-4 mb-2">
                    {GROUP_LABELS[group] ?? group}
                  </p>
                  <div className="space-y-1">
                    {items.map((w) => {
                      const isActive = activeTypes.has(w.type);
                      return (
                        <button
                          key={w.type}
                          type="button"
                          disabled={isActive}
                          onClick={() => {
                            addWidget(w.type);
                            setOpen(false);
                          }}
                          className={cn(
                            "flex items-start gap-3 w-full rounded-lg px-3 py-2.5 text-left transition-colors cursor-pointer",
                            isActive
                              ? "opacity-40 cursor-not-allowed"
                              : "hover:bg-paper-2"
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-ink">
                              {w.name}
                              {w.span === 2 && (
                                <span className="ml-1.5 text-[10px] font-mono text-ink-4">wide</span>
                              )}
                            </p>
                            <p className="text-xs text-ink-3 mt-0.5">{w.description}</p>
                          </div>
                          {isActive && (
                            <span className="text-[10px] font-mono text-ink-4 mt-0.5 shrink-0">added</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
