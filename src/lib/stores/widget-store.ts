"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface WidgetInstance {
  id: string;
  type: string;
  span?: 1 | 2;
  layout?: WidgetLayout;
}

export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

type StoredWidgetInstance = Omit<WidgetInstance, "layout"> & {
  layout?: WidgetLayout;
  span?: 1 | 2;
};

const DEFAULT_WIDGETS: WidgetInstance[] = [
  { id: "hero-1", type: "hero" },
  { id: "next-meeting-1", type: "next-meeting" },
  { id: "outstanding-1", type: "outstanding" },
  { id: "series-1", type: "series" },
  { id: "decisions-1", type: "decisions" },
  { id: "age-1", type: "age" },
];

const DEFAULT_WIDGET_IDS = new Set(DEFAULT_WIDGETS.map((widget) => widget.id));

interface WidgetState {
  widgets: WidgetInstance[];
  addWidget: (type: string) => void;
  removeWidget: (id: string) => void;
  moveWidget: (fromIndex: number, toIndex: number) => void;
  toggleSpan: (id: string) => void;
  syncLayouts: (layouts: Record<string, WidgetLayout>) => void;
  resetToDefault: () => void;
}

const DEFAULT_LAYOUTS: Record<string, WidgetLayout> = {
  hero: { x: 0, y: 0, w: 6, h: 3 },
  "next-meeting": { x: 6, y: 0, w: 3, h: 3 },
  series: { x: 9, y: 0, w: 3, h: 3 },
  outstanding: { x: 0, y: 3, w: 12, h: 5 },
  decisions: { x: 0, y: 8, w: 3, h: 3 },
  age: { x: 3, y: 8, w: 3, h: 3 },
  "stale-items": { x: 6, y: 8, w: 3, h: 3 },
  "series-health": { x: 0, y: 11, w: 6, h: 4 },
  "meeting-triage": { x: 6, y: 11, w: 6, h: 4 },
  workload: { x: 0, y: 15, w: 6, h: 4 },
};

const DEFAULT_SIZES: Record<string, Pick<WidgetLayout, "w" | "h">> = {
  hero: { w: 6, h: 3 },
  "next-meeting": { w: 3, h: 3 },
  series: { w: 3, h: 3 },
  outstanding: { w: 12, h: 5 },
  decisions: { w: 3, h: 3 },
  age: { w: 3, h: 3 },
  "stale-items": { w: 3, h: 3 },
  "series-health": { w: 6, h: 4 },
  "meeting-triage": { w: 6, h: 4 },
  workload: { w: 6, h: 4 },
};

const NARROW_HEIGHTS: Record<string, number> = {
  hero: 4,
  "next-meeting": 4,
  "series-health": 5,
  "meeting-triage": 5,
  workload: 5,
};

export function getWidgetMinHeight(type: string, width: number) {
  if (width <= 3) return NARROW_HEIGHTS[type] ?? DEFAULT_SIZES[type]?.h ?? 3;
  return DEFAULT_SIZES[type]?.h ?? 3;
}

function isDesktopLayout(layout: WidgetLayout | undefined): layout is WidgetLayout {
  if (!layout) return false;
  return (
    Number.isFinite(layout.x) &&
    Number.isFinite(layout.y) &&
    Number.isFinite(layout.w) &&
    Number.isFinite(layout.h) &&
    layout.x >= 0 &&
    layout.y >= 0 &&
    layout.w >= 3 &&
    layout.w <= 12 &&
    layout.h >= 2 &&
    layout.x + layout.w <= 12
  );
}

export function getWidgetLayout(widget: WidgetInstance, index: number): WidgetLayout {
  if (isDesktopLayout(widget.layout)) {
    return {
      ...widget.layout,
      h: Math.max(widget.layout.h, getWidgetMinHeight(widget.type, widget.layout.w)),
    };
  }

  const fallback = DEFAULT_WIDGET_IDS.has(widget.id)
    ? DEFAULT_LAYOUTS[widget.type]
    : undefined;
  const size = DEFAULT_SIZES[widget.type] ?? {
    w: widget.span === 2 ? 6 : 3,
    h: 3,
  };
  const orderLayout = {
    x: size.w === 12 ? 0 : (index % Math.max(1, 12 / size.w)) * size.w,
    y: Math.floor(index / Math.max(1, 12 / size.w)) * size.h,
    ...size,
  };

  if (!widget.span) return fallback ?? orderLayout;

  const w = widget.span === 2 ? 6 : 3;
  return {
    ...(fallback ?? orderLayout),
    x: Math.min((fallback ?? orderLayout).x, 12 - w),
    w,
  };
}

export const useWidgetStore = create<WidgetState>()(
  persist(
    (set) => ({
      widgets: DEFAULT_WIDGETS,

      addWidget: (type) =>
        set((state) => ({
          widgets: [
            ...state.widgets,
            { id: `${type}-${Date.now()}`, type },
          ],
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
          widgets: state.widgets.map((w, index) => {
            if (w.id !== id) return w;
            const current = getWidgetLayout(w, index);
            const nextWidth = current.w > 3 ? 3 : 6;
            const nextHeight = Math.max(current.h, getWidgetMinHeight(w.type, nextWidth));
            return {
              ...w,
              span: nextWidth === 6 ? 2 : 1,
              layout: {
                ...current,
                x: Math.min(current.x, 12 - nextWidth),
                w: nextWidth,
                h: nextHeight,
              },
            };
          }),
        })),

      syncLayouts: (layouts) =>
        set((state) => {
          let changed = false;
          const widgets = state.widgets.map((w) => {
            const next = layouts[w.id];
            if (!isDesktopLayout(next)) return w;
            if (
              w.layout?.x === next.x &&
              w.layout?.y === next.y &&
              w.layout?.w === next.w &&
              w.layout?.h === next.h
            ) {
              return w;
            }
            changed = true;
            return { ...w, layout: next };
          });
          return changed ? { widgets } : state;
        }),

      resetToDefault: () => set({ widgets: DEFAULT_WIDGETS }),
    }),
    {
      name: "minutia-widgets",
      version: 2,
      migrate: (persisted) => {
        const state = persisted as { widgets?: StoredWidgetInstance[] } | undefined;
        return {
          widgets: (state?.widgets ?? DEFAULT_WIDGETS).map(({
            layout: _layout,
            span: _span,
            ...widget
          }) => widget),
        };
      },
    }
  )
);
