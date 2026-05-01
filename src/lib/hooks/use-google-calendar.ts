"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  GoogleCalendarStatus,
  GoogleCalendarEntry,
  GoogleCalendarEvent,
} from "@/lib/types";
import { seriesKeys } from "./use-series";

export const calendarKeys = {
  status: ["calendar", "status"] as const,
  calendars: ["calendar", "calendars"] as const,
  events: (seriesId: string) => ["calendar", "events", seriesId] as const,
};

export function useGoogleCalendarStatus() {
  return useQuery<GoogleCalendarStatus>({
    queryKey: calendarKeys.status,
    queryFn: async () => {
      const res = await fetch("/api/calendar/status");
      if (!res.ok) throw new Error("Failed to fetch calendar status");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useCalendarList() {
  const { data: status } = useGoogleCalendarStatus();

  return useQuery<GoogleCalendarEntry[]>({
    queryKey: calendarKeys.calendars,
    queryFn: async () => {
      const res = await fetch("/api/calendar/calendars");
      if (!res.ok) throw new Error("Failed to fetch calendars");
      return res.json();
    },
    enabled: !!status?.connected,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCalendarEvents(seriesId: string | undefined) {
  const { data: status } = useGoogleCalendarStatus();

  return useQuery<GoogleCalendarEvent[]>({
    queryKey: calendarKeys.events(seriesId ?? ""),
    queryFn: async () => {
      const res = await fetch(`/api/calendar/events?seriesId=${seriesId}`);
      if (!res.ok) throw new Error("Failed to fetch events");
      return res.json();
    },
    enabled: !!seriesId && !!status?.connected,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useLinkCalendar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ seriesId, calendarId }: { seriesId: string; calendarId: string }) => {
      const res = await fetch("/api/calendar/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seriesId, calendarId }),
      });
      if (!res.ok) throw new Error("Failed to link calendar");
      return res.json();
    },
    onSuccess: (_data, { seriesId }) => {
      queryClient.invalidateQueries({ queryKey: seriesKeys.all });
      queryClient.invalidateQueries({ queryKey: seriesKeys.detail(seriesId) });
      queryClient.invalidateQueries({ queryKey: calendarKeys.events(seriesId) });
    },
  });
}

export function useUnlinkCalendar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (seriesId: string) => {
      const res = await fetch("/api/calendar/unlink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seriesId }),
      });
      if (!res.ok) throw new Error("Failed to unlink calendar");
      return res.json();
    },
    onSuccess: (_data, seriesId) => {
      queryClient.invalidateQueries({ queryKey: seriesKeys.all });
      queryClient.invalidateQueries({ queryKey: seriesKeys.detail(seriesId) });
      queryClient.invalidateQueries({ queryKey: calendarKeys.events(seriesId) });
    },
  });
}

export function useDisconnectGoogle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/google/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("Failed to disconnect");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calendarKeys.status });
      queryClient.invalidateQueries({ queryKey: calendarKeys.calendars });
    },
  });
}
