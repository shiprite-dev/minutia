"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Radio,
  Users,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MinutiaMeetingStatusIcon } from "@/components/minutia/minutia-icons";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/lib/stores/ui-store";
import { useMeetingsByMonth } from "@/lib/hooks/use-meetings";
import type { MeetingWithSeries } from "@/lib/hooks/use-meetings";
import {
  useCalendarAgenda,
  useGoogleCalendarStatus,
  useStartCalendarAgendaEvent,
} from "@/lib/hooks/use-google-calendar";
import type { GoogleCalendarAgendaItem } from "@/lib/types";

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getMonthGrid(year: number, month: number): (number | null)[][] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = new Array(firstDay).fill(null);

  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  return weeks;
}

function MiniCalendar({
  year,
  month,
  selectedDate,
  meetingDays,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
}: {
  year: number;
  month: number;
  selectedDate: Date;
  meetingDays: Set<number>;
  onSelectDate: (date: Date) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const today = new Date();
  const weeks = getMonthGrid(year, month);

  return (
    <div className="px-4 pt-4 pb-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink">
          {MONTHS[month]} {year}
        </h3>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onPrevMonth}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onNextMonth}
            aria-label="Next month"
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0">
        {DAYS.map((d) => (
          <div
            key={d}
            className="text-center text-[10px] font-medium text-ink-4 pb-1.5"
          >
            {d}
          </div>
        ))}
        {weeks.flat().map((day, i) => {
          if (day === null) {
            return <div key={`empty-${i}`} className="h-8" />;
          }

          const date = new Date(year, month, day);
          const isToday = isSameDay(date, today);
          const isSelected = isSameDay(date, selectedDate);
          const hasMeeting = meetingDays.has(day);

          return (
            <button
              key={day}
              onClick={() => onSelectDate(date)}
              className={cn(
                "relative h-8 w-full rounded-md text-xs font-medium transition-colors",
                "hover:bg-paper-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                isSelected && "bg-accent text-white hover:bg-accent-hover",
                isToday && !isSelected && "text-accent font-bold",
                !isToday && !isSelected && "text-ink-2"
              )}
            >
              {day}
              {hasMeeting && !isSelected && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 size-1 rounded-full bg-accent" />
              )}
              {hasMeeting && isSelected && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 size-1 rounded-full bg-white" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayAgenda({
  date,
  meetings,
  calendarEvents,
  calendarConnected,
  agendaLoading,
  onOpenCalendarEvent,
}: {
  date: Date;
  meetings: MeetingWithSeries[];
  calendarEvents: GoogleCalendarAgendaItem[];
  calendarConnected: boolean;
  agendaLoading: boolean;
  onOpenCalendarEvent: (event: GoogleCalendarAgendaItem) => void;
}) {
  const dayMeetings = meetings.filter((m) =>
    isSameDay(new Date(m.date), date)
  );
  const dayCalendarEvents = calendarEvents.filter((event) =>
    isSameDay(new Date(event.startAt), date)
  );

  const formattedDate = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const hasCalendarEvents = calendarConnected && dayCalendarEvents.length > 0;

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4">
      <p className="text-[11px] font-mono uppercase tracking-wider text-ink-4 mb-3">
        {formattedDate}
      </p>

      {calendarConnected && agendaLoading ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Calendar className="size-8 text-ink-4/50 mb-2" />
          <p className="text-sm text-ink-3">Syncing agenda...</p>
        </div>
      ) : hasCalendarEvents ? (
        <div className="space-y-1.5">
          {dayCalendarEvents.map((event) => {
            const time = new Date(event.startAt);
            const timeStr = time.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            });

            return (
              <button
                key={event.id}
                type="button"
                onClick={() => onOpenCalendarEvent(event)}
                className="block w-full text-left group"
              >
                <div className="flex items-start gap-3 rounded-lg p-2.5 transition-colors hover:bg-paper-3 group-focus-visible:ring-1 group-focus-visible:ring-accent">
                  <div className="flex-shrink-0 pt-0.5">
                    <span className="text-[11px] font-mono text-ink-3 tabular-nums">
                      {timeStr}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate leading-tight">
                      {event.title}
                    </p>
                    <p className="text-xs text-ink-3 mt-0.5 truncate">
                      {event.attendeeEmails.length} attendees
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                          event.meetingStatus === "live"
                            ? "bg-accent-soft text-accent"
                            : "bg-paper-3 text-ink-3"
                        )}
                      >
                        {event.meetingStatus === "live" && (
                          <span className="size-1.5 rounded-full bg-accent animate-pulse" />
                        )}
                        {event.seriesKind === "recurring" ? "Recurring" : "Ad hoc"}
                      </span>
                      {event.meetingUrl && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-paper-3 text-ink-3 font-medium">
                          <Video className="size-2.5" />
                          Meet
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : calendarConnected ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Calendar className="size-8 text-ink-4/50 mb-2" />
          <p className="text-sm text-ink-3">No calendar meetings</p>
        </div>
      ) : dayMeetings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Calendar className="size-8 text-ink-4/50 mb-2" />
          <p className="text-sm text-ink-3">No meetings</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {dayMeetings.map((meeting) => {
            const time = new Date(meeting.date);
            const timeStr = time.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            });

            return (
              <Link
                key={meeting.id}
                href={`/series/${meeting.series_id}/meetings/${meeting.id}`}
                className="block group"
              >
                <div className="flex items-start gap-3 rounded-lg p-2.5 transition-colors hover:bg-paper-3 group-focus-visible:ring-1 group-focus-visible:ring-accent">
                  <div className="flex-shrink-0 pt-0.5">
                    <span className="text-[11px] font-mono text-ink-3 tabular-nums">
                      {timeStr}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate leading-tight">
                      {meeting.title}
                    </p>
                    <p className="text-xs text-ink-3 mt-0.5 truncate">
                      {meeting.series_name}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                          meeting.status === "completed" && "bg-success-soft text-success",
                          meeting.status === "live" && "bg-accent-soft text-accent",
                          meeting.status === "upcoming" && "bg-paper-3 text-ink-3"
                        )}
                      >
                        <MinutiaMeetingStatusIcon status={meeting.status} className="size-3 text-ink" />
                        {meeting.status}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CalendarContent({
  viewYear,
  viewMonth,
  selectedDate,
  meetingDays,
  meetings,
  calendarEvents,
  calendarConnected,
  agendaLoading,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
  onOpenCalendarEvent,
}: {
  viewYear: number;
  viewMonth: number;
  selectedDate: Date;
  meetingDays: Set<number>;
  meetings: MeetingWithSeries[];
  calendarEvents: GoogleCalendarAgendaItem[];
  calendarConnected: boolean;
  agendaLoading: boolean;
  onSelectDate: (date: Date) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onOpenCalendarEvent: (event: GoogleCalendarAgendaItem) => void;
}) {
  return (
    <>
      <MiniCalendar
        year={viewYear}
        month={viewMonth}
        selectedDate={selectedDate}
        meetingDays={meetingDays}
        onSelectDate={onSelectDate}
        onPrevMonth={onPrevMonth}
        onNextMonth={onNextMonth}
      />
      <div className="border-t border-rule" />
      <DayAgenda
        date={selectedDate}
        meetings={meetings}
        calendarEvents={calendarEvents}
        calendarConnected={calendarConnected}
        agendaLoading={agendaLoading}
        onOpenCalendarEvent={onOpenCalendarEvent}
      />
    </>
  );
}

function formatEventRange(event: GoogleCalendarAgendaItem) {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const date = start.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const startTime = start.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const endTime = end.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date}, ${startTime} to ${endTime}`;
}

function CalendarEventDetail({
  event,
  isStarting,
  onBack,
  onStart,
}: {
  event: GoogleCalendarAgendaItem;
  isStarting: boolean;
  onBack: () => void;
  onStart: (event: GoogleCalendarAgendaItem) => void;
}) {
  const isLive = event.meetingStatus === "live";

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-4 pb-4 pt-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mb-3 w-fit px-0 text-ink-3 hover:text-ink"
        onClick={onBack}
      >
        <ArrowLeft className="size-3.5" />
        Agenda
      </Button>

      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-paper-3 px-2 py-1 text-[10px] font-medium text-ink-3">
              {event.seriesKind === "recurring" ? "Recurring series" : "Ad hoc series"}
            </span>
            {isLive && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-1 text-[10px] font-medium text-accent">
                <Radio className="size-3" />
                Meeting in progress
              </span>
            )}
          </div>
          <h3 className="font-display text-lg font-medium leading-tight text-ink">
            {event.title}
          </h3>
          {event.description && (
            <p className="text-sm leading-relaxed text-ink-3 line-clamp-4">
              {event.description}
            </p>
          )}
        </div>

        <div className="space-y-2 text-sm text-ink-2">
          <div className="flex items-start gap-2">
            <Clock className="mt-0.5 size-4 text-ink-4" />
            <span>{formatEventRange(event)}</span>
          </div>
          <div className="flex items-start gap-2">
            <Users className="mt-0.5 size-4 text-ink-4" />
            <span>
              {event.attendeeEmails.length > 0
                ? event.attendeeEmails.slice(0, 4).join(", ")
                : "No attendees listed"}
              {event.attendeeEmails.length > 4 ? ` +${event.attendeeEmails.length - 4}` : ""}
            </span>
          </div>
          {event.meetingUrl && (
            <div className="flex items-start gap-2">
              <Video className="mt-0.5 size-4 text-ink-4" />
              <span className="min-w-0">
                <span className="block">Google Meet link available</span>
                <a
                  href={event.meetingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 block break-all text-xs text-accent hover:underline"
                >
                  {event.meetingUrl}
                </a>
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            className="bg-accent text-white hover:bg-accent-hover"
            disabled={!isLive && isStarting}
            onClick={() => onStart(event)}
          >
            {isLive ? "Join now" : "Start meeting"}
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/series/${event.seriesId}`}>
              Open series
              <ExternalLink className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

export function CalendarSidebar() {
  const router = useRouter();
  const {
    calendarSidebarOpen,
    toggleCalendarSidebar,
    setCalendarSidebarOpen,
    selectedDate,
    setSelectedDate,
  } = useUIStore();

  const isMobile = useIsMobile();
  const [viewYear, setViewYear] = React.useState(selectedDate.getFullYear());
  const [viewMonth, setViewMonth] = React.useState(selectedDate.getMonth());
  const [selectedCalendarEvent, setSelectedCalendarEvent] =
    React.useState<GoogleCalendarAgendaItem | null>(null);
  const { data: calendarStatus } = useGoogleCalendarStatus(calendarSidebarOpen);
  const { data: agendaData, isLoading: agendaLoading } =
    useCalendarAgenda(calendarSidebarOpen);
  const startCalendarEvent = useStartCalendarAgendaEvent();

  // Hydrate persisted sidebar state from localStorage after mount
  React.useEffect(() => {
    const saved = localStorage.getItem("minutia:calendar-sidebar");
    if (saved === "true") setCalendarSidebarOpen(true);
  }, [setCalendarSidebarOpen]);

  const { data: meetings = [] } = useMeetingsByMonth(
    viewYear,
    viewMonth,
    calendarSidebarOpen
  );
  const calendarEvents = React.useMemo(() => agendaData?.events ?? [], [agendaData?.events]);
  const calendarConnected = !!calendarStatus?.connected;

  const meetingDays = React.useMemo(() => {
    const days = new Set<number>();
    const sourceDates = calendarConnected
      ? calendarEvents.map((event) => event.startAt)
      : meetings.map((meeting) => meeting.date);
    for (const sourceDate of sourceDates) {
      const d = new Date(sourceDate);
      if (d.getMonth() === viewMonth && d.getFullYear() === viewYear) {
        days.add(d.getDate());
      }
    }
    return days;
  }, [calendarConnected, calendarEvents, meetings, viewMonth, viewYear]);

  function handlePrevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }

  function handleNextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }

  function handleSelectDate(date: Date) {
    setSelectedCalendarEvent(null);
    setSelectedDate(date);
    if (date.getMonth() !== viewMonth || date.getFullYear() !== viewYear) {
      setViewMonth(date.getMonth());
      setViewYear(date.getFullYear());
    }
  }

  function handleStartCalendarEvent(event: GoogleCalendarAgendaItem) {
    if (event.meetingUrl) {
      window.open(event.meetingUrl, "_blank", "noopener,noreferrer");
    }
    if (event.meetingStatus === "live") {
      router.push(`/series/${event.seriesId}/meetings/${event.meetingId}`);
      return;
    }
    startCalendarEvent.mutate(event.id, {
      onSuccess: (result) => router.push(result.captureUrl),
    });
  }

  const selectedCalendarEventForDetail = React.useMemo(() => {
    if (!selectedCalendarEvent) return null;

    const currentEvent =
      calendarEvents.find((event) => event.id === selectedCalendarEvent.id) ??
      selectedCalendarEvent;
    const linkedMeeting = meetings.find(
      (meeting) => meeting.id === currentEvent.meetingId
    );

    if (!linkedMeeting || linkedMeeting.status === currentEvent.meetingStatus) {
      return currentEvent;
    }

    return {
      ...currentEvent,
      meetingStatus: linkedMeeting.status,
    };
  }, [calendarEvents, meetings, selectedCalendarEvent]);

  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "." && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        toggleCalendarSidebar();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleCalendarSidebar]);

  const sharedProps = {
    viewYear,
    viewMonth,
    selectedDate,
    meetingDays,
    meetings,
    calendarEvents,
    calendarConnected,
    agendaLoading,
    onSelectDate: handleSelectDate,
    onPrevMonth: handlePrevMonth,
    onNextMonth: handleNextMonth,
    onOpenCalendarEvent: setSelectedCalendarEvent,
  };

  const content = selectedCalendarEventForDetail ? (
    <CalendarEventDetail
      event={selectedCalendarEventForDetail}
      isStarting={startCalendarEvent.isPending}
      onBack={() => setSelectedCalendarEvent(null)}
      onStart={handleStartCalendarEvent}
    />
  ) : (
    <CalendarContent {...sharedProps} />
  );

  return (
    <>
      {/* Desktop: inline sidebar panel */}
      <AnimatePresence>
        {calendarSidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="hidden md:flex flex-col border-l border-rule bg-paper overflow-hidden flex-shrink-0"
            aria-label="Calendar sidebar"
          >
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-rule px-4">
              <Calendar className="size-4 text-accent" />
              <h2 className="text-sm font-semibold text-ink">Calendar</h2>
            </div>

            {content}
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Mobile: bottom sheet */}
      <Sheet
        open={isMobile && calendarSidebarOpen}
        onOpenChange={setCalendarSidebarOpen}
      >
        <SheetContent side="bottom" className="max-h-[85vh]">
          <SheetHeader className="pb-0">
            <SheetTitle className="flex items-center gap-2">
              <Calendar className="size-4 text-accent" />
              Calendar
            </SheetTitle>
            <SheetDescription className="sr-only">
              View your meeting calendar
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col overflow-y-auto">
            {content}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
