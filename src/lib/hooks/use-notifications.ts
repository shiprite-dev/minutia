"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { applyOptimistic, patch } from "@/lib/optimistic";
import { markRead, markAllRead } from "@/lib/optimistic-updates";
import type { Notification } from "@/lib/types";

export const notificationKeys = {
  all: ["notifications"] as const,
  unreadCount: ["notifications", "unread-count"] as const,
};

export function useNotifications() {
  const supabase = createClient();

  return useQuery<Notification[]>({
    queryKey: notificationKeys.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      return data as Notification[];
    },
  });
}

export function useUnreadCount() {
  const supabase = createClient();

  return useQuery<number>({
    queryKey: notificationKeys.unreadCount,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("read", false);

      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 30000,
  });
}

export function useMarkAsRead() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation<void, Error, string, { rollback: () => void }>({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("id", notificationId);

      if (error) throw error;
    },
    onMutate: (notificationId) => {
      // Only decrement the badge when the row is actually still unread in cache,
      // so the count can never drift below truth regardless of the caller.
      const wasUnread = queryClient
        .getQueriesData<Notification[]>({ queryKey: notificationKeys.all })
        .some(([, data]) => data?.some((n) => n.id === notificationId && !n.read));
      const patches = [
        patch<Notification[]>({ queryKey: notificationKeys.all }, markRead(notificationId)),
      ];
      if (wasUnread) {
        patches.push(
          patch<number>({ queryKey: notificationKeys.unreadCount }, (n) => Math.max(0, n - 1))
        );
      }
      return applyOptimistic(queryClient, patches);
    },
    onError: (_err, _vars, context) => context?.rollback(),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
      queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount });
    },
  });
}

export function useMarkAllAsRead() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation<void, Error, void, { rollback: () => void }>({
    mutationFn: async () => {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("read", false);

      if (error) throw error;
    },
    onMutate: () =>
      applyOptimistic(queryClient, [
        patch<Notification[]>({ queryKey: notificationKeys.all }, markAllRead()),
        patch<number>({ queryKey: notificationKeys.unreadCount }, () => 0),
      ]),
    onError: (_err, _vars, context) => context?.rollback(),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
      queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount });
    },
  });
}
