"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "motion/react";
import {
  useSeriesDetail,
  useSeriesParticipantRole,
  useSeriesRealtime,
  useUpdateSeries,
} from "@/lib/hooks/use-series";
import {
  useStartOrJoinMeeting,
} from "@/lib/hooks/use-meetings";
import { useIssues } from "@/lib/hooks/use-issues";
import { useDecisions } from "@/lib/hooks/use-decisions";
import { BriefCard } from "@/components/minutia/brief-card";
import { EmptyState } from "@/components/minutia/empty-state";
import { IssueCard } from "@/components/minutia/issue-card";
import { DateAnchoredTimeline } from "@/components/minutia/date-anchored-timeline";
import { MinutiaCadenceIcon } from "@/components/minutia/minutia-icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { CADENCES } from "@/lib/constants";
import { createSeriesSchema, type CreateSeriesInput } from "@/lib/schemas";
import { ShareButton } from "@/components/minutia/share-button";
import { CsvImportDialog } from "@/components/minutia/csv-import-dialog";
import { ArrowLeft, Play, Settings, Loader2, Upload, Calendar, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Cadence, Issue, GoogleCalendarEntry } from "@/lib/types";
import {
  useGoogleCalendarStatus,
  useCalendarList,
  useLinkCalendar,
  useUnlinkCalendar,
} from "@/lib/hooks/use-google-calendar";
import Link from "next/link";

const cadenceLabels: Record<Cadence, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  adhoc: "Ad hoc",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SeriesDetailContentProps {
  seriesId: string;
}

export function SeriesDetailContent({ seriesId }: SeriesDetailContentProps) {
  const router = useRouter();
  const validSeriesId = UUID_PATTERN.test(seriesId);
  const querySeriesId = validSeriesId ? seriesId : "";
  const { data: series, isLoading: seriesLoading } = useSeriesDetail(seriesId);
  const { data: issues } = useIssues(querySeriesId, validSeriesId);
  const { data: decisions } = useDecisions(undefined, querySeriesId, validSeriesId);
  const { data: participantRole } = useSeriesParticipantRole(querySeriesId);

  useSeriesRealtime(querySeriesId);
  const startOrJoinMeeting = useStartOrJoinMeeting();

  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [startingMeeting, setStartingMeeting] = React.useState(false);

  // Filter open issues (not resolved/dropped)
  const openIssues = React.useMemo(
    () =>
      (issues ?? []).filter(
        (issue) => issue.status !== "resolved" && issue.status !== "dropped"
      ),
    [issues]
  );

  const meetings = React.useMemo(() => series?.meetings ?? [], [series?.meetings]);

  // Determine if brief should show
  const sortedMeetings = React.useMemo(
    () =>
      [...meetings].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      ),
    [meetings]
  );

  const nextMeeting = sortedMeetings.find(
    (m) => m.status === "upcoming" || m.status === "live"
  );
  const liveMeeting = sortedMeetings.find((m) => m.status === "live");
  const canManageSeries =
    participantRole === "owner" || participantRole === "facilitator";

  const showBrief =
    openIssues.length > 0 ||
    (nextMeeting &&
      new Date(nextMeeting.date).getTime() - Date.now() < 24 * 60 * 60 * 1000);

  const timelineMeetings = React.useMemo(() => {
    return sortedMeetings.map((meeting) => ({
      ...meeting,
      issues: (issues ?? []).filter(
        (iss) => iss.raised_in_meeting_id === meeting.id
      ),
      decisions: (decisions ?? []).filter(
        (dec) => dec.meeting_id === meeting.id
      ),
    }));
  }, [sortedMeetings, issues, decisions]);

  async function handleStartMeeting() {
    if (!series) return;
    setStartingMeeting(true);
    try {
      const meeting = await startOrJoinMeeting.mutateAsync(seriesId);
      router.push(`/series/${seriesId}/meetings/${meeting.id}`);
    } finally {
      setStartingMeeting(false);
    }
  }

  if (seriesLoading) {
    return (
      <div className="min-h-full bg-paper">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
          <Skeleton className="h-6 w-32 mb-6" />
          <Skeleton className="h-8 w-64 mb-4" />
          <Skeleton className="h-4 w-48 mb-8" />
          <Skeleton className="h-24 w-full mb-4" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (!series) {
    return (
      <div className="min-h-full bg-paper flex items-center justify-center">
        <p className="text-sm text-ink-3">Series not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-paper">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-start gap-3">
            <Link
              href="/series"
              className="text-ink-3 hover:text-ink transition-colors mt-1"
            >
              <ArrowLeft className="size-5" />
            </Link>
            <div className="flex-1 min-w-0">
              <h1 className="font-display text-2xl font-semibold text-ink truncate">
                {series.name}
              </h1>
              {series.description && (
                <p className="text-sm text-ink-2 mt-1 hidden sm:block">{series.description}</p>
              )}
            </div>
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <ShareButton resource_type="series" resource_id={seriesId} />
              {canManageSeries && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setImportOpen(true)}
                    aria-label="Import CSV"
                    className="hidden sm:inline-flex"
                  >
                    <Upload className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSettingsOpen(true)}
                    aria-label="Series settings"
                  >
                    <Settings className="size-4" />
                  </Button>
                </>
              )}
              <Button
                onClick={handleStartMeeting}
                disabled={startingMeeting}
                className="bg-accent text-white hover:bg-accent-hover"
                size="sm"
              >
                {startingMeeting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" data-icon="inline-start" />
                )}
                <span className="hidden sm:inline">
                  {liveMeeting ? "Join live meeting" : "Start meeting"}
                </span>
                <span className="sm:hidden">{liveMeeting ? "Join" : "Start"}</span>
              </Button>
            </div>
          </div>
          {series.description && (
            <p className="text-sm text-ink-2 mt-2 sm:hidden pl-8">{series.description}</p>
          )}
        </div>

        {/* Pre-Meeting Brief */}
        {showBrief && (
          <div className="mb-8">
            <BriefCard
              seriesName={series.name}
              nextMeetingDate={nextMeeting ? new Date(nextMeeting.date) : undefined}
              pendingIssues={openIssues.slice(0, 5)}
              attendees={series.default_attendees ?? []}
            />
          </div>
        )}

        {/* Meeting history timeline */}
        <section className="mb-8">
          <h2 className="font-display text-lg font-medium text-ink mb-4">
            Timeline
          </h2>

          {sortedMeetings.length === 0 && (
            <EmptyState variant="no-meetings" />
          )}

          {timelineMeetings.length > 0 && (
            <DateAnchoredTimeline
              meetings={timelineMeetings}
              seriesId={seriesId}
            />
          )}
        </section>

        {/* Open issues */}
        {openIssues.length > 0 && (
          <section>
            <h2 className="font-display text-lg font-medium text-ink mb-4">
              Open issues ({openIssues.length})
            </h2>
            <div className="space-y-3">
              {openIssues.map((issue) => (
                <IssueCard key={issue.id} issue={issue} />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Settings dialog */}
      <SeriesSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        series={series}
      />

      {/* CSV import dialog */}
      {sortedMeetings[0] && (
        <CsvImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          seriesId={seriesId}
          meetingId={sortedMeetings[0].id}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Series settings dialog (inline, keeps the file self-contained)
// ---------------------------------------------------------------------------

function SeriesSettingsDialog({
  open,
  onOpenChange,
  series,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  series: { id: string; name: string; description: string | null; cadence: Cadence; default_attendees: string[]; gcal_calendar_id: string | null; gcal_sync_enabled: boolean };
}) {
  const updateSeries = useUpdateSeries();
  const { data: gcalStatus } = useGoogleCalendarStatus();
  const { data: calendarList } = useCalendarList();
  const linkCalendar = useLinkCalendar();
  const unlinkCalendar = useUnlinkCalendar();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateSeriesInput>({
    resolver: zodResolver(createSeriesSchema as any),
    values: {
      name: series.name,
      description: series.description ?? "",
      cadence: series.cadence,
      default_attendees: series.default_attendees ?? [],
    },
  });

  const selectedCadence = watch("cadence");

  async function onSubmit(data: CreateSeriesInput) {
    await updateSeries.mutateAsync({ id: series.id, ...data });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Series settings</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" {...register("name")} aria-invalid={!!errors.name} />
            {errors.name && (
              <p className="text-xs text-danger">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-description">Description</Label>
            <Textarea
              id="edit-description"
              {...register("description")}
              className="min-h-[60px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Cadence</Label>
            <div className="flex flex-wrap gap-1.5" role="radiogroup">
              {CADENCES.map((cadence) => (
                <button
                  key={cadence}
                  type="button"
                  role="radio"
                  aria-checked={selectedCadence === cadence}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    selectedCadence === cadence
                      ? "bg-ink text-paper"
                      : "bg-paper-2 text-ink-3 hover:text-ink-2 hover:bg-paper-3"
                  )}
                  onClick={() => setValue("cadence", cadence)}
                >
                  <MinutiaCadenceIcon cadence={cadence} className="size-3 text-current" />
                  {cadenceLabels[cadence]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-attendees">Default attendees</Label>
            <Input
              id="edit-attendees"
              defaultValue={(series.default_attendees ?? []).join(", ")}
              onChange={(e) => {
                const attendees = e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
                setValue("default_attendees", attendees);
              }}
            />
            <p className="text-[10px] text-ink-4">Comma-separated emails</p>
          </div>

          {/* Google Calendar */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Calendar className="size-3.5" />
              Google Calendar
            </Label>
            {!gcalStatus?.connected ? (
              <p className="text-xs text-ink-3">
                <a href="/settings" className="text-accent hover:underline">Connect Google Calendar</a> in Settings to link a calendar to this series.
              </p>
            ) : series.gcal_calendar_id && series.gcal_sync_enabled ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-2 truncate flex-1">
                  {calendarList?.find((c) => c.id === series.gcal_calendar_id)?.summary ?? series.gcal_calendar_id}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => unlinkCalendar.mutate(series.id)}
                  disabled={unlinkCalendar.isPending}
                >
                  <X className="size-3.5" />
                  Unlink
                </Button>
              </div>
            ) : (
              <select
                className="w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    linkCalendar.mutate({ seriesId: series.id, calendarId: e.target.value });
                  }
                }}
              >
                <option value="" disabled>Select a calendar</option>
                {(calendarList ?? []).map((cal) => (
                  <option key={cal.id} value={cal.id}>
                    {cal.summary}{cal.primary ? " (primary)" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          <DialogFooter>
            <Button
              type="submit"
              disabled={updateSeries.isPending}
              className="bg-accent text-white hover:bg-accent-hover"
            >
              {updateSeries.isPending && (
                <Loader2 className="size-3.5 animate-spin" />
              )}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
