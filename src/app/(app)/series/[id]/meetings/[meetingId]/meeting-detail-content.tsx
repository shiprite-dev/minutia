"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { useMeeting, useEndMeeting, useStartMeeting } from "@/lib/hooks/use-meetings";
import { useSeriesDetail } from "@/lib/hooks/use-series";
import { useIssues, useCreateIssue, useUpdateIssueStatus } from "@/lib/hooks/use-issues";
import { useDecisions } from "@/lib/hooks/use-decisions";
import { SyncIndicator } from "@/components/minutia/sync-indicator";
import { CaptureInput } from "@/components/minutia/capture-input";
import { IssueCard } from "@/components/minutia/issue-card";
import { BriefCard } from "@/components/minutia/brief-card";
import { StatusChip } from "@/components/minutia/status-chip";
import { CategoryBadge } from "@/components/minutia/category-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Square, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IssueCategory, IssueStatus, Issue } from "@/lib/types";
import Link from "next/link";

interface MeetingDetailContentProps {
  seriesId: string;
  meetingId: string;
}

function formatMeetingDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatShortDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function MeetingDetailContent({
  seriesId,
  meetingId,
}: MeetingDetailContentProps) {
  const router = useRouter();
  const { data: meeting, isLoading: meetingLoading } = useMeeting(meetingId);
  const { data: series } = useSeriesDetail(seriesId);
  const { data: seriesIssues } = useIssues(seriesId);
  const { data: decisions } = useDecisions(meetingId);

  const endMeeting = useEndMeeting();
  const startMeeting = useStartMeeting();
  const createIssue = useCreateIssue();
  const updateIssueStatus = useUpdateIssueStatus();

  const [notes, setNotes] = React.useState(meeting?.summary ?? "");

  // Sync notes when meeting data loads
  React.useEffect(() => {
    if (meeting?.summary) setNotes(meeting.summary);
  }, [meeting?.summary]);

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
  const meetingDecisions = meeting.decisions ?? decisions ?? [];

  // Issues from this meeting
  const raisedInThisMeeting = meetingIssues;

  // Carried (open issues from this series that were NOT raised in this meeting)
  const carriedIssues = (seriesIssues ?? []).filter(
    (issue) =>
      issue.meeting_id !== meetingId &&
      issue.status !== "resolved" &&
      issue.status !== "dropped"
  );

  // Compute meeting sequence from series
  const meetingSequence = series?.meetings
    ? [...series.meetings]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .findIndex((m) => m.id === meetingId) + 1
    : null;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function handleCapture(text: string, category: IssueCategory) {
    await createIssue.mutateAsync({
      title: text,
      category,
      priority: "medium",
      meeting_id: meetingId,
      series_id: seriesId,
    });
  }

  function handleStatusChange(issueId: string, newStatus: IssueStatus) {
    const issue = [...raisedInThisMeeting, ...carriedIssues].find(
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

  async function handleEndMeeting() {
    await endMeeting.mutateAsync(meetingId);
  }

  async function handleStartMeeting() {
    await startMeeting.mutateAsync(meetingId);
  }

  // ---------------------------------------------------------------------------
  // LIVE mode
  // ---------------------------------------------------------------------------
  if (meeting.status === "live") {
    return (
      <div className="min-h-full bg-paper">
        <SyncIndicator status="synced" />

        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Link
                href={`/series/${seriesId}`}
                className="text-ink-3 hover:text-ink transition-colors"
              >
                <ArrowLeft className="size-5" />
              </Link>
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 bg-accent text-white text-[10px] font-medium px-2 py-0.5 rounded-full">
                    <span
                      className="size-1.5 rounded-full bg-white animate-pulse"
                      aria-hidden="true"
                    />
                    LIVE
                  </span>
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
            </div>

            <Button
              onClick={handleEndMeeting}
              disabled={endMeeting.isPending}
              variant="outline"
              className="text-danger border-danger/30 hover:bg-danger-soft"
            >
              <Square className="size-3.5" data-icon="inline-start" />
              End meeting
            </Button>
          </div>

          {/* Capture input */}
          <div className="mb-8 bg-card border border-rule rounded-md p-4">
            <CaptureInput onSubmit={handleCapture} />
          </div>

          {/* Today's capture */}
          <section className="mb-8">
            <h2 className="font-display text-lg font-medium text-ink mb-4">
              Today&apos;s capture
            </h2>
            {raisedInThisMeeting.length === 0 ? (
              <p className="text-sm text-ink-3 py-4">
                Start capturing items above.
              </p>
            ) : (
              <div className="space-y-3">
                <AnimatePresence mode="popLayout">
                  {raisedInThisMeeting.map((issue) => (
                    <motion.div
                      key={issue.id}
                      layout
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.18 }}
                    >
                      <IssueCard
                        issue={issue}
                        onStatusChange={handleStatusChange}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>

          {/* Carried from last meeting */}
          {carriedIssues.length > 0 && (
            <section>
              <h2 className="font-display text-lg font-medium text-ink mb-4">
                Carried from previous ({carriedIssues.length})
              </h2>
              <div className="space-y-3">
                {carriedIssues.map((issue) => (
                  <div
                    key={issue.id}
                    className="flex items-center justify-between bg-card border border-rule rounded-md p-4"
                  >
                    <div className="flex-1 min-w-0 mr-3">
                      <p className="text-sm font-medium text-ink truncate">
                        {issue.title}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <CategoryBadge category={issue.category} />
                        {issue.owner_name && (
                          <span className="text-xs text-ink-3">
                            {issue.owner_name}
                          </span>
                        )}
                        {issue.due_date && (
                          <span
                            className={cn(
                              "text-xs font-mono",
                              new Date(issue.due_date) < new Date()
                                ? "text-accent"
                                : "text-ink-4"
                            )}
                          >
                            {formatShortDate(issue.due_date)}
                          </span>
                        )}
                      </div>
                    </div>
                    <StatusChip
                      status={issue.status}
                      onChange={(newStatus) =>
                        handleStatusChange(issue.id, newStatus)
                      }
                    />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // UPCOMING mode
  // ---------------------------------------------------------------------------
  if (meeting.status === "upcoming") {
    const openIssues = (seriesIssues ?? []).filter(
      (issue) => issue.status !== "resolved" && issue.status !== "dropped"
    );

    return (
      <div className="min-h-full bg-paper">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          {/* Header */}
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
              disabled={startMeeting.isPending}
              className="bg-accent text-white hover:bg-accent-hover"
            >
              <Play className="size-4" data-icon="inline-start" />
              Start meeting
            </Button>
          </div>

          {/* Pre-meeting brief */}
          <div className="mb-8">
            <BriefCard
              seriesName={series?.name ?? ""}
              nextMeetingDate={new Date(meeting.date)}
              pendingIssues={openIssues.slice(0, 10)}
            />
          </div>

          {/* Attendees */}
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

  // ---------------------------------------------------------------------------
  // COMPLETED mode (Meeting Summary)
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-full bg-paper">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
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
            <p className="text-xs font-mono text-ink-4 mt-1">
              {formatMeetingDate(meeting.date)}
            </p>
          </div>
        </div>

        {/* Attendees */}
        {meeting.attendees && meeting.attendees.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {meeting.attendees.map((attendee) => (
              <span
                key={attendee}
                className="text-xs bg-paper-2 text-ink-2 px-2.5 py-1 rounded-full"
              >
                {attendee}
              </span>
            ))}
          </div>
        )}

        {/* Items raised */}
        <section className="mb-8">
          <h2 className="font-display text-lg font-medium text-ink mb-4">
            Items raised ({raisedInThisMeeting.length})
          </h2>
          {raisedInThisMeeting.length === 0 ? (
            <p className="text-sm text-ink-3">No items were captured.</p>
          ) : (
            <div className="space-y-3">
              {raisedInThisMeeting.map((issue) => (
                <IssueCard key={issue.id} issue={issue} />
              ))}
            </div>
          )}
        </section>

        {/* Decisions */}
        {meetingDecisions.length > 0 && (
          <section className="mb-8">
            <h2 className="font-display text-lg font-medium text-ink mb-4">
              Decisions ({meetingDecisions.length})
            </h2>
            <div className="space-y-3">
              {meetingDecisions.map((decision) => (
                <div
                  key={decision.id}
                  className="bg-card border border-rule rounded-md p-4"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-ink-3 shrink-0" aria-hidden="true">
                      ◆
                    </span>
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {decision.title}
                      </p>
                      {decision.rationale && (
                        <p className="text-xs text-ink-2 mt-1">
                          {decision.rationale}
                        </p>
                      )}
                      {decision.made_by && (
                        <p className="text-xs text-ink-3 mt-1">
                          by {decision.made_by}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Notes */}
        <section>
          <h2 className="font-display text-lg font-medium text-ink mb-4">
            Notes
          </h2>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Meeting notes..."
            className="min-h-[120px] font-sans text-sm"
          />
        </section>
      </div>
    </div>
  );
}
