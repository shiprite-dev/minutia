"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Trash2,
} from "lucide-react";
import {
  useIssue,
  useUpdateIssue,
  useUpdateIssueStatus,
  useDeleteIssue,
  useAddIssueUpdate,
} from "@/lib/hooks/use-issues";
import { StatusChip } from "@/components/minutia/status-chip";
import { CategoryBadge } from "@/components/minutia/category-badge";
import { PriorityIndicator } from "@/components/minutia/priority-indicator";
import { TimelineNode } from "@/components/minutia/timeline-node";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { daysBetween } from "@/lib/date-utils";
import { PRIORITIES, STATUS_CONFIG } from "@/lib/constants";
import type { IssueStatus, Priority, IssueUpdate, Meeting } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatISODate(date: Date | string): string {
  return new Date(date).toISOString().split("T")[0];
}

function sourceBadgeLabel(source: string): string {
  const map: Record<string, string> = {
    manual: "Manual",
    transcript: "Transcript",
    email: "Email",
    api: "API",
    ai_suggested: "AI Suggested",
  };
  return map[source] ?? source;
}

// ---------------------------------------------------------------------------
// Inline editable field
// ---------------------------------------------------------------------------

function InlineEditText({
  value,
  onSave,
  className,
  as: Tag = "span",
  placeholder,
  multiline,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
  as?: "span" | "h1" | "p";
  placeholder?: string;
  multiline?: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    } else {
      setDraft(value);
    }
    setEditing(false);
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      commit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  if (editing) {
    if (multiline) {
      return (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className={cn(
            "w-full bg-transparent border border-rule rounded-md px-2 py-1 focus:outline-none focus:border-ink-3 resize-y",
            className
          )}
          rows={3}
          placeholder={placeholder}
        />
      );
    }
    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className={cn(
          "w-full bg-transparent border border-rule rounded-md px-2 py-0.5 focus:outline-none focus:border-ink-3",
          className
        )}
        placeholder={placeholder}
      />
    );
  }

  return (
    <Tag
      className={cn(
        "cursor-pointer hover:bg-paper-2 rounded px-1 -mx-1 transition-colors",
        !value && "text-ink-4 italic",
        className
      )}
      onClick={() => setEditing(true)}
      tabIndex={0}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter") setEditing(true);
      }}
      role="button"
      aria-label={`Edit ${placeholder ?? "field"}`}
    >
      {value || placeholder || "Click to edit"}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// Issue Detail Content
// ---------------------------------------------------------------------------

interface IssueDetailContentProps {
  issueId: string;
}

export function IssueDetailContent({ issueId }: IssueDetailContentProps) {
  const router = useRouter();
  const { data: issue, isLoading, isError } = useIssue(issueId);
  const updateIssue = useUpdateIssue();
  const updateIssueStatus = useUpdateIssueStatus();
  const deleteIssue = useDeleteIssue();
  const addUpdate = useAddIssueUpdate();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [showUpdateForm, setShowUpdateForm] = React.useState(false);
  const [updateNote, setUpdateNote] = React.useState("");
  const updateInputRef = React.useRef<HTMLTextAreaElement>(null);

  const statusCycle: IssueStatus[] = ["open", "pending", "in_progress", "resolved"];

  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "c":
          e.preventDefault();
          setShowUpdateForm(true);
          break;
        case "Escape":
          e.preventDefault();
          router.back();
          break;
        case "r":
          if (issue) {
            e.preventDefault();
            handleStatusChange("resolved");
          }
          break;
        case "d":
          if (issue) {
            e.preventDefault();
            handleStatusChange("dropped");
          }
          break;
        case "s":
          if (issue) {
            e.preventDefault();
            const currentIdx = statusCycle.indexOf(issue.status);
            const nextStatus = statusCycle[(currentIdx + 1) % statusCycle.length];
            handleStatusChange(nextStatus);
          }
          break;
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [issue]);

  React.useEffect(() => {
    if (showUpdateForm) updateInputRef.current?.focus();
  }, [showUpdateForm]);

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="min-h-full bg-paper">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <Skeleton className="h-5 w-20 mb-6" />
          <Skeleton className="h-8 w-80 mb-3" />
          <div className="flex gap-3 mb-4">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-4 w-48 mb-2" />
          <Skeleton className="h-4 w-36 mb-8" />
          <Skeleton className="h-px w-full mb-6" />
          <Skeleton className="h-6 w-40 mb-4" />
          <div className="space-y-6">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      </div>
    );
  }

  // 404
  if (!issue || isError) {
    return (
      <div className="min-h-full bg-paper flex flex-col items-center justify-center gap-4">
        <p className="text-sm text-ink-3">Issue not found.</p>
        <Link
          href="/"
          className="text-sm text-ink-2 hover:text-ink transition-colors underline underline-offset-2"
        >
          Back to OIL Board
        </Link>
      </div>
    );
  }

  // Derived data
  const raisedIn = issue.raised_in_meeting;
  const updates = [...(issue.updates ?? [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const durationDays = daysBetween(
    issue.created_at,
    new Date()
  );
  const meetingsTouched = new Set(updates.map((u) => u.meeting_id).filter(Boolean))
    .size;

  // Handlers
  function handleStatusChange(newStatus: IssueStatus) {
    if (!issue) return;
    updateIssueStatus.mutate({
      issueId: issue.id,
      seriesId: issue.series_id,
      oldStatus: issue.status,
      newStatus,
    });
  }

  function handleFieldSave(field: string, value: string | null) {
    if (!issue) return;
    updateIssue.mutate({ issueId: issue.id, [field]: value });
  }

  function handlePriorityChange(e: React.ChangeEvent<HTMLSelectElement>) {
    handleFieldSave("priority", e.target.value);
  }

  function handleDueDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value || null;
    handleFieldSave("due_date", val);
  }

  async function handleSubmitUpdate() {
    if (!issue || !updateNote.trim()) return;
    await addUpdate.mutateAsync({
      issueId: issue.id,
      note: updateNote.trim(),
      oldStatus: issue.status,
      newStatus: issue.status,
    });
    setUpdateNote("");
    setShowUpdateForm(false);
  }

  async function handleDelete() {
    if (!issue) return;
    await deleteIssue.mutateAsync(issue.id);
    router.push("/");
  }

  return (
    <div className="min-h-full bg-paper">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Back button */}
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink transition-colors mb-6"
        >
          <ArrowLeft className="size-4" />
          Back
        </button>

        {/* Title (inline editable) */}
        <InlineEditText
          value={issue.title}
          onSave={(v) => handleFieldSave("title", v)}
          className="font-display text-xl font-semibold text-ink block mb-3"
          as="h1"
          placeholder="Issue title"
        />

        {/* Badges row */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <CategoryBadge category={issue.category} />
          <PriorityIndicator priority={issue.priority} />
          <StatusChip
            status={issue.status}
            onChange={handleStatusChange}
          />
        </div>

        {/* Meta details */}
        <div className="space-y-2 mb-6">
          {/* Owner */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-3 w-20 shrink-0">Owner</span>
            <InlineEditText
              value={issue.owner_name ?? ""}
              onSave={(v) => handleFieldSave("owner_name", v)}
              className="text-sm text-ink"
              placeholder="Unassigned"
            />
          </div>

          {/* Due date */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-3 w-20 shrink-0">Due</span>
            <input
              type="date"
              value={issue.due_date ? formatISODate(issue.due_date) : ""}
              onChange={handleDueDateChange}
              className="bg-transparent border border-transparent hover:border-rule focus:border-ink-3 rounded px-1 py-0.5 text-sm text-ink font-mono focus:outline-none transition-colors"
            />
          </div>

          {/* Priority */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-3 w-20 shrink-0">Priority</span>
            <select
              value={issue.priority}
              onChange={handlePriorityChange}
              className="bg-transparent border border-transparent hover:border-rule focus:border-ink-3 rounded px-1 py-0.5 text-sm text-ink focus:outline-none cursor-pointer transition-colors"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </div>

          {/* Source */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-3 w-20 shrink-0">Source</span>
            <span className="text-xs bg-paper-2 text-ink-2 px-2 py-0.5 rounded-full">
              {sourceBadgeLabel(issue.source)}
            </span>
          </div>

          {/* Raised in meeting */}
          {raisedIn && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-ink-3 w-20 shrink-0">Raised in</span>
              <Link
                href={`/series/${issue.series_id}/meetings/${raisedIn.id}`}
                className="text-sm text-ink hover:text-accent transition-colors underline underline-offset-2"
              >
                {raisedIn.title}
              </Link>
            </div>
          )}

          {/* Duration and meetings touched */}
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-ink-3 w-20 shrink-0">Duration</span>
              <span className="text-xs font-mono text-ink-2">
                {durationDays} day{durationDays !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-3 w-20 shrink-0">Touched</span>
            <span className="text-xs font-mono text-ink-2">
              {meetingsTouched} meeting{meetingsTouched !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Description (inline editable) */}
        <div className="mb-8">
          <h2 className="text-xs font-mono font-medium text-ink-3 uppercase tracking-wider mb-2">
            Description
          </h2>
          <InlineEditText
            value={issue.description ?? ""}
            onSave={(v) => handleFieldSave("description", v)}
            className="text-sm text-ink-2 leading-relaxed"
            as="p"
            placeholder="No description. Click to add one."
            multiline
          />
        </div>

        {/* Lifecycle Timeline */}
        {updates.length > 0 && (
          <section className="mb-8">
            <h2 className="font-display text-lg font-medium text-ink mb-4">
              Lifecycle timeline
            </h2>
            <div className="relative">
              {updates.map((update, i) => {
                const isLast = i === updates.length - 1;
                const isResolved = update.new_status === "resolved" && i === 0;

                return (
                  <TimelineUpdateNode
                    key={update.id}
                    update={update}
                    index={i}
                    isFirst={isLast}
                    isLast={i === 0}
                    isResolved={isResolved}
                  />
                );
              })}
            </div>
          </section>
        )}

        {/* Add update */}
        <div className="mb-8">
          {!showUpdateForm ? (
            <Button
              variant="outline"
              className="text-sm"
              onClick={() => setShowUpdateForm(true)}
            >
              Add update
              <kbd className="ml-2 text-[10px] text-ink-4 bg-paper-2 border border-rule rounded px-1 py-0.5">
                C
              </kbd>
            </Button>
          ) : (
            <div className="border border-rule rounded-md p-3 space-y-3">
              <textarea
                ref={updateInputRef}
                value={updateNote}
                onChange={(e) => setUpdateNote(e.target.value)}
                placeholder="What's the latest on this issue?"
                className="w-full bg-transparent text-sm text-ink placeholder:text-ink-4 resize-none focus:outline-none"
                rows={3}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmitUpdate();
                  }
                  if (e.key === "Escape") {
                    setUpdateNote("");
                    setShowUpdateForm(false);
                  }
                }}
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-4">
                  Enter to submit, Esc to cancel
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      setUpdateNote("");
                      setShowUpdateForm(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="text-xs"
                    onClick={handleSubmitUpdate}
                    disabled={!updateNote.trim() || addUpdate.isPending}
                  >
                    {addUpdate.isPending ? "Saving..." : "Add update"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Divider before danger zone */}
        <div className="border-t border-rule pt-6">
          {/* Delete */}
          {!confirmDelete ? (
            <Button
              variant="outline"
              className="text-danger border-danger/30 hover:bg-danger-soft text-sm"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-3.5" />
              Delete issue
            </Button>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-sm text-ink-2">
                Permanently delete this issue?
              </span>
              <Button
                variant="outline"
                className="text-danger border-danger/30 hover:bg-danger-soft text-sm"
                onClick={handleDelete}
                disabled={deleteIssue.isPending}
              >
                {deleteIssue.isPending ? "Deleting..." : "Yes, delete"}
              </Button>
              <Button
                variant="outline"
                className="text-sm"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline update node (uses Motion stagger, inlined here to control animation)
// ---------------------------------------------------------------------------

function statusBadgeStyle(status: string): string {
  switch (status) {
    case "resolved":
      return "text-success bg-success-soft";
    case "in_progress":
      return "text-accent bg-accent-soft";
    case "dropped":
      return "text-ink-3 bg-paper-2";
    default:
      return "text-ink bg-paper-2";
  }
}

function TimelineUpdateNode({
  update,
  index,
  isFirst,
  isLast,
  isResolved,
}: {
  update: IssueUpdate;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  isResolved: boolean;
}) {
  const hasStatusChange =
    update.previous_status &&
    update.new_status &&
    update.previous_status !== update.new_status;
  const displayStatus = update.new_status ?? update.previous_status;
  const isRaised = !update.previous_status;

  function nodeColor(): string {
    if (isResolved) return "bg-success";
    if (displayStatus === "in_progress") return "bg-accent";
    if (displayStatus === "dropped") return "bg-ink-4";
    if (isRaised) return "bg-ink";
    return "bg-ink-3";
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.4,
        delay: index * 0.09,
        ease: [0.2, 0.8, 0.2, 1],
      }}
      className="relative pl-8 pb-8"
    >
      {/* Vertical line */}
      {!isLast && (
        <div
          className="absolute left-[3.5px] top-3 bottom-0 w-px bg-rule"
          aria-hidden="true"
        />
      )}

      {/* Node circle */}
      {isResolved ? (
        <div
          className="absolute left-0 top-[2px] flex items-center justify-center size-[14px] rounded-full bg-success shadow-[0_0_0_4px_var(--paper)]"
          aria-label="Resolved"
        >
          <Check className="size-2.5 text-white" strokeWidth={3} />
        </div>
      ) : (
        <div
          className={cn("absolute left-0 top-1 size-[9px] rounded-full shadow-[0_0_0_4px_var(--paper)]", nodeColor())}
          aria-hidden="true"
        />
      )}

      {/* Label row: meeting + status badge */}
      <div className="flex items-center gap-2.5 mb-1.5">
        <span className="text-[11px] font-mono uppercase tracking-wider text-ink-3 font-medium">
          {formatDate(update.created_at)}
        </span>
        {hasStatusChange && displayStatus && (
          <span
            className={cn(
              "text-[11px] font-mono font-medium px-2 py-0.5 rounded",
              statusBadgeStyle(displayStatus)
            )}
          >
            {STATUS_CONFIG[displayStatus].label}
          </span>
        )}
        {!hasStatusChange && !update.previous_status && (
          <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded text-ink bg-paper-2">
            Raised
          </span>
        )}
      </div>

      {/* Body */}
      {update.note && (
        <p className="font-display text-base leading-relaxed text-ink">
          {update.note}
        </p>
      )}

      {/* Resolved conclusion card */}
      {isResolved && update.note && (
        <div className="mt-2 px-4 py-3 bg-success-soft border border-success rounded-lg">
          <p className="text-sm italic text-success">
            Resolved after {update.note.length > 0 ? "this update" : "status change"}.
          </p>
        </div>
      )}
    </motion.div>
  );
}
