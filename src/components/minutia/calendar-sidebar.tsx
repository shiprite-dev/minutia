"use client";

import * as React from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
}: {
  date: Date;
  meetings: MeetingWithSeries[];
}) {
  const dayMeetings = meetings.filter((m) =>
    isSameDay(new Date(m.date), date)
  );

  const formattedDate = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4">
      <p className="text-[11px] font-mono uppercase tracking-wider text-ink-4 mb-3">
        {formattedDate}
      </p>

      {dayMeetings.length === 0 ? (
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
                        {meeting.status === "live" && (
                          <span className="size-1.5 rounded-full bg-accent animate-pulse" />
                        )}
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
  onSelectDate,
  onPrevMonth,
  onNextMonth,
}: {
  viewYear: number;
  viewMonth: number;
  selectedDate: Date;
  meetingDays: Set<number>;
  meetings: MeetingWithSeries[];
  onSelectDate: (date: Date) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
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
      <DayAgenda date={selectedDate} meetings={meetings} />
    </>
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

  // Hydrate persisted sidebar state from localStorage after mount
  React.useEffect(() => {
    const saved = localStorage.getItem("minutia:calendar-sidebar");
    if (saved === "true") setCalendarSidebarOpen(true);
  }, [setCalendarSidebarOpen]);

  const { data: meetings = [] } = useMeetingsByMonth(viewYear, viewMonth);

  const meetingDays = React.useMemo(() => {
    const days = new Set<number>();
    for (const m of meetings) {
      const d = new Date(m.date);
      if (d.getMonth() === viewMonth && d.getFullYear() === viewYear) {
        days.add(d.getDate());
      }
    }
    return days;
  }, [meetings, viewMonth, viewYear]);

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
    setSelectedDate(date);
    if (date.getMonth() !== viewMonth || date.getFullYear() !== viewYear) {
      setViewMonth(date.getMonth());
      setViewYear(date.getFullYear());
    }
  }

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
    onSelectDate: handleSelectDate,
    onPrevMonth: handlePrevMonth,
    onNextMonth: handleNextMonth,
  };

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

            <CalendarContent {...sharedProps} />
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
            <CalendarContent {...sharedProps} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
