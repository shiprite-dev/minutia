"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  getPendingItems,
  removePendingItem,
  getPendingCount,
  type PendingItem,
} from "@/lib/offline-buffer";
import { issueKeys } from "@/lib/hooks/use-issues";
import type { IssueStatus } from "@/lib/types";

export type SyncStatus = "synced" | "syncing" | "offline";

export function useOfflineSync() {
  const queryClient = useQueryClient();
  const [isOnline, setIsOnline] = React.useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [pendingCount, setPendingCount] = React.useState(0);
  const [syncStatus, setSyncStatus] = React.useState<SyncStatus>(
    typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "synced"
  );
  const flushingRef = React.useRef(false);

  // Refresh pending count from IndexedDB
  const refreshCount = React.useCallback(async () => {
    try {
      const count = await getPendingCount();
      setPendingCount(count);
      return count;
    } catch {
      return 0;
    }
  }, []);

  // Flush all pending items to Supabase
  const flush = React.useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    setSyncStatus("syncing");

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        flushingRef.current = false;
        setSyncStatus("offline");
        return;
      }

      const items = await getPendingItems();
      const affectedSeries = new Set<string>();
      const affectedMeetings = new Set<string>();

      for (const item of items) {
        try {
          if (item.type === "decision") {
            const { error } = await supabase.from("decisions").insert({
              title: item.title,
              meeting_id: item.meeting_id,
              series_id: item.series_id,
            });
            if (error) throw error;
          } else {
            const { error } = await supabase.from("issues").insert({
              title: item.title,
              category: item.category ?? "action",
              priority: (item.priority ?? "medium") as string,
              raised_in_meeting_id: item.meeting_id,
              series_id: item.series_id,
              status: "open" as IssueStatus,
              source: "manual",
              owner_user_id: user.id,
            });
            if (error) throw error;
          }

          await removePendingItem(item.id);
          affectedSeries.add(item.series_id);
          affectedMeetings.add(item.meeting_id);
        } catch {
          // If a single item fails, stop flushing; we will retry on next online event
          break;
        }
      }

      // Invalidate caches for all affected series/meetings
      if (affectedSeries.size > 0 || affectedMeetings.size > 0) {
        queryClient.invalidateQueries({ queryKey: issueKeys.all });
        for (const sid of affectedSeries) {
          queryClient.invalidateQueries({ queryKey: issueKeys.list(sid) });
        }
        for (const mid of affectedMeetings) {
          queryClient.invalidateQueries({
            queryKey: ["meetings", "detail", mid],
          });
        }
        queryClient.invalidateQueries({ queryKey: ["decisions"] });
      }

      const remaining = await refreshCount();
      setSyncStatus(remaining > 0 ? "offline" : "synced");
    } catch {
      setSyncStatus("offline");
    } finally {
      flushingRef.current = false;
    }
  }, [queryClient, refreshCount]);

  // Listen to online/offline events
  React.useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      flush();
    }

    function handleOffline() {
      setIsOnline(false);
      setSyncStatus("offline");
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Initial count load
    refreshCount();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [flush, refreshCount]);

  return { isOnline, pendingCount, syncStatus, refreshCount, flush };
}
