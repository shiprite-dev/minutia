"use client";

import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface SyncIndicatorProps {
  status: "synced" | "syncing" | "offline";
  pendingCount?: number;
}

const statusLabels: Record<SyncIndicatorProps["status"], string> = {
  synced: "Synced",
  syncing: "Syncing",
  offline: "Offline, buffering changes",
};

export function SyncIndicator({ status, pendingCount = 0 }: SyncIndicatorProps) {
  const isOffline = status === "offline";

  return (
    <div className="relative">
      <motion.div
        role="status"
        aria-label={
          isOffline && pendingCount > 0
            ? `${pendingCount} item${pendingCount === 1 ? "" : "s"} buffered`
            : statusLabels[status]
        }
        className={cn(
          "h-px w-full",
          status === "synced" && "bg-success",
          status === "syncing" && "bg-warn",
          isOffline && "bg-transparent"
        )}
        initial={{ opacity: 0 }}
        animate={{
          opacity: status === "syncing" ? [0.4, 1, 0.4] : 1,
        }}
        transition={
          status === "syncing"
            ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" }
            : { duration: 0.18 }
        }
      />
      {/* Amber dashed line for offline */}
      {isOffline && (
        <div
          className="absolute inset-0 h-px w-full"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, #f59e0b 0, #f59e0b 6px, transparent 6px, transparent 12px)",
          }}
        />
      )}
      {/* Pending count label */}
      {isOffline && pendingCount > 0 && (
        <div className="absolute right-3 -bottom-5 flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-warn" />
          <span className="text-[10px] font-mono text-warn tabular-nums">
            {pendingCount} item{pendingCount === 1 ? "" : "s"} buffered
          </span>
        </div>
      )}
    </div>
  );
}
