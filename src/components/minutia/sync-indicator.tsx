"use client";

import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface SyncIndicatorProps {
  status: "synced" | "syncing" | "offline";
}

const statusStyles: Record<SyncIndicatorProps["status"], string> = {
  synced: "bg-success",
  syncing: "bg-warn",
  offline: "bg-warn",
};

const statusLabels: Record<SyncIndicatorProps["status"], string> = {
  synced: "Synced",
  syncing: "Syncing",
  offline: "Offline, buffering changes",
};

export function SyncIndicator({ status }: SyncIndicatorProps) {
  return (
    <motion.div
      role="status"
      aria-label={statusLabels[status]}
      className={cn("h-px w-full", statusStyles[status])}
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
  );
}
