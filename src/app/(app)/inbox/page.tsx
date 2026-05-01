"use client";

import * as React from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import {
  Bell,
  CheckCheck,
  ArrowRight,
  CircleDot,
  UserPlus,
  Play,
  Square,
  FileText,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useNotifications,
  useMarkAsRead,
  useMarkAllAsRead,
} from "@/lib/hooks/use-notifications";
import type { Notification, NotificationType } from "@/lib/types";

function notificationIcon(type: NotificationType) {
  switch (type) {
    case "issue_status_changed":
      return CircleDot;
    case "issue_assigned":
      return UserPlus;
    case "meeting_starting":
      return Play;
    case "meeting_completed":
      return Square;
    case "brief_ready":
      return FileText;
    case "share_received":
      return Share2;
    default:
      return Bell;
  }
}

function notificationColor(type: NotificationType): string {
  switch (type) {
    case "issue_status_changed":
      return "text-accent";
    case "issue_assigned":
      return "text-ink";
    case "meeting_starting":
      return "text-success";
    case "meeting_completed":
      return "text-ink-3";
    case "brief_ready":
      return "text-warn";
    case "share_received":
      return "text-accent";
    default:
      return "text-ink-3";
  }
}

function relativeTime(date: Date | string): string {
  const now = Date.now();
  const d = new Date(date).getTime();
  const diff = now - d;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function NotificationItem({
  notification,
  onMarkRead,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
}) {
  const Icon = notificationIcon(notification.type);
  const color = notificationColor(notification.type);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
    >
      <Link
        href={notification.link ?? "#"}
        onClick={() => {
          if (!notification.read) onMarkRead(notification.id);
        }}
        className={cn(
          "flex items-start gap-3 rounded-lg px-4 py-3.5 transition-all",
          notification.read
            ? "opacity-60 hover:opacity-80 hover:bg-paper-2"
            : "bg-card hover:bg-paper-3"
        )}
      >
        {!notification.read && (
          <span className="mt-1.5 size-1.5 rounded-full bg-accent shrink-0" />
        )}
        <span className={cn("mt-0.5 shrink-0", color)}>
          <Icon className="size-4" />
        </span>
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "text-sm leading-snug",
              notification.read ? "text-ink-3" : "text-ink font-medium"
            )}
          >
            {notification.title}
          </p>
          {notification.body && (
            <p className="text-xs text-ink-4 mt-0.5 truncate">
              {notification.body}
            </p>
          )}
          <span className="text-[10px] font-mono text-ink-4 mt-1 block">
            {relativeTime(notification.created_at)}
          </span>
        </div>
        <ArrowRight className="size-3.5 text-ink-4 mt-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </Link>
    </motion.div>
  );
}

export default function InboxPage() {
  const { data: notifications, isLoading } = useNotifications();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();

  const unread = (notifications ?? []).filter((n) => !n.read);
  const read = (notifications ?? []).filter((n) => n.read);
  const hasUnread = unread.length > 0;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-32 bg-paper-2 rounded" />
          <div className="h-16 bg-paper-2 rounded-lg" />
          <div className="h-16 bg-paper-2 rounded-lg" />
          <div className="h-16 bg-paper-2 rounded-lg" />
        </div>
      </div>
    );
  }

  const isEmpty = (notifications ?? []).length === 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">
            Inbox
          </h1>
          {hasUnread && (
            <p className="text-xs text-ink-4 mt-1">
              {unread.length} unread notification{unread.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        {hasUnread && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => markAllAsRead.mutate()}
            disabled={markAllAsRead.isPending}
            className="text-ink-3 hover:text-ink"
          >
            <CheckCheck className="size-4 mr-1.5" />
            Mark all read
          </Button>
        )}
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="font-display text-base font-medium text-ink mb-1.5">All caught up.</p>
          <p className="text-[13px] text-ink-3 italic max-w-xs">
            When something needs your attention, it will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          <AnimatePresence mode="popLayout">
            {unread.map((n) => (
              <NotificationItem
                key={n.id}
                notification={n}
                onMarkRead={(id) => markAsRead.mutate(id)}
              />
            ))}
          </AnimatePresence>

          {read.length > 0 && (
            <>
              {hasUnread && (
                <div className="flex items-center gap-3 py-3">
                  <div className="flex-1 border-t border-dashed border-rule" />
                  <span className="text-[10px] font-mono uppercase tracking-wider text-ink-4">
                    Earlier
                  </span>
                  <div className="flex-1 border-t border-dashed border-rule" />
                </div>
              )}
              <AnimatePresence mode="popLayout">
                {read.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    onMarkRead={(id) => markAsRead.mutate(id)}
                  />
                ))}
              </AnimatePresence>
            </>
          )}
        </div>
      )}
    </div>
  );
}
