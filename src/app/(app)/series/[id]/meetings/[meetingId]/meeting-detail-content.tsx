"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm";
import {
  useMeeting,
  meetingKeys,
  useEndMeeting,
  useMeetingPresence,
  useMeetingRealtime,
  useStartOrJoinMeeting,
  useApplyAiMeetingNotes,
  useUpdateMeetingNotes,
  useUpdateMeetingTranscript,
  useUpdateSpeakerMap,
} from "@/lib/hooks/use-meetings";
import { useSeriesDetail, useSeriesParticipantRole } from "@/lib/hooks/use-series";
import { useProfile } from "@/lib/hooks/use-profile";
import { CompanionInstallPrompt } from "@/components/minutia/companion-install-prompt";
import { isMacPlatform } from "@/lib/companion-links";
import { companionRecordStatus, isCompanionOnline } from "@/lib/companion/status";
import { recordInBrowser, requestCompanionRecord } from "@/lib/companion/request";
import { CompanionRecordStrip } from "@/components/minutia/companion-record-strip";
import { useIssues, useCreateIssue, useUpdateIssueStatus, useUpdateIssue, useAssignIssue, issueKeys } from "@/lib/hooks/use-issues";
import { useCreateDecision, decisionKeys } from "@/lib/hooks/use-decisions";
import { SyncIndicator } from "@/components/minutia/sync-indicator";
import { useOfflineSync } from "@/lib/hooks/use-offline-sync";
import { addPendingItem, clearAudioChunks, getAudioChunks } from "@/lib/offline-buffer";
import { RecordingIndicator } from "@/components/minutia/recording-indicator";
import {
  TranscriptionStatus,
  resolveTranscriptionView,
  transcriptProvenance,
  type TranscriptionUiState,
} from "@/components/minutia/transcription-status";
import { useMeetingRecorder } from "@/lib/hooks/use-meeting-recorder";
import { uploadMeetingAudio, MEETING_AUDIO_BUCKET } from "@/lib/audio";
import { createClient } from "@/lib/supabase/client";
import { useMeetingWindows } from "@/lib/hooks/use-meeting-windows";
import { isFinishing } from "@/lib/meetings/finishing";
import { CaptureInput } from "@/components/minutia/capture-input";
import { InlineTaskList } from "@/components/minutia/inline-task-list";
import { IssueCard } from "@/components/minutia/issue-card";
import { BriefCard } from "@/components/minutia/brief-card";
import { DecisionCard } from "@/components/minutia/decision-card";
import { CalendarDraftNotice } from "@/components/minutia/calendar-draft-notice";
import { PrefetchIssueLink } from "@/components/minutia/prefetch-issue-link";
import { StatusChip } from "@/components/minutia/status-chip";
import { CategoryBadge } from "@/components/minutia/category-badge";
import { SuggestionContextBadge } from "@/components/minutia/suggestion-context-badge";
import { FlowingSummary } from "@/components/minutia/flowing-summary";
import { RecapProgress } from "@/components/minutia/recap-progress";
import { MeetingNotesSurface } from "@/components/minutia/meeting-notes-surface";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { recapProgressDetail, recapStep, shouldAutoStartRecap } from "@/lib/summary/recap";
import { DiarizedTranscript } from "@/components/minutia/diarized-transcript";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ShareButton } from "@/components/minutia/share-button";
import { SendMeetingNotesButton } from "@/components/minutia/send-meeting-notes-button";
import { RemindOwnersButton } from "@/components/minutia/remind-owners-button";
import { CarryoverBriefingPanel } from "@/components/minutia/carryover-briefing-panel";
import { AiUnavailableNotice } from "@/components/minutia/ai-unavailable-notice";
import { useAiAccess } from "@/lib/hooks/use-ai-access";
import { composeMeetingNotes } from "@/lib/ai/companion-notes";
import { humanizeError } from "@/lib/errors";
import { ArrowLeft, Square, Play, Check, X, Sparkles, Loader2, FileText, CheckSquare, Gavel, AlertTriangle, Ban, RotateCcw, HelpCircle, ChevronDown, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatShortDate } from "@/lib/date-utils";
import type { IssueCategory, IssueStatus, Issue, Decision, Meeting, MeetingAiSuggestion } from "@/lib/types";
import Link from "next/link";

interface MeetingDetailContentProps {
  seriesId: string;
  meetingId: string;
}

type TranscriptionFailureKind =
  | "failed"
  | "failed_unknown"
  | "needs_admin"
  | "needs_signin"
  | "already_running"
  | "input_mismatch"
  | "extraction_failed"
  | "buffered_local"
  | "buffered_failed"
  | "deleted";

interface TranscriptionFailure {
  kind: TranscriptionFailureKind;
  reason?: string;
}

// The server reclaims a processing row after this window, so a client may only
// offer a retry once the claim is actually stale.
const STALE_PROCESSING_MS = 15 * 60 * 1000;

const ADMIN_CODES = new Set([
  "auth_error",
  "no_api_key",
  "provider_not_configured",
  "transcription_unconfigured",
]);

// A live meeting has nothing to report until something was recorded, so the
// two "nothing here" states stay out of the live view.
const LIVE_STATUS_STATES: TranscriptionUiState[] = [
  "recording",
  "paused",
  "mic_denied",
  "saving",
  "saved_pending",
  "transcribing",
  "transcribing_stale",
  "processing_return",
  "waiting_device",
  "waiting_device_stale",
  "transcript_ready",
  "extraction_failed",
  "no_speech",
  "failed",
  "failed_unknown",
  "needs_admin",
  "needs_signin",
  "already_running",
  "input_mismatch",
  "buffered_local",
  "buffered_failed",
];

// A non-2xx transcribe response carries a machine code. Map it to the UX
// contract before anything reaches the screen, so a raw code never shows up.
function mapTranscriptionFailure(
  status: number,
  payload: Record<string, unknown>
): TranscriptionFailure {
  const rawCode = typeof payload.code === "string" ? payload.code.toLowerCase() : "";
  const message = typeof payload.error === "string" ? payload.error : "";

  if (rawCode === "extraction_failed") return { kind: "extraction_failed" };
  if (rawCode === "processing_conflict") return { kind: "already_running" };
  if (rawCode === "input_mismatch") return { kind: "input_mismatch" };
  if (ADMIN_CODES.has(rawCode)) return { kind: "needs_admin" };
  if (status === 401) return { kind: "needs_signin" };
  if (status === 404) return { kind: "deleted" };
  if (rawCode) {
    return { kind: "failed", reason: humanizeError({ error: message, code: rawCode }) };
  }
  if (message) return { kind: "failed", reason: humanizeError({ error: message }) };
  if (status >= 500) return { kind: "failed_unknown" };
  return { kind: "failed", reason: humanizeError({ error: message }) };
}

type AiNotesPreview = {
  ai_notes?: AiNotesPayload;
  ai_notes_markdown: string;
  model: string;
  prompt_version: string;
  generated_at: string;
};

type AiNotesPayload = {
  summary: string[];
  action_items: string[];
  decisions: string[];
  risks: string[];
  blockers: string[];
  follow_ups: string[];
  open_questions: string[];
};

function suggestionCategoryLabel(category: IssueCategory) {
  const labels: Record<IssueCategory, string> = {
    action: "Action",
    decision: "Decision",
    info: "Info",
    risk: "Risk",
    blocker: "Blocker",
  };
  return labels[category];
}

function dateInputValue(date: Date | string | null | undefined) {
  if (!date) return "";
  return typeof date === "string" ? date.slice(0, 10) : date.toISOString().slice(0, 10);
}

function formatMeetingDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const emptyAiNotes: AiNotesPayload = {
  summary: [],
  action_items: [],
  decisions: [],
  risks: [],
  blockers: [],
  follow_ups: [],
  open_questions: [],
};

function parseAiNotesMarkdown(markdown: string): Partial<AiNotesPayload> {
  const sectionMap: Record<string, keyof AiNotesPayload> = {
    summary: "summary",
    "action items": "action_items",
    decisions: "decisions",
    risks: "risks",
    blockers: "blockers",
    "follow-ups": "follow_ups",
    "follow ups": "follow_ups",
    "open questions": "open_questions",
  };
  const parsed: Partial<AiNotesPayload> = {};
  let currentKey: keyof AiNotesPayload | null = null;

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("## ")) {
      currentKey = sectionMap[line.slice(3).trim().toLowerCase()] ?? null;
      if (currentKey && !parsed[currentKey]) parsed[currentKey] = [];
      continue;
    }
    if (!currentKey) continue;
    const item = line.replace(/^[-*]\s+/, "").trim();
    if (item) parsed[currentKey] = [...(parsed[currentKey] ?? []), item];
  }

  return parsed;
}

function normalizeAiNotesPreview(preview: AiNotesPreview): AiNotesPayload {
  const source = preview.ai_notes ?? parseAiNotesMarkdown(preview.ai_notes_markdown);
  return {
    summary: source.summary ?? [],
    action_items: source.action_items ?? [],
    decisions: source.decisions ?? [],
    risks: source.risks ?? [],
    blockers: source.blockers ?? [],
    follow_ups: source.follow_ups ?? [],
    open_questions: source.open_questions ?? [],
  };
}

function AiNotesSection({
  title,
  items,
  icon: Icon,
  tone = "neutral",
}: {
  title: string;
  items: string[];
  icon: React.ComponentType<{ className?: string }>;
  tone?: "neutral" | "good" | "warn";
}) {
  if (items.length === 0) return null;

  const toneClass = {
    neutral: "bg-paper-2 text-ink-3",
    good: "bg-success/10 text-success",
    warn: "bg-warn/10 text-warn",
  }[tone];

  return (
    <section className="rounded-lg bg-card px-4 py-3 shadow-[var(--shadow-raised)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn("flex size-7 items-center justify-center rounded-md", toneClass)}>
            <Icon className="size-3.5" />
          </span>
          <h4 className="text-sm font-semibold text-ink">{title}</h4>
        </div>
        <span className="text-[11px] font-mono tabular-nums text-ink-4">
          {items.length}
        </span>
      </div>

      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="flex gap-2 text-sm leading-5 text-ink-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}


// ---------------------------------------------------------------------------
// Live timer hook
// ---------------------------------------------------------------------------

function useLiveTimer(startTime: Date | string | null) {
  const [elapsed, setElapsed] = React.useState("00:00:00");

  React.useEffect(() => {
    if (!startTime) return;
    const start = new Date(startTime).getTime();

    function tick() {
      const diff = Math.max(0, Date.now() - start);
      const h = String(Math.floor(diff / 3600000)).padStart(2, "0");
      const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, "0");
      const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, "0");
      setElapsed(`${h}:${m}:${s}`);
    }

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  return elapsed;
}

// ---------------------------------------------------------------------------
// Attendee avatar
// ---------------------------------------------------------------------------

function AttendeeAvatar({ name, className }: { name: string; className?: string }) {
  const initial = name.charAt(0).toUpperCase();
  const colors = [
    "bg-accent text-white",
    "bg-ink text-paper",
    "bg-success text-white",
    "bg-warn text-white",
  ];
  const colorIdx = name.charCodeAt(0) % colors.length;

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center size-7 rounded-full text-[11px] font-medium font-mono ring-2 ring-paper",
        colors[colorIdx],
        className
      )}
      title={name}
    >
      {initial}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Keyboard-hint carried issue card
// ---------------------------------------------------------------------------

function CarriedIssueCard({
  issue,
  onStatusChange,
  index,
  done,
}: {
  issue: Issue;
  onStatusChange: (issueId: string, newStatus: IssueStatus) => void;
  index: number;
  done?: boolean;
}) {
  const [selected, setSelected] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const [justChanged, setJustChanged] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);

  const showActions = !done && (selected || hovered);

  function handleKey(e: React.KeyboardEvent) {
    if (done) return;
    if (e.key === "Escape") {
      setSelected(false);
      return;
    }
    const keyMap: Record<string, IssueStatus> = {
      r: "resolved",
      p: "in_progress",
      x: "dropped",
      o: "open",
    };
    const newStatus = keyMap[e.key.toLowerCase()];
    if (newStatus && newStatus !== issue.status) {
      e.preventDefault();
      setJustChanged(newStatus);
      onStatusChange(issue.id, newStatus);
      setTimeout(() => setJustChanged(null), 600);
    }
  }

  function handleActionClick(newStatus: IssueStatus) {
    if (newStatus === issue.status) return;
    setJustChanged(newStatus);
    onStatusChange(issue.id, newStatus);
    setTimeout(() => setJustChanged(null), 600);
  }

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8, transition: { duration: 0.2 } }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
      tabIndex={done ? undefined : 0}
      onClick={done ? undefined : () => setSelected((s) => !s)}
      onFocus={done ? undefined : () => setSelected(true)}
      onBlur={done ? undefined : (e) => {
        if (!ref.current?.contains(e.relatedTarget as Node)) {
          setSelected(false);
        }
      }}
      onMouseEnter={done ? undefined : () => setHovered(true)}
      onMouseLeave={done ? undefined : () => setHovered(false)}
      onKeyDown={handleKey}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg py-3 transition-all outline-none",
        done
          ? "px-4 opacity-50"
          : "px-4 cursor-pointer border border-transparent",
        !done && selected && "border-accent/40 bg-card ring-1 ring-accent/20",
        !done && !selected && hovered && "border-rule bg-card",
      )}
    >
      {/* Selected accent bar */}
      {selected && !done && (
        <motion.div
          layoutId="carried-select-bar"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-accent rounded-sm"
        />
      )}

      {/* Status indicator */}
      {done ? (
        <span className={cn(
          "inline-flex items-center justify-center size-4 rounded-full shrink-0",
          issue.status === "resolved" ? "bg-success/20" : "bg-ink-4/20"
        )}>
          {issue.status === "resolved"
            ? <Check className="size-2.5 text-success" />
            : <X className="size-2.5 text-ink-4" />
          }
        </span>
      ) : (
        <span
          className={cn(
            "size-2 rounded-full shrink-0 transition-colors",
            issue.status === "in_progress" ? "bg-accent" :
            issue.status === "resolved" ? "bg-success" :
            issue.status === "dropped" ? "bg-ink-4" :
            "bg-ink"
          )}
        />
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <PrefetchIssueLink
          issueId={issue.id}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "text-sm font-medium transition-all hover:text-accent",
            done ? "line-through text-ink-3 hover:text-ink-3" : "text-ink"
          )}
        >
          {issue.title}
        </PrefetchIssueLink>
        <div className="flex items-center gap-2 mt-0.5">
          <CategoryBadge category={issue.category} size="sm" />
          {issue.owner_name && (
            <span className="text-xs font-mono text-ink-4">{issue.owner_name}</span>
          )}
          {issue.due_date && (
            <span className={cn(
              "text-xs font-mono tabular-nums",
              !done && new Date(issue.due_date) < new Date() ? "text-accent" : "text-ink-4"
            )}>
              {formatShortDate(issue.due_date)}
            </span>
          )}
        </div>
      </div>

      {/* Done badge */}
      {done && (
        <span className={cn(
          "text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0",
          issue.status === "resolved" ? "bg-success/10 text-success" : "bg-paper-2 text-ink-4"
        )}>
          {issue.status === "resolved" ? "Resolved" : "Dropped"}
        </span>
      )}

      {/* Action buttons (visible on hover/focus/select) */}
      <AnimatePresence>
        {showActions && !justChanged && (
          <motion.div
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 4 }}
            transition={{ duration: 0.12 }}
            className="flex items-center gap-1 shrink-0"
          >
            <ActionButton letter="R" label="Resolve" onClick={() => handleActionClick("resolved")} />
            <ActionButton letter="P" label="Progress" onClick={() => handleActionClick("in_progress")} />
            <ActionButton letter="X" label="Drop" onClick={() => handleActionClick("dropped")} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Flash confirmation */}
      <AnimatePresence>
        {justChanged && (
          <motion.span
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className={cn(
              "text-xs font-medium px-2 py-0.5 rounded-full",
              justChanged === "resolved" && "bg-success-soft text-success",
              justChanged === "in_progress" && "bg-accent-soft text-accent",
              justChanged === "dropped" && "bg-paper-2 text-ink-3"
            )}
          >
            {justChanged === "resolved" ? "Resolved" :
             justChanged === "in_progress" ? "In Progress" :
             justChanged === "dropped" ? "Dropped" : justChanged}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ActionButton({ letter, label, onClick }: { letter: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-paper-2 transition-colors"
      title={`${letter} to ${label}`}
    >
      <kbd className={cn(
        "inline-flex items-center justify-center size-5 rounded text-[10px] font-mono font-medium",
        "bg-paper-2 text-ink-3 border border-rule"
      )}>
        {letter}
      </kbd>
      <span className="text-[10px] text-ink-4 hidden lg:inline">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Today's capture item
// ---------------------------------------------------------------------------

function CapturedItem({
  issue,
  index,
  onStatusChange,
}: {
  issue: Issue;
  index: number;
  onStatusChange: (issueId: string, newStatus: IssueStatus) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.18 }}
      className="flex items-center gap-3 rounded-lg px-4 py-3 hover:bg-card transition-colors group"
    >
      <span className="text-xs font-mono text-ink-4 tabular-nums w-5 text-right shrink-0">
        {String(index + 1).padStart(2, "0")}
      </span>
      <CategoryBadge category={issue.category} size="sm" />
      <PrefetchIssueLink
        issueId={issue.id}
        className="flex-1 min-w-0 text-sm font-medium text-ink group-hover:text-accent transition-colors truncate"
      >
        {issue.title}
      </PrefetchIssueLink>
      {issue.owner_name && (
        <span className="text-xs font-mono text-ink-4">{issue.owner_name}</span>
      )}
      {issue.due_date && (
        <span className={cn(
          "text-xs font-mono tabular-nums",
          new Date(issue.due_date) < new Date() ? "text-accent" : "text-ink-4"
        )}>
          {formatShortDate(issue.due_date)}
        </span>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Completed-view editorial helpers
// ---------------------------------------------------------------------------

// A section heading: serif title + hairline rule. A numeric `flashKey` redraws
// the hairline once in the accent colour, confirming the review loop closed.
function SectionHeading({
  title,
  flashKey,
  className,
}: {
  title: string;
  flashKey?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <div className={cn("mb-4 flex items-baseline gap-3", className)}>
      <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
      <div className="relative ml-1 flex-1 self-center border-t border-rule">
        {typeof flashKey === "number" && (
          <motion.div
            key={flashKey}
            className="absolute inset-x-0 -top-px h-px origin-left bg-accent"
            initial={{ scaleX: 0, opacity: 1 }}
            animate={{ scaleX: 1, opacity: 0 }}
            transition={
              reduced
                ? { duration: 0 }
                : {
                    scaleX: { duration: 0.48, ease: [0.2, 0, 0, 1] },
                    opacity: { delay: 0.48, duration: 0.6 },
                  }
            }
          />
        )}
      </div>
    </div>
  );
}

// A mono-caps eyebrow used for the sub-groups inside "Tracked in the log".
function LogGroupLabel({
  label,
  count,
  tone = "default",
  aside,
}: {
  label: string;
  count: number;
  tone?: "default" | "accent";
  aside?: React.ReactNode;
}) {
  const color = tone === "accent" ? "text-accent" : "text-ink-4";
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className={cn("font-mono text-[11px] font-medium uppercase tracking-wider", color)}>
        {label}
      </span>
      {count > 0 && (
        <span className={cn("font-mono text-[11px] tabular-nums", color)}>{count}</span>
      )}
      {aside && <span className="ml-auto font-mono text-[11px] text-ink-4">{aside}</span>}
    </div>
  );
}

// Whole minutes for the meta row, from recorded audio or the live span. Null
// when neither is known, so the meta row omits it rather than showing "0 min".
function meetingDurationMinutes(meeting: Meeting): number | null {
  if (meeting.audio_duration_seconds && meeting.audio_duration_seconds > 0) {
    return Math.max(1, Math.round(meeting.audio_duration_seconds / 60));
  }
  if (meeting.completed_at && meeting.created_at) {
    const ms = new Date(meeting.completed_at).getTime() - new Date(meeting.created_at).getTime();
    if (ms > 30_000) return Math.max(1, Math.round(ms / 60_000));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MeetingDetailContent({
  seriesId,
  meetingId,
}: MeetingDetailContentProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: meeting, isLoading: meetingLoading, error: meetingError } = useMeeting(meetingId);
  // The row is gone (deleted, or the viewer lost access). A stale row would
  // otherwise keep rendering a meeting that no longer exists.
  const meetingGone =
    !!meetingError && (meetingError as { code?: string }).code === "PGRST116";
  const { data: series } = useSeriesDetail(seriesId);
  const { data: participantRole } = useSeriesParticipantRole(seriesId);
  const { data: profile } = useProfile({
    refetchInterval: meeting?.status === "live" ? 10_000 : false,
  });
  const { data: seriesIssues } = useIssues(seriesId);

  // MIN-121: resolve an OIL number to its issue link so a context badge
  // ("Updates OIL-45", "Duplicate of OIL-67") can deep-link to the item.
  const issueHrefByNumber = React.useMemo(() => {
    const map = new Map<number, string>();
    for (const issue of seriesIssues ?? []) {
      map.set(issue.issue_number, `/issues/${issue.id}`);
    }
    return map;
  }, [seriesIssues]);

  useMeetingRealtime(meetingId, seriesId);
  const presenceUsers = useMeetingPresence(meeting?.status === "live" ? meetingId : "");
  const confirm = useConfirm();
  const endMeeting = useEndMeeting();
  const startOrJoinMeeting = useStartOrJoinMeeting();
  const createIssue = useCreateIssue();
  const createDecision = useCreateDecision();
  const updateIssueStatus = useUpdateIssueStatus();
  const updateIssue = useUpdateIssue();
  const assignIssue = useAssignIssue();

  const { isOnline, pendingCount, syncStatus, refreshCount } = useOfflineSync();
  const { data: aiAccess } = useAiAccess();
  const hasAccess = aiAccess?.hasAccess === true;

  const [notes, setNotes] = React.useState(meeting?.notes_markdown ?? "");
  const [transcript, setTranscript] = React.useState(meeting?.transcript_raw ?? "");
  const [transcriptOpen, setTranscriptOpen] = React.useState(false);
  const [aiPreview, setAiPreview] = React.useState<AiNotesPreview | null>(null);
  const [aiError, setAiError] = React.useState<string | null>(null);
  const [enhancingNotes, setEnhancingNotes] = React.useState(false);
  const [aiSuggestions, setAiSuggestions] = React.useState<MeetingAiSuggestion[]>([]);
  const [suggestionsError, setSuggestionsError] = React.useState<string | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = React.useState(false);
  const [reviewingSuggestionId, setReviewingSuggestionId] = React.useState<string | null>(null);
  const updateNotes = useUpdateMeetingNotes();
  const updateTranscript = useUpdateMeetingTranscript();
  const updateSpeakerMap = useUpdateSpeakerMap();
  const applyAiNotes = useApplyAiMeetingNotes();
  const timer = useLiveTimer(meeting?.status === "live" ? meeting.created_at : null);
  const recorder = useMeetingRecorder(meetingId);
  const [savingRecording, setSavingRecording] = React.useState(false);
  const [transcribing, setTranscribing] = React.useState(false);
  const [autoStartSummary, setAutoStartSummary] = React.useState(false);
  const autoSummaryFiredRef = React.useRef(false);
  const [finishingOpenedAt, setFinishingOpenedAt] = React.useState<number | null>(null);
  const [stopOutcome, setStopOutcome] = React.useState<"completed" | "failed" | null>(null);
  const [extractionWaitOver, setExtractionWaitOver] = React.useState(false);
  // The upload landed and the transcription request has not been issued yet.
  const [uploadedPending, setUploadedPending] = React.useState(false);
  const [transcriptionFailure, setTranscriptionFailure] = React.useState<TranscriptionFailure | null>(null);
  // When the current transcription request was issued, for elapsed copy.
  const transcribeStartedAtRef = React.useRef<number | null>(null);
  // The transcript was already committed when the page loaded, so its arrival
  // is not news and must not toast.
  const initialTranscriptRef = React.useRef<boolean | null>(null);
  const transcriptAnnouncedRef = React.useRef(false);
  // The meeting is gone: no late completion may toast or reopen the panel.
  const meetingMissingRef = React.useRef(false);
  const statusRegionRef = React.useRef<HTMLDivElement>(null);
  const notesAreaRef = React.useRef<{ focus: () => void }>(null);
  const liveNotesAreaRef = React.useRef<HTMLTextAreaElement>(null);
  const transcriptAreaRef = React.useRef<HTMLTextAreaElement>(null);
  const [clock, setClock] = React.useState(() => Date.now());
  const [recapStreaming, setRecapStreaming] = React.useState(false);
  const [regenerateNonce, setRegenerateNonce] = React.useState(0);
  const [generatingSuggestions, setGeneratingSuggestions] = React.useState(false);
  const [showReviewed, setShowReviewed] = React.useState(false);
  const [seenPending, setSeenPending] = React.useState(0);
  const [loopClosedKey, setLoopClosedKey] = React.useState(0);
  const reducedMotion = useReducedMotion();

  // Load already-extracted suggestions (e.g. the ones the transcription
  // auto-generated) instead of re-running the model. This is what makes the
  // auto-trigger pay off: its output is shown, not silently discarded.
  const loadSuggestions = React.useCallback(async (quiet = false) => {
    if (!quiet) setLoadingSuggestions(true);
    try {
      const response = await fetch(`/api/meetings/${meetingId}/suggestions`, { method: "GET" });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) setAiSuggestions(payload.suggestions ?? []);
    } catch {
      // Best-effort: the Review button can still trigger generation on demand.
    } finally {
      if (!quiet) setLoadingSuggestions(false);
    }
  }, [meetingId]);

  // The recording pipeline: transcribe the uploaded audio, which auto-extracts
  // context-aware suggestions on completion, then surface them. A failed
  // request always ends in a visible state, never a silent stop.
  const runTranscription = React.useCallback(async () => {
    try {
      // Wait for the fast lane to settle so the tail segment's row is registered
      // before the final pass decides whether to trust the segment rows. Only
      // claim segment coverage when every segment actually completed.
      const lane = await recorder.waitForFastLane(25000);
      if (meetingMissingRef.current) return;
      setUploadedPending(false);
      setTranscribing(true);
      transcribeStartedAtRef.current = Date.now();
      const body =
        lane.state === "ready" && lane.segmentsTotal > 0
          ? JSON.stringify({ expected_segments: lane.segmentsTotal })
          : "{}";
      const response = await fetch(`/api/meetings/${meetingId}/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (meetingMissingRef.current) return;
      if (response.ok) {
        setTranscriptionFailure(null);
        // The transcript text lands via the meeting realtime poll; pull the
        // suggestions the transcription just generated and reveal them.
        await loadSuggestions();
        return;
      }
      setTranscriptionFailure(mapTranscriptionFailure(response.status, payload));
    } catch {
      // Network error: the recording is saved, so the user can retry.
      if (!meetingMissingRef.current) setTranscriptionFailure({ kind: "failed_unknown" });
    } finally {
      setTranscribing(false);
      transcribeStartedAtRef.current = null;
    }
  }, [meetingId, loadSuggestions, recorder.waitForFastLane]);

  // On open, surface suggestions already extracted for this meeting (typically
  // auto-generated when its recording was transcribed) so the facilitator sees
  // the action-item count without having to re-run anything. Once per mount.
  // Must live above the loading early-return to keep hook order stable.
  const suggestionsLoadedRef = React.useRef(false);
  React.useEffect(() => {
    if (suggestionsLoadedRef.current) return;
    const manages = participantRole === "owner" || participantRole === "facilitator";
    if (!manages || !hasAccess) return;
    if (!meeting?.transcript_raw && !meeting?.notes_markdown) return;
    suggestionsLoadedRef.current = true;
    void loadSuggestions();
  }, [participantRole, hasAccess, meeting?.transcript_raw, meeting?.notes_markdown, loadSuggestions]);

  // Auto-flow the recap the moment recording stops and the fast lane is ready
  // (or the final transcript lands for non-webm browsers). Managers only, once.
  React.useEffect(() => {
    if (autoSummaryFiredRef.current) return;
    const manages = participantRole === "owner" || participantRole === "facilitator";
    if (!manages || !hasAccess) return;
    if (recorder.state !== "stopped") return;
    if (recorder.fastLane.state !== "ready" && !meeting?.transcript_raw) return;
    autoSummaryFiredRef.current = true;
    setAutoStartSummary(true);
  }, [participantRole, hasAccess, recorder.state, recorder.fastLane.state, meeting?.transcript_raw]);

  React.useEffect(() => {
    if (meeting?.notes_markdown) setNotes(meeting.notes_markdown);
  }, [meeting?.notes_markdown]);

  React.useEffect(() => {
    if (meeting?.transcript_raw != null) setTranscript(meeting.transcript_raw);
  }, [meeting?.transcript_raw]);

  // A meeting that disappeared mid-run must not fire late completion effects.
  React.useEffect(() => {
    if (!meetingLoading && (!meeting || meetingGone)) meetingMissingRef.current = true;
  }, [meeting, meetingLoading, meetingGone]);

  // Remember whether the transcript was already there on arrival, so a
  // pre-existing transcript never toasts as if it had just landed.
  React.useEffect(() => {
    if (initialTranscriptRef.current === null && meeting !== undefined) {
      initialTranscriptRef.current = !!meeting.transcript_raw?.trim();
    }
  }, [meeting]);

  // A transcript that lands while the page is open toasts once.
  React.useEffect(() => {
    const text = meeting?.transcript_raw?.trim();
    if (!text) return;
    if (meetingMissingRef.current) return;
    if (transcriptAnnouncedRef.current) return;
    transcriptAnnouncedRef.current = true;
    // Only a transcript that lands while the page is open takes over the view:
    // a past meeting keeps its collapsed-by-default panel, so opening it later is
    // never undone by this effect.
    if (initialTranscriptRef.current === false) {
      toast("Transcript ready. Check action items below.");
    }
  }, [meeting?.transcript_raw]);

  // A transcript must appear without the user refreshing, even when the
  // realtime subscription is unavailable (self-hosted instances without
  // replication). While a run is in flight, re-read the meeting on a short
  // interval so the committed transcript and the terminal status are observed.
  React.useEffect(() => {
    const inFlight = transcribing || meeting?.transcription_status === "processing";
    if (!inFlight || meetingMissingRef.current) return;
    const id = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
    }, 2000);
    return () => clearInterval(id);
  }, [transcribing, meeting?.transcription_status, meetingId, queryClient]);

  // Syncs with the browser URL: the stop hand-off flag is read once, then removed.
  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("recap") !== "auto") return;
    setFinishingOpenedAt(Date.now());
    setTranscriptOpen(true);
    url.searchParams.delete("recap");
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const stopStatus = meeting?.transcription_status;
  if (finishingOpenedAt !== null && (stopStatus === "completed" || stopStatus === "failed")) {
    setFinishingOpenedAt(null);
    setStopOutcome(stopStatus);
  }
  const finishing = isFinishing({
    autoRecap: finishingOpenedAt !== null,
    openedAt: finishingOpenedAt ?? 0,
    now: clock,
    transcriptionStatus: meeting?.transcription_status ?? null,
  });
  const { data: heardWindows = [] } = useMeetingWindows(meetingId, finishing);

  // Polls the server while action items are still being extracted after the stop.
  React.useEffect(() => {
    if (stopOutcome !== "completed" || aiSuggestions.length > 0) return;
    const startedAt = Date.now();
    const id = setInterval(() => {
      if (Date.now() - startedAt > 60_000) {
        clearInterval(id);
        setExtractionWaitOver(true);
        return;
      }
      void loadSuggestions(true);
    }, 3000);
    return () => clearInterval(id);
  }, [stopOutcome, aiSuggestions.length, loadSuggestions]);
  const findingSuggestions =
    loadingSuggestions || (stopOutcome === "completed" && aiSuggestions.length === 0 && !extractionWaitOver);

  // The elapsed-time copy needs a moving clock while a run is in flight.
  React.useEffect(() => {
    if (!transcribing && meeting?.transcription_status !== "processing" && !finishing) return;
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [transcribing, meeting?.transcription_status, finishing]);

  const awaitingDevice =
    meeting?.transcription_provider === "device" &&
    !meeting.audio_file_path &&
    !meeting.transcript_raw?.trim() &&
    (meeting.transcription_status === "pending" ||
      meeting.transcription_status === "failed" ||
      meeting.transcription_status === "processing");
  // Syncs with the wall clock so a device wait turns stale without a reload.
  React.useEffect(() => {
    if (!awaitingDevice) return;
    const id = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [awaitingDevice]);

  const isMacClient =
    typeof navigator !== "undefined" &&
    isMacPlatform(
      (navigator as Navigator & { userAgentData?: { platform?: string } })
        .userAgentData,
      navigator.userAgent
    );
  const companionStatus =
    meeting && profile
      ? companionRecordStatus({
          meeting,
          userId: profile.id,
          checkinAt: profile.companion_checkin_at,
          legacySeenAt: profile.companion_last_seen_at,
          isMac: isMacClient,
          now: clock,
        })
      : ({ kind: "none" } as const);
  const handoffMeetingLive = meeting?.status === "live";
  const handoffStarting = companionStatus.kind === "starting";

  // Re-evaluates time-based handoff states against the wall clock.
  React.useEffect(() => {
    if (!handoffMeetingLive) return;
    const id = setInterval(() => setClock(Date.now()), handoffStarting ? 1000 : 5000);
    return () => clearInterval(id);
  }, [handoffMeetingLive, handoffStarting]);

  // Auto-save notes with debounce
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout>>(null);
  const handleNotesChange = React.useCallback(
    (value: string) => {
      setNotes(value);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateNotes.mutate({ meetingId, notes: value });
      }, 1000);
    },
    [meetingId, updateNotes]
  );

  // Auto-save transcript with its own debounce timer.
  const saveTranscriptTimerRef = React.useRef<ReturnType<typeof setTimeout>>(null);
  const handleTranscriptChange = React.useCallback(
    (value: string) => {
      setTranscript(value);
      if (saveTranscriptTimerRef.current) clearTimeout(saveTranscriptTimerRef.current);
      saveTranscriptTimerRef.current = setTimeout(() => {
        updateTranscript.mutate({ meetingId, transcript: value });
      }, 1000);
    },
    [meetingId, updateTranscript]
  );

  // Correct a diarized speaker: the route re-flattens transcript_raw and
  // re-runs extraction server-side, then the mutation's onSuccess invalidates
  // the meeting query so the corrected transcript and suggestions land here.
  const patchSpeaker = React.useCallback(
    (speaker: string, name: string | null) => {
      updateSpeakerMap.mutate({ meetingId, speaker, attendee: name });
    },
    [meetingId, updateSpeakerMap]
  );

  React.useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (saveTranscriptTimerRef.current) clearTimeout(saveTranscriptTimerRef.current);
    };
  }, []);

  // =========================================================================
  // TRANSCRIPTION STATE
  // =========================================================================
  const startedAtMs = meeting?.transcription_started_at
    ? new Date(meeting.transcription_started_at).getTime()
    : null;
  const runAgeMs =
    startedAtMs != null && Number.isFinite(startedAtMs) ? clock - startedAtMs : null;
  const isProcessing = meeting?.transcription_status === "processing";
  const isStaleRun = runAgeMs != null && runAgeMs > STALE_PROCESSING_MS;
  const deviceWaitAgeMs = meeting
    ? clock - new Date(meeting.completed_at ?? meeting.created_at).getTime()
    : null;
  const deviceWaitOverdue =
    deviceWaitAgeMs != null &&
    Number.isFinite(deviceWaitAgeMs) &&
    deviceWaitAgeMs > STALE_PROCESSING_MS;
  const hasTranscript = !!meeting?.transcript_raw?.trim();
  const canDownloadAudio = !!meeting?.audio_file_path;

  // One derived state drives the whole status region. The order is the
  // contract: capture first, then the request this client owns, then the
  // persisted run, then the last failure, then what the meeting holds.
  let transcriptionState: TranscriptionUiState;
  if (recorder.error) {
    transcriptionState = "mic_denied";
  } else if (recorder.state === "recording") {
    transcriptionState = "recording";
  } else if (recorder.state === "paused") {
    transcriptionState = "paused";
  } else if (savingRecording) {
    transcriptionState = "saving";
  } else if (transcribing) {
    transcriptionState = "transcribing";
  } else if (isProcessing && !awaitingDevice) {
    transcriptionState = isStaleRun ? "transcribing_stale" : "processing_return";
  } else if (
    transcriptionFailure &&
    !(hasTranscript && transcriptionFailure.kind !== "extraction_failed")
  ) {
    // A committed transcript outranks an earlier failure, except for the
    // extraction failure, which is defined on top of a ready transcript.
    transcriptionState = transcriptionFailure.kind;
  } else if (hasTranscript) {
    transcriptionState = "transcript_ready";
  } else if (
    awaitingDevice
  ) {
    transcriptionState = deviceWaitOverdue ? "waiting_device_stale" : "waiting_device";
  } else if (uploadedPending || meeting?.transcription_status === "pending") {
    transcriptionState = "saved_pending";
  } else if (meeting?.transcription_outcome === "no_speech") {
    transcriptionState = "no_speech";
  } else if (meeting?.transcription_status === "failed") {
    transcriptionState = "failed_unknown";
  } else if (meeting?.transcription_status === "completed") {
    transcriptionState = "empty_unknown";
  } else {
    transcriptionState = "no_recording";
  }

  function focusNotes() {
    const area = liveNotesAreaRef.current ?? notesAreaRef.current;
    area?.focus();
  }

  function focusTranscript() {
    setTranscriptOpen(true);
    window.setTimeout(() => transcriptAreaRef.current?.focus(), 0);
  }

  function focusStatus() {
    statusRegionRef.current?.focus();
  }

  async function handleRetryTranscription() {
    await runTranscription();
  }

  async function handleRetryActionItems() {
    await generateSuggestions();
  }

  async function handleDownloadAudio() {
    const path = meeting?.audio_file_path;
    if (!path) return;
    const { data, error } = await createClient()
      .storage.from(MEETING_AUDIO_BUCKET)
      .createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      toast.error("The recording could not be downloaded. Try again.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function handleRetryUpload() {
    try {
      const chunks = await getAudioChunks(meetingId);
      if (chunks.length === 0) {
        toast.error("No local recording found to upload.");
        return;
      }
      const mimeType = chunks[0].type || "audio/webm";
      const blob = new Blob(chunks, { type: mimeType });
      await uploadMeetingAudio(createClient(), {
        meetingId,
        blob,
        durationSeconds: 0,
        mimeType,
      });
      await clearAudioChunks(meetingId);
      setTranscriptionFailure(null);
      setUploadedPending(true);
      toast("Recording uploaded.");
      void runTranscription();
    } catch {
      setTranscriptionFailure({ kind: "buffered_local" });
      toast.error("Couldn't upload the recording, it's saved locally and will retry.");
    }
  }

  function handleContactAdmin() {
    if (profile?.role === "admin") {
      router.push("/admin/settings");
      return;
    }
    toast("Ask your workspace administrator to set up transcription.");
  }

  const transcriptionStatusProps = {
    state: transcriptionState,
    partsDone: recorder.fastLane.segmentsDone,
    partsTotal: recorder.fastLane.segmentsTotal,
    elapsedSeconds:
      transcribeStartedAtRef.current != null
        ? Math.floor((clock - transcribeStartedAtRef.current) / 1000)
        : runAgeMs != null
          ? Math.floor(runAgeMs / 1000)
          : undefined,
    startedMinutesAgo: runAgeMs != null ? Math.floor(runAgeMs / 60000) : null,
    reason: transcriptionFailure?.reason ?? null,
    canDownloadAudio,
    regionRef: statusRegionRef,
    onStop: handleStopRecording,
    onPause: recorder.pause,
    onResume: recorder.resume,
    onRetryMicrophone: () => void recorder.start(),
    onRetryTranscription: handleRetryTranscription,
    onDownloadAudio: handleDownloadAudio,
    onRetryActionItems: handleRetryActionItems,
    onAddNotes: focusNotes,
    onEditTranscript: focusTranscript,
    onReviewActionItems: undefined,
    onViewStatus: focusStatus,
    onRefreshStatus: () =>
      queryClient.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) }),
    onRetryUpload: handleRetryUpload,
    onBackToSeries: () => router.push(`/series/${seriesId}`),
    onContactAdmin: handleContactAdmin,
    onSignIn: () => router.push("/login"),
  };

  if (meetingLoading) {
    return (
      <div className="min-h-full bg-paper">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <Skeleton className="h-px w-full mb-6" />
          <Skeleton className="h-6 w-48 mb-2" />
          <Skeleton className="h-8 w-64 mb-8" />
          <Skeleton className="h-16 w-full mb-4" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (!meeting || meetingGone) {
    return (
      <div className="min-h-full bg-paper">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <TranscriptionStatus
            state="deleted"
            regionRef={statusRegionRef}
            onBackToSeries={() => router.push(`/series/${seriesId}`)}
          />
        </div>
      </div>
    );
  }

  const meetingIssues = meeting.issues ?? [];
  const meetingDecisions = meeting.decisions ?? [];
  const seriesIssueById = new Map((seriesIssues ?? []).map((issue) => [issue.id, issue]));
  const raisedInThisMeeting = meetingIssues.map((issue) => seriesIssueById.get(issue.id) ?? issue);

  const allCarriedIssues = (seriesIssues ?? []).filter(
    (issue) => issue.raised_in_meeting_id !== meetingId
  );
  const carriedIssues = allCarriedIssues.filter(
    (issue) => issue.status !== "resolved" && issue.status !== "dropped"
  );
  // Issues resolved/dropped during this meeting (both carried AND raised here)
  const allSeriesIssues = seriesIssues ?? [];
  const doneThisMeeting = allSeriesIssues.filter(
    (issue) =>
      (issue.status === "resolved" || issue.status === "dropped") &&
      issue.resolved_in_meeting_id === meetingId
  );

  const meetingSequence = series?.meetings
    ? [...series.meetings]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .findIndex((m) => m.id === meetingId) + 1
    : null;
  const liveMeetingInSeries = series?.meetings?.find((m) => m.status === "live");
  const canManageMeeting =
    participantRole === "owner" || participantRole === "facilitator";


  const activePresenceLabel =
    presenceUsers.length > 0
      ? presenceUsers
          .map((user) =>
            user.deviceCount > 1 ? `${user.name} (${user.deviceCount} devices)` : user.name
          )
          .join(", ")
      : "Waiting for participants";
  const structuredAiPreview = aiPreview ? normalizeAiNotesPreview(aiPreview) : emptyAiNotes;
  const structuredAiPreviewCount = Object.values(structuredAiPreview).reduce(
    (total, items) => total + items.length,
    0
  );

  // Handlers
  async function handleCapture(text: string, category: IssueCategory) {
    if (isOnline) {
      try {
        if (category === "decision") {
          await createDecision.mutateAsync({
            title: text,
            meeting_id: meetingId,
            series_id: seriesId,
          });
        } else {
          await createIssue.mutateAsync({
            title: text,
            category,
            priority: "medium",
            meeting_id: meetingId,
            series_id: seriesId,
          });
        }
      } catch {
        // Online but request failed; buffer locally
        await addPendingItem({
          id: crypto.randomUUID(),
          type: category === "decision" ? "decision" : "issue",
          title: text,
          category: category === "decision" ? undefined : category,
          priority: category === "decision" ? undefined : "medium",
          meeting_id: meetingId,
          series_id: seriesId,
          created_at: new Date().toISOString(),
        });
        await refreshCount();
      }
    } else {
      // Offline; buffer immediately
      await addPendingItem({
        id: crypto.randomUUID(),
        type: category === "decision" ? "decision" : "issue",
        title: text,
        category: category === "decision" ? undefined : category,
        priority: category === "decision" ? undefined : "medium",
        meeting_id: meetingId,
        series_id: seriesId,
        created_at: new Date().toISOString(),
      });
      await refreshCount();
    }
  }

  function handleStatusChange(issueId: string, newStatus: IssueStatus) {
    const issue = [...raisedInThisMeeting, ...allSeriesIssues].find(
      (i) => i.id === issueId
    );
    if (!issue) return;
    updateIssueStatus.mutate({
      issueId,
      seriesId,
      oldStatus: issue.status,
      newStatus,
      meetingId,
    });
  }

  // Stop the active recording and upload it to private storage. Shared by the
  // recorder's Stop control and by ending the meeting, so a recording is never
  // left un-uploaded. A failed upload keeps the audio buffered in IndexedDB.
  async function handleStopRecording() {
    if (recorder.state !== "recording" && recorder.state !== "paused") return;
    setSavingRecording(true);
    try {
      const result = await recorder.stop();
      if (result) {
        await uploadMeetingAudio(createClient(), {
          meetingId,
          blob: result.blob,
          durationSeconds: result.durationSeconds,
          mimeType: result.mimeType,
        });
        await clearAudioChunks(meetingId);
        setUploadedPending(true);
        // Kick off transcription + context-aware extraction so the facilitator
        // returns to a ready transcript and suggested action items. Fire-and-
        // forget with its own progress state; it must not block stop/end.
        void runTranscription();
      }
    } catch {
      // Upload failed; the recording stays buffered in IndexedDB for recovery.
      setTranscriptionFailure({ kind: "buffered_local" });
      toast.error("Couldn't upload the recording, it's saved locally and will retry.");
    } finally {
      setSavingRecording(false);
    }
  }

  async function handleEndMeeting() {
    if (!(await confirm({
      title: "End meeting?",
      description: "Notes become read-only for everyone once the meeting ends.",
      confirmLabel: "End meeting",
    }))) return;
    await handleStopRecording();
    await endMeeting.mutateAsync(meetingId);
  }

  async function handleStartMeeting() {
    const liveMeeting = await startOrJoinMeeting.mutateAsync(seriesId);
    if (canManageMeeting && isCompanionOnline(profile?.companion_checkin_at)) {
      await requestCompanionRecord(liveMeeting.id);
    }
    if (liveMeeting.id !== meetingId) {
      router.push(`/series/${seriesId}/meetings/${liveMeeting.id}`);
    }
  }

  async function refreshHandoff() {
    setClock(Date.now());
    await queryClient.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
  }

  async function handleRecordOnMac() {
    await requestCompanionRecord(meetingId);
    await refreshHandoff();
  }

  async function handleStartBrowserRecording() {
    await recordInBrowser(meetingId);
    await refreshHandoff();
    await recorder.start();
  }

  function handleTitleChange(issueId: string, title: string) {
    updateIssue.mutate({ issueId, title });
  }

  function handleAssigneeChange(
    issueId: string,
    payload: { owner_user_id: string | null; owner_name: string }
  ) {
    assignIssue.mutate({
      issueId,
      owner_user_id: payload.owner_user_id,
      owner_name: payload.owner_name,
    });
  }

  async function handleInlineAdd(title: string, category: IssueCategory) {
    await handleCapture(title, category);
  }

  async function handleEnhanceNotes() {
    setAiError(null);
    setEnhancingNotes(true);
    try {
      const response = await fetch(`/api/meetings/${meetingId}/enhance-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "preview" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setAiError(payload.error ?? "AI notes could not be generated.");
        return;
      }
      setAiPreview(payload as AiNotesPreview);
    } catch {
      setAiError("AI notes could not be generated.");
    } finally {
      setEnhancingNotes(false);
    }
  }

  async function handleApplyAiNotes() {
    if (!aiPreview) return;
    await applyAiNotes.mutateAsync({
      meetingId,
      notes: aiPreview.ai_notes_markdown,
      model: aiPreview.model,
      promptVersion: aiPreview.prompt_version,
      generatedAt: aiPreview.generated_at,
    });
    setNotes(aiPreview.ai_notes_markdown);
    setAiPreview(null);
    setAiError(null);
  }

  function updateSuggestionDraft(
    suggestionId: string,
    patch: Partial<Pick<MeetingAiSuggestion, "title" | "owner_name" | "due_date">>
  ) {
    setAiSuggestions((current) =>
      current.map((suggestion) =>
        suggestion.id === suggestionId ? { ...suggestion, ...patch } : suggestion
      )
    );
  }

  async function refreshTrackedMeetingData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) }),
      queryClient.invalidateQueries({ queryKey: issueKeys.all }),
      queryClient.invalidateQueries({ queryKey: issueKeys.list(seriesId) }),
      queryClient.invalidateQueries({ queryKey: decisionKeys.all }),
    ]);
  }

  async function generateSuggestions() {
    setSuggestionsError(null);
    setLoadingSuggestions(true);
    setGeneratingSuggestions(true);
    try {
      const response = await fetch(`/api/meetings/${meetingId}/suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "generate" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSuggestionsError(payload.error ?? "AI suggestions could not be generated.");
        return;
      }
      setAiSuggestions(payload.suggestions ?? []);
      // The action items exist now, so the extraction failure no longer holds.
      setTranscriptionFailure((current) =>
        current?.kind === "extraction_failed" ? null : current
      );
    } catch {
      setSuggestionsError("AI suggestions could not be generated.");
    } finally {
      setLoadingSuggestions(false);
      setGeneratingSuggestions(false);
    }
  }

  async function handleSuggestionReview(
    suggestion: MeetingAiSuggestion,
    action: "accept" | "reject"
  ) {
    setReviewingSuggestionId(suggestion.id);
    setSuggestionsError(null);
    try {
      const response = await fetch(
        `/api/meetings/${meetingId}/suggestions/${suggestion.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            title: suggestion.title,
            category: suggestion.category,
            owner_name: suggestion.owner_name ?? "",
            due_date: suggestion.due_date ?? null,
          }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSuggestionsError(payload.error ?? "AI suggestion could not be reviewed.");
        return;
      }
      const reviewedSuggestion = payload.suggestion as MeetingAiSuggestion;
      setAiSuggestions((current) =>
        current.map((item) => (item.id === suggestion.id ? reviewedSuggestion : item))
      );
      if (action === "accept") {
        await refreshTrackedMeetingData();
      }
    } catch {
      setSuggestionsError("AI suggestion could not be reviewed.");
    } finally {
      setReviewingSuggestionId(null);
    }
  }

  // =========================================================================
  // LIVE MODE
  // =========================================================================
  if (meeting.status === "live") {
    return (
      <div className="min-h-full bg-paper">
        <SyncIndicator status={syncStatus} pendingCount={pendingCount} />

        {/* Header bar */}
        <div className="border-b border-rule">
          <div className="mx-auto max-w-7xl px-6 py-3 flex items-center gap-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 bg-accent text-white text-[10px] font-semibold px-2.5 py-1 rounded-full uppercase tracking-wider">
                <span className="size-1.5 rounded-full bg-white animate-pulse" />
                Live
              </span>
              <div>
                <h1 className="font-display text-base font-semibold text-ink leading-tight">
                  {series?.name}
                  {meetingSequence && (
                    <span className="text-ink-3 font-normal"> - M-{meetingSequence}</span>
                  )}
                </h1>
                <p className="text-xs font-mono text-ink-4">
                  {formatShortDate(meeting.date)} · {meeting.attendees?.length ?? 0} attendees present
                </p>
                <p className="text-xs text-ink-3">
                  Active now: {activePresenceLabel}
                </p>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-4">
              <span className="text-sm font-mono text-ink-2 tabular-nums tracking-wider">
                {timer}
              </span>

              {/* Audio capture (meeting managers only) */}
              {canManageMeeting && hasAccess && (
                <div className="flex items-center gap-2">
                  <RecordingIndicator
                    state={recorder.state}
                    durationSeconds={recorder.durationSeconds}
                    isSupported={recorder.isSupported}
                    error={recorder.error}
                    uploading={savingRecording}
                    hideRecord={companionStatus.kind === "starting" || companionStatus.kind === "recording"}
                    onStart={handleStartBrowserRecording}
                    onStop={handleStopRecording}
                    onPause={recorder.pause}
                    onResume={recorder.resume}
                  />
                </div>
              )}

              <CompanionRecordStrip
                status={companionStatus}
                meetingId={meeting.id}
                canAct={canManageMeeting && hasAccess && recorder.state === "idle"}
                onRecordOnMac={() => void handleRecordOnMac()}
                onOpenMac={() => void handleRecordOnMac()}
                onRecordHere={() => void handleStartBrowserRecording()}
              />

              {recorder.state === "stopped" &&
                (recorder.fastLane.state === "finalizing" ||
                  recorder.fastLane.state === "active") && (
                  <p
                    className="text-xs text-ink-3 flex items-center gap-1.5"
                    role="status"
                  >
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    Wrapping up the recap...
                  </p>
                )}

              {/* Attendee avatars */}
              {meeting.attendees && meeting.attendees.length > 0 && (
                <div className="flex -space-x-1.5">
                  {meeting.attendees.slice(0, 5).map((name) => (
                    <AttendeeAvatar key={name} name={name} />
                  ))}
                  {meeting.attendees.length > 5 && (
                    <span className="inline-flex items-center justify-center size-7 rounded-full bg-paper-2 text-[10px] font-medium text-ink-3 ring-2 ring-paper">
                      +{meeting.attendees.length - 5}
                    </span>
                  )}
                </div>
              )}

              {canManageMeeting && (
                <Button
                  onClick={handleEndMeeting}
                  disabled={endMeeting.isPending}
                  variant="outline"
                  className="text-ink border-rule hover:bg-paper-2"
                >
                  <Square className="size-3" />
                  End meeting
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Companion app install nudge */}
        {companionStatus.kind === "install" && profile && (
          <CompanionInstallPrompt userId={profile.id} />
        )}

        {/* Transcription status */}
        {LIVE_STATUS_STATES.includes(transcriptionState) && (
          <div className="mx-auto max-w-7xl px-6 pt-6">
            <TranscriptionStatus {...transcriptionStatusProps} />
          </div>
        )}

        {/* Two-column layout */}
        <div className="mx-auto max-w-7xl px-6 py-6 flex gap-6">
          {/* Main column */}
          <div className="flex-1 min-w-0">
            {/* Capture input */}
            <div className="mb-8 rounded-xl bg-card p-5 shadow-[var(--shadow-raised)]">
              <CaptureInput onSubmit={handleCapture} />
            </div>

            {/* Carried from last meeting */}
            {(carriedIssues.length > 0 || doneThisMeeting.length > 0) && (
              <section className="mb-8">
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-[11px] font-mono uppercase tracking-wider text-ink-4 font-medium">
                    Carried from last meeting
                  </h2>
                  <span className="text-[11px] font-mono text-ink-4 tabular-nums">
                    {carriedIssues.length}
                  </span>
                  <div className="flex-1 border-t border-dashed border-rule" />
                </div>
                <div>
                  <AnimatePresence mode="popLayout">
                    {carriedIssues.map((issue, idx) => (
                      <CarriedIssueCard
                        key={issue.id}
                        issue={issue}
                        index={idx}
                        onStatusChange={handleStatusChange}
                      />
                    ))}
                  </AnimatePresence>
                </div>

                {doneThisMeeting.length > 0 && (
                  <div className="mt-4">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-ink-4/60">
                        Done this meeting
                      </span>
                      <span className="text-[10px] font-mono text-ink-4/60 tabular-nums">
                        {doneThisMeeting.length}
                      </span>
                      <div className="flex-1 border-t border-dashed border-rule/50" />
                    </div>
                    <div>
                      {doneThisMeeting.map((issue, idx) => (
                        <CarriedIssueCard
                          key={issue.id}
                          issue={issue}
                          index={idx}
                          onStatusChange={handleStatusChange}
                          done
                        />
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Today's capture */}
            <section>
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-[11px] font-mono uppercase tracking-wider text-ink-4 font-medium">
                  Today&apos;s capture
                </h2>
                <span className="text-[11px] font-mono text-ink-4 tabular-nums">
                  {raisedInThisMeeting.length}
                </span>
                <div className="flex-1 border-t border-dashed border-rule" />
              </div>
              <div aria-live="polite" aria-relevant="additions">
                <InlineTaskList
                  issues={raisedInThisMeeting}
                  attendees={meeting.attendees ?? series?.default_attendees ?? []}
                  onStatusChange={handleStatusChange}
                  onTitleChange={handleTitleChange}
                  onAssigneeChange={handleAssigneeChange}
                  onAddItem={handleInlineAdd}
                />
              </div>
            </section>

            {/* Decisions */}
            {meetingDecisions.length > 0 && (
              <section>
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-[11px] font-mono uppercase tracking-wider text-ink-4 font-medium">
                    Decisions
                  </h2>
                  <span className="text-[11px] font-mono text-ink-4 tabular-nums">
                    {meetingDecisions.length}
                  </span>
                  <div className="flex-1 border-t border-dashed border-rule" />
                </div>
                <div className="space-y-1">
                  {meetingDecisions.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-paper-2 transition-colors"
                    >
                      <span className="text-accent text-xs">&#9670;</span>
                      <span className="flex-1 text-sm text-ink">{d.title}</span>
                      <span className="text-[10px] text-ink-4 font-medium uppercase tracking-wider">Decision</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Notes sidebar */}
          <div className="w-80 shrink-0 hidden lg:block">
            <div className="sticky top-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[11px] font-mono uppercase tracking-wider text-ink-4 font-medium">
                  Freeform notes
                </h3>
                <span className="text-[10px] text-ink-4">
                  {updateNotes.isPending ? "Saving…" : updateNotes.isError ? "Save failed" : "Autosaved"}
                </span>
              </div>
              <Textarea
                ref={liveNotesAreaRef}
                value={notes}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder="Type meeting notes here..."
                className="min-h-[300px] bg-card border-rule text-sm font-sans leading-relaxed resize-y"
              />
              <div className="mt-4 pt-4 border-t border-rule">
                <h3 className="text-[11px] font-mono uppercase tracking-wider text-ink-4 font-medium mb-3">
                  Sync status
                </h3>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "size-2 rounded-full",
                    syncStatus === "synced" ? "bg-success" :
                    syncStatus === "syncing" ? "bg-warn animate-pulse" :
                    "bg-warn"
                  )} />
                  <span className="text-xs text-ink-3">
                    {syncStatus === "synced" && "Synced"}
                    {syncStatus === "syncing" && "Syncing..."}
                    {syncStatus === "offline" && (
                      pendingCount > 0
                        ? `${pendingCount} item${pendingCount === 1 ? "" : "s"} buffered`
                        : "Offline"
                    )}
                  </span>
                </div>
                <p className="text-[10px] text-ink-4 mt-1.5">
                  Offline capture buffered locally; auto-syncs when connection returns.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // UPCOMING MODE
  // =========================================================================
  if (meeting.status === "upcoming") {
    const openIssues = (seriesIssues ?? []).filter(
      (issue) => issue.status !== "resolved" && issue.status !== "dropped"
    );
    const agendaDrafts = raisedInThisMeeting.filter(
      (issue) => issue.source === "calendar_auto_draft"
    );
    const briefIssues = openIssues.filter(
      (issue) => issue.source !== "calendar_auto_draft"
    );

    return (
      <div className="min-h-full bg-paper">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-6">
            <Link
              href={`/series/${seriesId}`}
              className="text-ink-3 hover:text-ink transition-colors"
            >
              <ArrowLeft className="size-5" />
            </Link>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-2">{series?.name}</span>
                {meetingSequence && (
                  <span className="text-xs font-mono text-ink-4">
                    M-{meetingSequence}
                  </span>
                )}
              </div>
              <h1 className="font-display text-xl font-semibold text-ink mt-1">
                {meeting.title}
              </h1>
            </div>
            <Button variant="accent"
              onClick={handleStartMeeting}
              disabled={startOrJoinMeeting.isPending}
            >
              <Play className="size-4" />
              {liveMeetingInSeries ? "Join live meeting" : "Start meeting"}
            </Button>
          </div>

          {agendaDrafts.length > 0 && (
            <section className="mb-6 space-y-3" aria-label="Drafted agenda items">
              <CalendarDraftNotice count={agendaDrafts.length} />
              <InlineTaskList
                issues={agendaDrafts}
                attendees={meeting.attendees ?? series?.default_attendees ?? []}
                onStatusChange={handleStatusChange}
                onTitleChange={handleTitleChange}
                onAssigneeChange={handleAssigneeChange}
              />
            </section>
          )}

          <div className="mb-6">
            <BriefCard
              seriesId={seriesId}
              seriesName={series?.name ?? ""}
              nextMeetingDate={new Date(meeting.date)}
              pendingIssues={briefIssues.slice(0, 10)}
            />
          </div>

          <div className="mb-8">
            {hasAccess ? (
              <CarryoverBriefingPanel meetingId={meetingId} issueCount={openIssues.length} />
            ) : openIssues.length > 0 ? (
              <AiUnavailableNotice />
            ) : null}
          </div>

          {meeting.attendees && meeting.attendees.length > 0 && (
            <section>
              <h2 className="font-display text-lg font-medium text-ink mb-3">
                Attendees
              </h2>
              <div className="flex flex-wrap gap-2">
                {meeting.attendees.map((attendee) => (
                  <span
                    key={attendee}
                    className="text-xs bg-paper-2 text-ink-2 px-2.5 py-1 rounded-full"
                  >
                    {attendee}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // COMPLETED MODE
  // =========================================================================
  const attendees = meeting.attendees ?? [];
  const durationMinutes = meetingDurationMinutes(meeting);
  const hasDiarizedTranscript = !!(
    meeting?.transcript_diarized && meeting.transcript_segments?.length
  );

  const pending = aiSuggestions.filter((item) => item.status === "pending");
  const reviewed = aiSuggestions.filter((item) => item.status !== "pending");
  const accepted = reviewed.filter((item) => item.status === "accepted").length;
  if (pending.length !== seenPending) {
    setSeenPending(pending.length);
    if (seenPending > 0 && pending.length === 0 && reviewed.length > 0) {
      setLoopClosedKey((key) => key + 1);
    }
  }
  const storedRecap = meeting.recap_markdown?.trim() || null;
  const companionNotes = (meeting.companion_notes_markdown ?? "").trim();
  const hasSource = !!(
    meeting.transcript_raw?.trim() ||
    meeting.notes_markdown?.trim() ||
    meeting.companion_notes_markdown?.trim()
  );
  const hasAnyNotes = !!notes.trim() || !!companionNotes;
  const canGenerateRecap = canManageMeeting && hasAccess;
  const recapPreparing =
    finishing ||
    (recorder.state === "stopped" &&
      (recorder.fastLane.state === "active" || recorder.fastLane.state === "finalizing")) ||
    (["saving", "saved_pending", "transcribing", "processing_return", "waiting_device"] as TranscriptionUiState[]).includes(
      transcriptionState
    );
  const step = canManageMeeting
    ? recapStep(transcriptionState, generatingSuggestions, recapStreaming || recapPreparing)
    : null;
  const progressDetail = recapProgressDetail(
    transcriptionState,
    resolveTranscriptionView({
      state: transcriptionState,
      partsDone: recorder.fastLane.segmentsDone,
      partsTotal: recorder.fastLane.segmentsTotal,
      elapsedSeconds: runAgeMs != null ? Math.floor(runAgeMs / 1000) : undefined,
      startedMinutesAgo: runAgeMs != null ? Math.floor(runAgeMs / 60000) : null,
    }).details
  );
  const autoStartRecap =
    autoStartSummary ||
    (shouldAutoStartRecap({ canGenerate: canGenerateRecap, storedText: storedRecap, hasSource }) &&
      !recapPreparing &&
      finishingOpenedAt === null);

  const HIDDEN_ON_RECAP: TranscriptionUiState[] = [
    "recording",
    "paused",
    "mic_denied",
    "saving",
    "saved_pending",
    "transcribing",
    "processing_return",
    "transcript_ready",
    "extraction_failed",
  ];
  const QUIET: TranscriptionUiState[] = ["no_recording", "empty_unknown", "no_speech"];
  const showStatus =
    canManageMeeting &&
    !finishing &&
    !HIDDEN_ON_RECAP.includes(transcriptionState) &&
    !(transcriptionState === "no_recording" && hasAnyNotes);
  const alertShown = showStatus && !QUIET.includes(transcriptionState);
  const logCount = raisedInThisMeeting.length + doneThisMeeting.length + meetingDecisions.length;
  const sendEmphasis =
    !alertShown &&
    ((aiSuggestions.length > 0 && pending.length === 0) ||
      (aiSuggestions.length === 0 && !findingSuggestions && logCount > 0))
      ? "accent"
      : "outline";
  const regen = canGenerateRecap && !!storedRecap;
  const findAgain = canGenerateRecap && aiSuggestions.length > 0;

  const speakers = hasDiarizedTranscript
    ? [...new Set((meeting.transcript_segments ?? []).map((segment) => segment.speaker))]
    : [];
  const speakerLabel = `${speakers.length} ${speakers.length === 1 ? "speaker" : "speakers"}`;
  const speakerMeta =
    speakers.length === 0
      ? null
      : speakers.every((speaker) => speaker === "me" || speaker === "them")
        ? `Me / Them · ${speakerLabel}`
        : speakerLabel;
  const transcriptMeta = [speakerMeta, transcriptProvenance(meeting)].filter(Boolean).join(" · ") || null;
  const showTranscript =
    finishing || hasDiarizedTranscript || !!transcript.trim() || (canManageMeeting && !meeting.audio_file_path);

  const renderSuggestion = (suggestion: MeetingAiSuggestion, i: number) => {
    const isReviewed = suggestion.status !== "pending";
    const relatedHref =
      suggestion.related_issue_number != null
        ? issueHrefByNumber.get(suggestion.related_issue_number) ?? null
        : null;
    // status_update / duplicate_warning act on an existing OIL
    // item, so their fields are read-only; only a new_item is editable.
    const isContextual = suggestion.type !== "new_item";
    return (
        <article
          key={suggestion.id}
          data-suggestion-card
          className="materialize py-4"
          style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <SuggestionContextBadge
                type={suggestion.type}
                relatedIssueNumber={suggestion.related_issue_number}
                suggestedStatus={suggestion.suggested_status}
                relatedHref={relatedHref}
              />
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                {suggestionCategoryLabel(suggestion.category)}
              </span>
            </div>
            <span className="rounded-full bg-paper-2 px-2 py-1 text-[11px] font-mono text-ink-3">
              {Math.round(suggestion.confidence * 100)}%
            </span>
          </div>

          {isContextual ? (
            <p className="text-sm leading-6 text-ink-2">{suggestion.title}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 @lg/log:grid-cols-[minmax(0,1fr)_10rem_9rem]">
              <input
                aria-label="Suggestion title"
                value={suggestion.title}
                disabled={isReviewed}
                onChange={(event) =>
                  updateSuggestionDraft(suggestion.id, { title: event.target.value })
                }
                className="col-span-2 min-w-0 rounded-md border border-rule bg-card px-3 py-2 text-sm text-ink-2 disabled:bg-paper-2 disabled:text-ink-3 @lg/log:col-span-1"
              />
              <input
                aria-label="Suggestion owner"
                value={suggestion.owner_name ?? ""}
                disabled={isReviewed}
                onChange={(event) =>
                  updateSuggestionDraft(suggestion.id, { owner_name: event.target.value })
                }
                placeholder="Owner"
                className="min-w-0 rounded-md border border-rule bg-card px-3 py-2 text-sm text-ink disabled:bg-paper-2 disabled:text-ink-3"
              />
              <input
                aria-label="Suggestion due date"
                type="date"
                value={dateInputValue(suggestion.due_date)}
                disabled={isReviewed}
                onChange={(event) =>
                  updateSuggestionDraft(suggestion.id, {
                    due_date: event.target.value || null,
                  })
                }
                className="min-w-0 rounded-md border border-rule bg-card px-3 py-2 text-sm text-ink disabled:bg-paper-2 disabled:text-ink-3"
              />
            </div>
          )}

          {suggestion.source_excerpt && (
            <p className="mt-3 rounded-md bg-paper-2 px-3 py-2 text-xs leading-5 text-ink-3">
              {suggestion.source_excerpt}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-ink-3">
              {suggestion.status === "accepted" &&
                (suggestion.type === "status_update"
                  ? "Applied to the linked item."
                  : "Accepted into tracked work.")}
              {suggestion.status === "rejected" && "Dismissed."}
              {suggestion.status === "pending" &&
                (suggestion.type === "duplicate_warning"
                  ? "Review to dismiss, or open the existing item."
                  : "Pending review.")}
            </p>
            {suggestion.status === "pending" && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSuggestionReview(suggestion, "reject")}
                  disabled={reviewingSuggestionId === suggestion.id}
                >
                  <X className="size-3.5" />
                  Reject suggestion
                </Button>
                {suggestion.type !== "duplicate_warning" && (
                  <Button variant="accent"
                    type="button"
                    size="sm"
                    onClick={() => handleSuggestionReview(suggestion, "accept")}
                    disabled={reviewingSuggestionId === suggestion.id || !suggestion.title.trim()}
                  >
                    {reviewingSuggestionId === suggestion.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Check className="size-3.5" />
                    )}
                    Accept suggestion
                  </Button>
                )}
              </div>
            )}
          </div>
        </article>
    );
  };

  const reviewedToggle = (label: string) => (
    <Button
      type="button"
      variant="link"
      size="sm"
      className="h-auto px-0 text-ink"
      onClick={() => setShowReviewed((open) => !open)}
    >
      {label}
    </Button>
  );

  const pendingGroup =
    canManageMeeting && hasAccess && transcriptionState !== "extraction_failed" && pending.length > 0 ? (
      <motion.div
        key="to-review"
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.32, ease: [0.2, 0, 0, 1] }}
        className="overflow-hidden"
      >
        <LogGroupLabel
          label="To review"
          count={pending.length}
          tone="accent"
          aside={transcript.trim() ? "Suggested from the transcript" : "Suggested from your notes"}
        />
        <div role="region" aria-label="AI suggestions" className="divide-y divide-rule">
          {pending.map(renderSuggestion)}
          {showReviewed && reviewed.map(renderSuggestion)}
        </div>
        {reviewed.length > 0 && reviewedToggle(`Show ${reviewed.length} reviewed`)}
      </motion.div>
    ) : null;

  let reviewStatus: React.ReactNode = null;
  if (canManageMeeting) {
    if (!hasAccess) {
      reviewStatus = <AiUnavailableNotice />;
    } else if (transcriptionState === "extraction_failed") {
      reviewStatus = (
        <p className="text-sm text-ink-3">
          Action items could not be created.{" "}
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0 text-ink"
            onClick={handleRetryActionItems}
          >
            Retry action items
          </Button>
        </p>
      );
    } else if (pending.length > 0) {
      reviewStatus = null;
    } else if (findingSuggestions) {
      reviewStatus = (
        <div>
          <LogGroupLabel label="To review" count={0} tone="accent" />
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      );
    } else if (aiSuggestions.length > 0) {
      reviewStatus = (
        <div>
          <p className="materialize text-sm text-ink-3">
            Review complete. {accepted} added to the log, {reviewed.length - accepted} dismissed.{" "}
            {reviewedToggle("Show reviewed")}
          </p>
          {showReviewed && (
            <div role="region" aria-label="AI suggestions" className="mt-2 divide-y divide-rule">
              {reviewed.map(renderSuggestion)}
            </div>
          )}
        </div>
      );
    } else if (hasSource) {
      reviewStatus = (
        <p className="text-sm text-ink-3">
          No suggestions for this meeting.{" "}
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0 text-ink"
            onClick={() => void generateSuggestions()}
          >
            Find action items
          </Button>
        </p>
      );
    }
  }

  return (
    <div className="min-h-full bg-paper">
      <div className="@container/recap">
      <div className="recap-shell mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center gap-3">
          <Link
            href={`/series/${seriesId}`}
            className="text-ink-3 transition-colors hover:text-ink"
            aria-label="Back to series"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <p className="flex-1 truncate font-mono text-[11px] uppercase tracking-[0.18em] text-ink-4">
            {series?.name}
            {series?.name && " / "}
            {formatShortDate(meeting.date)}
          </p>
          <div className="flex items-center gap-2">
            <SendMeetingNotesButton
              meetingId={meetingId}
              attendees={meeting.attendees ?? series?.default_attendees ?? []}
              emphasis={sendEmphasis}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canManageMeeting && <RemindOwnersButton seriesId={seriesId} as="menuitem" />}
                <ShareButton resource_type="meeting" resource_id={meetingId} as="menuitem" />
                {(regen || findAgain || canDownloadAudio) && <DropdownMenuSeparator />}
                {regen && (
                  <DropdownMenuItem onSelect={() => setRegenerateNonce((n) => n + 1)}>
                    Regenerate recap
                  </DropdownMenuItem>
                )}
                {findAgain && (
                  <DropdownMenuItem onSelect={() => void generateSuggestions()}>
                    Find action items again
                  </DropdownMenuItem>
                )}
                {canDownloadAudio && (
                  <DropdownMenuItem onSelect={() => void handleDownloadAudio()}>
                    Download audio
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <header className="mb-8">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-accent">
            Meeting recap
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold leading-[1.1] tracking-tight text-ink">
            {meeting.title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-3">
            <span className="font-mono text-xs tabular-nums text-ink-4">
              {formatMeetingDate(meeting.date)}
            </span>
            {durationMinutes && (
              <>
                <span className="text-ink-4" aria-hidden="true">·</span>
                <span className="font-mono text-xs tabular-nums text-ink-4">
                  {durationMinutes} min
                </span>
              </>
            )}
            {attendees.length > 0 && (
              <>
                <span className="text-ink-4" aria-hidden="true">·</span>
                <span className="flex -space-x-1.5">
                  {attendees.slice(0, 5).map((name) => (
                    <AttendeeAvatar key={name} name={name} />
                  ))}
                  {attendees.length > 5 && (
                    <span className="inline-flex size-7 items-center justify-center rounded-full bg-paper-2 text-[10px] font-medium text-ink-3 ring-2 ring-paper">
                      +{attendees.length - 5}
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
        </header>

        <RecapProgress active={step} detail={step === "transcribe" ? progressDetail : undefined} />

        {showStatus && (
          <div className="recap-status">
            <TranscriptionStatus
              {...transcriptionStatusProps}
              tone={QUIET.includes(transcriptionState) ? "quiet" : "card"}
            />
          </div>
        )}

        <div className="recap-grid">
          <FlowingSummary
            meetingId={meetingId}
            canGenerate={canGenerateRecap}
            initialText={storedRecap}
            generatedAt={meeting.recap_generated_at}
            model={meeting.recap_model}
            autoStart={autoStartRecap}
            preparing={recapPreparing}
            regenerateNonce={regenerateNonce}
            onStreamingChange={setRecapStreaming}
            onRecapWritten={() =>
              void queryClient.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) })
            }
          />

          <section aria-label="Tracked in the log" className="recap-rail @container/log">
            <SectionHeading title="Tracked in the log" flashKey={loopClosedKey || undefined} />
            <div className="space-y-6">
              {canManageMeeting && suggestionsError && (
                <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-ink">
                  {suggestionsError}
                </div>
              )}
              <AnimatePresence initial={false}>{pendingGroup}</AnimatePresence>
              {reviewStatus}

              <section aria-label="Items raised">
                <LogGroupLabel label="Items raised" count={raisedInThisMeeting.length} />
                <InlineTaskList
                  issues={raisedInThisMeeting}
                  attendees={meeting.attendees ?? series?.default_attendees ?? []}
                  onStatusChange={handleStatusChange}
                  onTitleChange={handleTitleChange}
                  onAssigneeChange={handleAssigneeChange}
                  onAddItem={handleInlineAdd}
                  emptyText={null}
                />
              </section>

              {doneThisMeeting.length > 0 && (
                <section aria-label="Resolved this meeting">
                  <LogGroupLabel label="Resolved this meeting" count={doneThisMeeting.length} />
                  <InlineTaskList
                    issues={doneThisMeeting}
                    attendees={meeting.attendees ?? series?.default_attendees ?? []}
                    onStatusChange={handleStatusChange}
                    onTitleChange={handleTitleChange}
                    onAssigneeChange={handleAssigneeChange}
                  />
                </section>
              )}

              {meetingDecisions.length > 0 && (
                <section aria-label="Decisions">
                  <LogGroupLabel label="Decisions" count={meetingDecisions.length} />
                  <div className="space-y-3">
                    {meetingDecisions.map((decision) => (
                      <DecisionCard key={decision.id} decision={decision} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          </section>

          {(canManageMeeting || hasAnyNotes) && (
            <section aria-label="Notes">
              <div className="mb-4 flex items-baseline gap-3">
                <h2
                  className="font-display text-xl font-semibold text-ink"
                  title={
                    meeting.ai_notes_generated_at
                      ? `AI-enhanced with ${meeting.ai_notes_model ?? "configured model"}`
                      : undefined
                  }
                >
                  Notes
                </h2>
                <div className="ml-1 flex-1 self-center border-t border-rule" />
                {canManageMeeting && hasAccess && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleEnhanceNotes}
                    disabled={enhancingNotes || (!notes.trim() && !transcript.trim())}
                  >
                    {enhancingNotes ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="size-3.5" />
                    )}
                    Enhance notes
                  </Button>
                )}
              </div>
              {aiError && (
                <div className="mb-3 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-ink">
                  {aiError}
                </div>
              )}
              <MeetingNotesSurface
                webNotes={notes}
                companionNotes={companionNotes}
                canEdit={canManageMeeting}
                onChange={handleNotesChange}
                textareaRef={notesAreaRef}
              />
            </section>
          )}

          {showTranscript && (
            <section>
              <button
                type="button"
                onClick={() => setTranscriptOpen((open) => !open)}
                className="flex w-full items-baseline gap-3 text-left"
                aria-expanded={transcriptOpen}
              >
                <span className="font-display text-xl font-semibold text-ink">Transcript</span>
                {transcriptMeta && (
                  <span className="font-mono text-[11px] text-ink-4">{transcriptMeta}</span>
                )}
                <span className="flex-1 self-center border-t border-rule" />
                <ChevronDown
                  className={`size-4 shrink-0 self-center text-ink-3 transition-transform ${transcriptOpen ? "rotate-180" : ""}`}
                />
              </button>
              {transcriptOpen &&
                (finishing ? (
                  <div data-finishing-transcript className="mt-3 space-y-3 text-sm text-ink-2">
                    {heardWindows.map((text, i) => (
                      <p key={i}>{text}</p>
                    ))}
                    <p className="finishing-breath text-ink-3">Catching the last few minutes…</p>
                  </div>
                ) : hasDiarizedTranscript ? (
                  <div className="mt-3">
                    <DiarizedTranscript
                      segments={meeting?.transcript_segments ?? []}
                      speakerMap={meeting.speaker_map ?? undefined}
                      canEdit={canManageMeeting}
                      onRenameSpeaker={patchSpeaker}
                    />
                  </div>
                ) : (
                  <>
                    {canManageMeeting && !transcript.trim() && (
                      <p className="mb-2 mt-3 text-xs text-ink-4">
                        Paste a transcript to get a recap and action items.
                      </p>
                    )}
                    <Textarea
                      ref={transcriptAreaRef}
                      value={transcript}
                      onChange={(e) => handleTranscriptChange(e.target.value)}
                      readOnly={!canManageMeeting}
                      placeholder="Paste transcript..."
                      className="mt-3 min-h-[160px] font-sans text-sm"
                    />
                  </>
                ))}
            </section>
          )}
        </div>
      </div>
      </div>
      {aiPreview && (
        <div className="fixed inset-0 z-[90] bg-ink/25 px-4 py-6 backdrop-blur-sm sm:px-6">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="AI notes preview"
            className="mx-auto flex max-h-[calc(100vh-3rem)] max-w-5xl flex-col overflow-hidden rounded-lg border border-rule bg-paper shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
              <div>
                <p className="text-[11px] font-mono uppercase tracking-wider text-accent">
                  AI notes preview
                </p>
                <h3 className="mt-1 font-display text-xl font-semibold text-ink">
                  Review before applying
                </h3>
                <p className="mt-1 text-sm text-ink-3">
                  Your raw notes stay preserved. Apply only when the generated record looks right.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAiPreview(null)}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-paper-2 hover:text-ink"
                aria-label="Close AI notes preview"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 gap-0 overflow-hidden md:grid-cols-2">
              <div className="min-h-0 border-b border-rule md:border-b-0 md:border-r">
                <div className="border-b border-rule px-5 py-3">
                  <h4 className="text-sm font-semibold text-ink">Raw notes</h4>
                </div>
                <pre className="h-full overflow-auto whitespace-pre-wrap px-5 py-4 text-sm leading-6 text-ink-2">
                  {composeMeetingNotes({
                    raw_notes_markdown: meeting.raw_notes_markdown || notes || null,
                    notes_markdown: meeting.notes_markdown,
                    companion_notes_markdown: meeting.companion_notes_markdown,
                  }) || "No raw notes captured."}
                </pre>
              </div>
              <div className="min-h-0 bg-paper-2/40">
                <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3">
                  <div>
                    <h4 className="text-sm font-semibold text-ink">Structured record</h4>
                    <p className="mt-0.5 text-xs text-ink-4">
                      {structuredAiPreviewCount} suggested {structuredAiPreviewCount === 1 ? "entry" : "entries"}
                    </p>
                  </div>
                  <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">
                    Structured draft
                  </span>
                </div>
                <div className="h-full overflow-auto px-5 py-4">
                  <div className="space-y-3">
                    {structuredAiPreviewCount === 0 && (
                      <div className="rounded-lg border border-dashed border-rule bg-card px-4 py-8 text-center">
                        <p className="text-sm font-medium text-ink">No structured notes generated.</p>
                        <p className="mt-1 text-xs text-ink-4">
                          Add more raw notes, then try enhancing again.
                        </p>
                      </div>
                    )}
                    <AiNotesSection
                      title="Summary"
                      items={structuredAiPreview.summary}
                      icon={FileText}
                    />
                    <AiNotesSection
                      title="Action items"
                      items={structuredAiPreview.action_items}
                      icon={CheckSquare}
                      tone="good"
                    />
                    <AiNotesSection
                      title="Decisions"
                      items={structuredAiPreview.decisions}
                      icon={Gavel}
                    />
                    <AiNotesSection
                      title="Risks"
                      items={structuredAiPreview.risks}
                      icon={AlertTriangle}
                      tone="warn"
                    />
                    <AiNotesSection
                      title="Blockers"
                      items={structuredAiPreview.blockers}
                      icon={Ban}
                      tone="warn"
                    />
                    <AiNotesSection
                      title="Follow-ups"
                      items={structuredAiPreview.follow_ups}
                      icon={RotateCcw}
                    />
                    <AiNotesSection
                      title="Open questions"
                      items={structuredAiPreview.open_questions}
                      icon={HelpCircle}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-5 py-4">
              <p className="text-xs text-ink-4">
                {aiPreview.model} · {aiPreview.prompt_version}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setAiPreview(null)}
                >
                  Cancel
                </Button>
                <Button variant="accent"
                  type="button"
                  onClick={handleApplyAiNotes}
                  disabled={applyAiNotes.isPending}
                >
                  {applyAiNotes.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                  Apply AI notes
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
