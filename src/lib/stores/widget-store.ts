"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ColSpan = 1 | 2 | 3 | 4;

export interface WidgetInstance {
  id: string;
  type: string;
  // Width in the 4-column desktop grid. Optional: falls back to the type's
  // footprint default. Set when the user toggles a widget narrow/wide.
  colSpan?: ColSpan;
}

export interface WidgetFootprint {
  colSpan: ColSpan;
  rowSpan: number;
  resizable: boolean;
}

// Order matters in the CSS Grid bento (cards flow in array order). The top
// band fills 4 cols (hero 2 + next-meeting 1 + series 1) before the full-width
// outstanding card, then decisions + age.
const DEFAULT_WIDGETS: WidgetInstance[] = [
  { id: "hero-1", type: "hero" },
  { id: "next-meeting-1", type: "next-meeting" },
  { id: "series-1", type: "series" },
  { id: "outstanding-1", type: "outstanding" },
  { id: "decisions-1", type: "decisions" },
  { id: "age-1", type: "age" },
];

// Per-type bento footprint. colSpan is the default width; rowSpan lets a widget
// span multiple content-sized bands so it aligns with stacked neighbors.
const FOOTPRINTS: Record<string, WidgetFootprint> = {
  hero: { colSpan: 2, rowSpan: 1, resizable: true },
  "next-meeting": { colSpan: 1, rowSpan: 1, resizable: true },
  series: { colSpan: 1, rowSpan: 1, resizable: true },
  outstanding: { colSpan: 4, rowSpan: 1, resizable: false },
  decisions: { colSpan: 1, rowSpan: 1, resizable: true },
  age: { colSpan: 1, rowSpan: 1, resizable: true },
  "stale-items": { colSpan: 1, rowSpan: 1, resizable: true },
  "series-health": { colSpan: 2, rowSpan: 1, resizable: true },
  "meeting-triage": { colSpan: 2, rowSpan: 1, resizable: true },
  workload: { colSpan: 2, rowSpan: 1, resizable: true },
};

export function getWidgetFootprint(type: string): WidgetFootprint {
  return FOOTPRINTS[type] ?? { colSpan: 1, rowSpan: 1, resizable: true };
}

export function getWidgetColSpan(widget: WidgetInstance): ColSpan {
  return widget.colSpan ?? getWidgetFootprint(widget.type).colSpan;
}

interface WidgetState {
  widgets: WidgetInstance[];
  addWidget: (type: string) => void;
  removeWidget: (id: string) => void;
  moveWidget: (fromIndex: number, toIndex: number) => void;
  toggleSpan: (id: string) => void;
  resetToDefault: () => void;
}

export const useWidgetStore = create<WidgetState>()(
  persist(
    (set) => ({
      widgets: DEFAULT_WIDGETS,

      addWidget: (type) =>
        set((state) => ({
          widgets: [...state.widgets, { id: `${type}-${Date.now()}`, type }],
        })),

      removeWidget: (id) =>
        set((state) => ({
          widgets: state.widgets.filter((w) => w.id !== id),
        })),

      moveWidget: (fromIndex, toIndex) =>
        set((state) => {
          const next = [...state.widgets];
          const [moved] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, moved);
          return { widgets: next };
        }),

      toggleSpan: (id) =>
        set((state) => ({
          widgets: state.widgets.map((w) => {
            if (w.id !== id) return w;
            const footprint = getWidgetFootprint(w.type);
            if (!footprint.resizable) return w;
            const current = w.colSpan ?? footprint.colSpan;
            return { ...w, colSpan: current >= 2 ? 1 : 2 };
          }),
        })),

      resetToDefault: () => set({ widgets: DEFAULT_WIDGETS }),
    }),
    {
      name: "minutia-widgets",
      version: 3,
      // Drop GridStack-era layout fields (x/y/w/h, span). Keep id/type/colSpan
      // and preserve order.
      migrate: (persisted) => {
        const state = persisted as { widgets?: Array<Record<string, unknown>> } | undefined;
        const widgets = (state?.widgets ?? DEFAULT_WIDGETS).map((w) => {
          const colSpan = w.colSpan;
          return {
            id: String(w.id),
            type: String(w.type),
            ...(colSpan === 1 || colSpan === 2 || colSpan === 3 || colSpan === 4
              ? { colSpan: colSpan as ColSpan }
              : {}),
          };
        });
        return { widgets };
      },
    }
  )
);
