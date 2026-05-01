"use client";

import { create } from "zustand";

type GroupBy = "series" | "owner" | "priority" | "due" | "none";
type SortBy = "priority" | "recency" | "age" | "due";

interface UIState {
  // Command palette
  commandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;

  // OIL Board filters
  statusFilter: string | null;
  groupBy: GroupBy;
  sortBy: SortBy;
  setStatusFilter: (status: string | null) => void;
  setGroupBy: (groupBy: GroupBy) => void;
  setSortBy: (sortBy: SortBy) => void;

  // Active meeting (live capture mode)
  activeMeetingId: string | null;
  setActiveMeetingId: (id: string | null) => void;

  // Sidebar
  sidebarOpen: boolean;
  toggleSidebar: () => void;

  // Calendar sidebar (right panel)
  calendarSidebarOpen: boolean;
  toggleCalendarSidebar: () => void;
  setCalendarSidebarOpen: (open: boolean) => void;
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
}

export const useUIStore = create<UIState>((set) => ({
  // Command palette
  commandPaletteOpen: false,
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

  // OIL Board filters
  statusFilter: null,
  groupBy: "none",
  sortBy: "priority",
  setStatusFilter: (status) => set({ statusFilter: status }),
  setGroupBy: (groupBy) => set({ groupBy }),
  setSortBy: (sortBy) => set({ sortBy }),

  // Active meeting
  activeMeetingId: null,
  setActiveMeetingId: (id) => set({ activeMeetingId: id }),

  // Sidebar
  sidebarOpen: true,
  toggleSidebar: () =>
    set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  // Calendar sidebar (persisted to localStorage, hydrated via useEffect in CalendarSidebar)
  calendarSidebarOpen: false,
  toggleCalendarSidebar: () =>
    set((state) => {
      const next = !state.calendarSidebarOpen;
      try { localStorage.setItem("minutia:calendar-sidebar", String(next)); } catch {}
      return { calendarSidebarOpen: next };
    }),
  setCalendarSidebarOpen: (open) => {
    try { localStorage.setItem("minutia:calendar-sidebar", String(open)); } catch {}
    set({ calendarSidebarOpen: open });
  },
  selectedDate: new Date(),
  setSelectedDate: (date) => set({ selectedDate: date }),
}));
