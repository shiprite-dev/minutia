"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
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
import { useIssues, useCreateIssue, useUpdateIssueStatus, useUpdateIssue, useAssignIssue, issueKeys } from "@/lib/hooks/use-issues";
import { useCreateDecision, decisionKeys } from "@/lib/hooks/use-decisions";
import { SyncIndicator } from "@/components/minutia/sync-indicator";
import { useOfflineSync } from "@/lib/hooks/use-offline-sync";
import { addPendingItem, clearAudioChunks } from "@/lib/offline-buffer";
import { RecordingIndicator } from "@/components/minutia/recording-indicator";
import { useMeetingRecorder } from "@/lib/hooks/use-meeting-recorder";
import { uploadMeetingAudio } from "@/lib/audio";
import { createClient } from "@/lib/supabase/client";
import { CaptureInput } from "@/components/minutia/capture-input";
import { InlineTaskList } from "@/components/minutia/inline-task-list";
import { IssueCard } from "@/components/minutia/issue-card";
import { BriefCard } from "@/components/minutia/brief-card";
import { CalendarDraftNotice } from "@/components/minutia/calendar-draft-notice";
import { PrefetchIssueLink } from "@/components/minutia/prefetch-issue-link";
import { StatusChip } from "@/components/minutia/status-chip";
import { CategoryBadge } from "@/components/minutia/category-badge";
import { SuggestionContextBadge } from "@/components/minutia/suggestion-context-badge";
import { FlowingSummary } from "@/components/minutia/flowing-summary";
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
import { ArrowLeft, Square, Play, Check, X, Sparkles, Loader2, ListChecks, FileText, CheckSquare, Gavel, AlertTriangle, Ban, RotateCcw, HelpCircle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatShortDate } from "@/lib/date-utils";
import type { IssueCategory, IssueStatus, Issue, Decision, Meeting, MeetingAiSuggestion } from "@/lib/types";
import Link from "next/link";

interface MeetingDetailContentProps {
  seriesId: string;
  meetingId: string;
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

// A numbered section heading: mono ordinal + serif title + hairline rule.
// `number` is omitted when the recap (implicit 01) is absent, so the numbering
// degrades to plain headings rather than lying about section order.
function SectionHeading({
  number,
  title,
  className,
}: {
  number?: string;
  title: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex items-baseline gap-3", className)}>
      {number && (
        <span className="font-mono text-sm font-medium tabular-nums text-accent">
          {number}
        </span>
      )}
      <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
      <div className="ml-1 flex-1 self-center border-t border-rule" />
    </div>
  );
}

// A mono-caps eyebrow used for the sub-groups inside "Tracked in the log".
function LogGroupLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-ink-4">
        {label}
      </span>
      <span className="font-mono text-[11px] tabular-nums text-ink-4">{count}</span>
    </div>
  );
}

// Green-accented decision card (3px left border) matching the log card anatomy.
function DecisionCard({ decision }: { decision: Decision }) {
  return (
    <div className="rounded-md border border-rule border-l-[3px] border-l-success bg-card px-4 py-3 shadow-[var(--shadow-raised)]">
      <p className="font-mono text-[10px] font-medium uppercase tracking-wider text-success">
        Decision
      </p>
      <p className="mt-1 text-sm font-medium text-ink">{decision.title}</p>
      {decision.rationale && (
        <p className="mt-1 text-xs text-ink-2">{decision.rationale}</p>
      )}
      {decision.made_by && (
        <p className="mt-1 text-xs font-mono text-ink-4">by {decision.made_by}</p>
      )}
    </div>
  );
}

// "Diarized · N speakers" chip, green-dot tinted, shown when the transcript is
// speaker-attributed. Distinct speaker count comes from the segment rows.
function DiarizedChip({ speakerCount }: { speakerCount: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-medium text-success">
      <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
      Diarized · {speakerCount} {speakerCount === 1 ? "speaker" : "speakers"}
    </span>
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
  const { data: meeting, isLoading: meetingLoading } = useMeeting(meetingId);
  const { data: series } = useSeriesDetail(seriesId);
  const { data: participantRole } = useSeriesParticipantRole(seriesId);
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
  const [transcriptOpen, setTranscriptOpen] = React.useState(!!meeting?.transcript_raw);
  const [aiPreview, setAiPreview] = React.useState<AiNotesPreview | null>(null);
  const [aiError, setAiError] = React.useState<string | null>(null);
  const [enhancingNotes, setEnhancingNotes] = React.useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = React.useState(false);
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
  // Bumping this nonce re-runs the recap stream; driven by the footer "Replay
  // recap" button and the R shortcut on the completed view.
  const [replayNonce, setReplayNonce] = React.useState(0);
  const replayRecap = React.useCallback(() => setReplayNonce((n) => n + 1), []);

  // Pending suggestions are the ones awaiting review; the count drives the
  // "Review AI suggestions (N)" badge so the auto-extracted items are visible
  // without the facilitator having to guess they exist.
  const pendingSuggestionCount = aiSuggestions.filter((s) => s.status === "pending").length;

  // Load already-extracted suggestions (e.g. the ones the transcription
  // auto-generated) instead of re-running the model. This is what makes the
  // auto-trigger pay off: its output is shown, not silently discarded.
  const loadSuggestions = React.useCallback(async () => {
    setLoadingSuggestions(true);
    try {
      const response = await fetch(`/api/meetings/${meetingId}/suggestions`, { method: "GET" });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) setAiSuggestions(payload.suggestions ?? []);
    } catch {
      // Best-effort: the Review button can still trigger generation on demand.
    } finally {
      setLoadingSuggestions(false);
    }
  }, [meetingId]);

  // The recording pipeline: transcribe the uploaded audio, which auto-extracts
  // context-aware suggestions on completion, then surface them. Best-effort so a
  // missing AI key or provider hiccup never blocks the recording itself.
  const runTranscription = React.useCallback(async () => {
    setTranscribing(true);
    try {
      // Wait for the fast lane to settle so the tail segment's row is registered
      // before the final pass decides whether to trust the segment rows. Only
      // claim segment coverage when every segment actually completed.
      const lane = await recorder.waitForFastLane(25000);
      const body =
        lane.state === "ready" && lane.segmentsTotal > 0
          ? JSON.stringify({ expected_segments: lane.segmentsTotal })
          : "{}";
      const response = await fetch(`/api/meetings/${meetingId}/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (response.ok) {
        // The transcript text lands via the meeting realtime poll; pull the
        // suggestions the transcription just generated and reveal them.
        await loadSuggestions();
        setSuggestionsOpen(true);
      }
    } catch {
      // Network error; the recording is saved and transcription can be retried.
    } finally {
      setTranscribing(false);
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

  // R replays the recap on the completed view (managers with AI access only).
  // Guarded against typing contexts and modifier chords so it never hijacks a
  // keystroke meant for a field or a browser shortcut.
  const canReplayRecap =
    meeting?.status === "completed" &&
    (participantRole === "owner" || participantRole === "facilitator") &&
    hasAccess;
  React.useEffect(() => {
    if (!canReplayRecap) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "r" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement | null)?.isContentEditable) return;
      e.preventDefault();
      replayRecap();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [canReplayRecap, replayRecap]);

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

  if (!meeting) {
    return (
      <div className="min-h-full bg-paper flex items-center justify-center">
        <p className="text-sm text-ink-3">Meeting not found.</p>
      </div>
    );
  }

  const meetingIssues = meeting.issues ?? [];
  const meetingDecisions = meeting.decisions ?? [];
  const raisedInThisMeeting = meetingIssues;

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
        // Kick off transcription + context-aware extraction so the facilitator
        // returns to a ready transcript and suggested action items. Fire-and-
        // forget with its own progress state; it must not block stop/end.
        void runTranscription();
      }
    } catch {
      // Upload failed; the recording stays buffered in IndexedDB for recovery.
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
    if (liveMeeting.id !== meetingId) {
      router.push(`/series/${seriesId}/meetings/${liveMeeting.id}`);
    }
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

  // Open the panel and show what is already there. Only fetch if we have not
  // loaded yet; never auto-regenerate (that would discard the auto-extracted
  // suggestions and spend another AI call). Explicit (re)generation is a
  // separate button inside the panel.
  async function handleOpenSuggestions() {
    setSuggestionsOpen(true);
    setSuggestionsError(null);
    if (aiSuggestions.length === 0 && !loadingSuggestions) {
      await loadSuggestions();
    }
  }

  async function generateSuggestions() {
    setSuggestionsOpen(true);
    setSuggestionsError(null);
    setLoadingSuggestions(true);
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
    } catch {
      setSuggestionsError("AI suggestions could not be generated.");
    } finally {
      setLoadingSuggestions(false);
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
        current.map((item) =>
          item.id === suggestion.id ? reviewedSuggestion : item
        )
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
                <RecordingIndicator
                  state={recorder.state}
                  durationSeconds={recorder.durationSeconds}
                  isSupported={recorder.isSupported}
                  error={recorder.error}
                  uploading={savingRecording}
                  onStart={recorder.start}
                  onStop={handleStopRecording}
                  onPause={recorder.pause}
                  onResume={recorder.resume}
                />
              )}

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
            <Button
              onClick={handleStartMeeting}
              disabled={startOrJoinMeeting.isPending}
              className="bg-accent text-white hover:bg-accent-hover"
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
  const diarizedSpeakerCount =
    meeting.transcript_diarized && meeting.transcript_segments?.length
      ? new Set(meeting.transcript_segments.map((s) => s.speaker)).size
      : 0;
  // Numbers appear only when the implicit "01" recap is present (managers with a
  // recap); otherwise headings degrade to unnumbered per the design constraint.
  const logNumber = canManageMeeting ? "02" : undefined;
  const transcriptNumber = canManageMeeting ? "03" : undefined;
  const hasDiarizedTranscript = !!(
    meeting?.transcript_diarized && meeting.transcript_segments?.length
  );

  return (
    <div className="min-h-full bg-paper">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Top row: back to series, centered breadcrumb, record actions */}
        <div className="mb-8 flex items-center gap-3">
          <Link
            href={`/series/${seriesId}`}
            className="text-ink-3 transition-colors hover:text-ink"
            aria-label="Back to series"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <p className="flex-1 truncate text-center font-mono text-[11px] uppercase tracking-[0.18em] text-ink-4">
            {series?.name}
            {series?.name && " / "}
            {formatShortDate(meeting.date)}
          </p>
          <div className="flex items-center gap-2">
            <SendMeetingNotesButton
              meetingId={meetingId}
              attendees={meeting.attendees ?? series?.default_attendees ?? []}
            />
            {canManageMeeting && <RemindOwnersButton seriesId={seriesId} />}
            <ShareButton resource_type="meeting" resource_id={meetingId} />
          </div>
        </div>

        {/* Hero */}
        <header className="mb-10">
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
            {diarizedSpeakerCount > 0 && (
              <>
                <span className="text-ink-4" aria-hidden="true">·</span>
                <DiarizedChip speakerCount={diarizedSpeakerCount} />
              </>
            )}
          </div>
        </header>

        {canManageMeeting && (
          <FlowingSummary
            meetingId={meetingId}
            canGenerate={hasAccess}
            autoStart={autoStartSummary}
            replayNonce={replayNonce}
            preparing={
              recorder.state === "stopped" &&
              (recorder.fastLane.state === "active" ||
                recorder.fastLane.state === "finalizing")
            }
          />
        )}

        {canManageMeeting && (
        <section className="mb-8" aria-label="AI accountability review">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-card px-4 py-3 shadow-[var(--shadow-raised)]">
            <div>
              <h2 className="font-display text-base font-medium text-ink">
                Accountability review
              </h2>
              <p className="mt-1 text-xs text-ink-3">
                {transcribing
                  ? "Transcribing the recording and extracting action items…"
                  : "AI extracts suggested issues and decisions from the notes and transcript, deduped against this series. Approve what should become durable work."}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpenSuggestions}
              disabled={!hasAccess || transcribing || loadingSuggestions || (!notes.trim() && !transcript.trim())}
              className="border-rule bg-paper text-ink hover:bg-paper-2"
            >
              {transcribing || loadingSuggestions ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ListChecks className="size-3.5" />
              )}
              Review AI suggestions
              {pendingSuggestionCount > 0 && (
                <span className="ml-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {pendingSuggestionCount}
                </span>
              )}
            </Button>
          </div>

          {!hasAccess && (
            <AiUnavailableNotice className="mt-3" />
          )}

          {suggestionsOpen && (
            <div
              role="region"
              aria-label="AI suggestions"
              className="mt-3 rounded-lg border border-rule bg-paper"
            >
              <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold text-ink">AI suggestions</h3>
                  <p className="mt-1 text-xs text-ink-3">
                    Review each item before it enters the permanent record.
                  </p>
                </div>
                {loadingSuggestions ? (
                  <Loader2 className="size-4 animate-spin text-ink-3" />
                ) : (
                  aiSuggestions.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={generateSuggestions}
                      className="text-ink-3 hover:text-ink"
                    >
                      <RotateCcw className="size-3.5" />
                      Regenerate
                    </Button>
                  )
                )}
              </div>

              {suggestionsError && (
                <div className="mx-4 mt-3 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-ink">
                  {suggestionsError}
                </div>
              )}

              {!loadingSuggestions && aiSuggestions.length === 0 && (
                <div className="flex flex-col items-start gap-3 px-4 py-5 text-sm text-ink-3">
                  <p>No AI suggestions yet for this meeting.</p>
                  <Button
                    type="button"
                    size="sm"
                    onClick={generateSuggestions}
                    disabled={!notes.trim() && !transcript.trim()}
                    className="bg-accent text-white hover:bg-accent-hover"
                  >
                    <Sparkles className="size-3.5" />
                    Generate suggestions
                  </Button>
                </div>
              )}

              {aiSuggestions.length > 0 && (
                <div className="divide-y divide-rule">
                  {aiSuggestions.map((suggestion, i) => {
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
                        className="materialize px-4 py-4"
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
                          <p className="text-sm leading-6 text-ink">{suggestion.title}</p>
                        ) : (
                          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_9rem]">
                            <input
                              aria-label="Suggestion title"
                              value={suggestion.title}
                              disabled={isReviewed}
                              onChange={(event) =>
                                updateSuggestionDraft(suggestion.id, { title: event.target.value })
                              }
                              className="min-w-0 rounded-md border border-rule bg-card px-3 py-2 text-sm text-ink disabled:bg-paper-2 disabled:text-ink-3"
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
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => handleSuggestionReview(suggestion, "accept")}
                                  disabled={reviewingSuggestionId === suggestion.id || !suggestion.title.trim()}
                                  className="bg-accent text-white hover:bg-accent-hover"
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
                  })}
                </div>
              )}
            </div>
          )}
        </section>
        )}

        <div className="mb-10">
          <SectionHeading number={logNumber} title="Tracked in the log" />
          <div className="space-y-6">
            <section aria-label="Items raised">
              <LogGroupLabel label="Items raised" count={raisedInThisMeeting.length} />
              <InlineTaskList
                issues={raisedInThisMeeting}
                attendees={meeting.attendees ?? series?.default_attendees ?? []}
                onStatusChange={handleStatusChange}
                onTitleChange={handleTitleChange}
                onAssigneeChange={handleAssigneeChange}
                onAddItem={handleInlineAdd}
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
        </div>

        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-medium text-ink">
                Notes
              </h2>
              {meeting.ai_notes_generated_at && (
                <p className="mt-1 text-xs text-ink-4">
                  AI-enhanced with {meeting.ai_notes_model ?? "configured model"}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleEnhanceNotes}
              disabled={!hasAccess || enhancingNotes || (!notes.trim() && !transcript.trim())}
              className="border-rule bg-card text-ink hover:bg-paper-2"
            >
              {enhancingNotes ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              Enhance notes
            </Button>
          </div>
          {!hasAccess && (
            <AiUnavailableNotice className="mb-3" />
          )}
          {aiError && (
            <div className="mb-3 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-ink">
              {aiError}
            </div>
          )}
          <Textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            placeholder="Meeting notes..."
            className="min-h-[120px] font-sans text-sm"
          />
        </section>
        <section className="mt-10">
          <button
            type="button"
            onClick={() => setTranscriptOpen((open) => !open)}
            className="flex w-full items-baseline gap-3 text-left"
            aria-expanded={transcriptOpen}
          >
            {transcriptNumber && (
              <span className="font-mono text-sm font-medium tabular-nums text-accent">
                {transcriptNumber}
              </span>
            )}
            <span className="font-display text-xl font-semibold text-ink">Transcript</span>
            {!hasDiarizedTranscript && transcript.trim() && (
              <span className="font-mono text-[11px] tabular-nums text-ink-4">
                {transcript.length} chars
              </span>
            )}
            <span className="flex-1 self-center border-t border-rule" />
            <ChevronDown
              className={`size-4 shrink-0 self-center text-ink-3 transition-transform ${transcriptOpen ? "rotate-180" : ""}`}
            />
          </button>
          {!hasDiarizedTranscript && !transcript.trim() && (
            <p className="mt-2 text-xs text-ink-4">
              Paste a meeting transcript to power AI notes and suggestions.
            </p>
          )}
          {transcriptOpen && (
            hasDiarizedTranscript ? (
              <div className="mt-3">
                <DiarizedTranscript
                  segments={meeting?.transcript_segments ?? []}
                  speakerMap={meeting.speaker_map ?? undefined}
                  canEdit={canManageMeeting}
                  onRenameSpeaker={patchSpeaker}
                />
              </div>
            ) : (
              <Textarea
                value={transcript}
                onChange={(e) => handleTranscriptChange(e.target.value)}
                placeholder="Paste transcript..."
                className="mt-3 min-h-[160px] font-sans text-sm"
              />
            )
          )}
        </section>

        {canManageMeeting && (
          <footer className="mt-12 flex flex-col items-center gap-4 border-t border-rule pt-8 text-center">
            <p className="max-w-md font-mono text-[11px] leading-relaxed text-ink-4">
              Replay the recap to watch it land the way your team will - press R or the button.
            </p>
            <Button
              type="button"
              onClick={replayRecap}
              disabled={!hasAccess}
              className="bg-accent text-white hover:bg-accent-hover"
            >
              <RotateCcw className="size-3.5" />
              Replay recap
            </Button>
          </footer>
        )}
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
                  {meeting.raw_notes_markdown || notes || "No raw notes captured."}
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
                <Button
                  type="button"
                  onClick={handleApplyAiNotes}
                  disabled={applyAiNotes.isPending}
                  className="bg-accent text-white hover:bg-accent-hover"
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
