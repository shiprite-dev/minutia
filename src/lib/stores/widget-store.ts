"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface WidgetInstance {
  id: string;
  type: string;
}

const DEFAULT_WIDGETS: WidgetInstance[] = [
  { id: "hero-1", type: "hero" },
  { id: "next-meeting-1", type: "next-meeting" },
  { id: "outstanding-1", type: "outstanding" },
  { id: "series-1", type: "series" },
  { id: "decisions-1", type: "decisions" },
  { id: "age-1", type: "age" },
];

interface WidgetState {
  widgets: WidgetInstance[];
  addWidget: (type: string) => void;
  removeWidget: (id: string) => void;
  moveWidget: (fromIndex: number, toIndex: number) => void;
  resetToDefault: () => void;
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

      resetToDefault: () => set({ widgets: DEFAULT_WIDGETS }),
    }),
    { name: "minutia-widgets" }
  )
);
