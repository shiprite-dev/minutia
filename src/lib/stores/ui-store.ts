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
}));
