"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TranscriptionSegmentRow } from "@/lib/types";

// Rotates through the app's --speaker-* tokens (globals.css): same soft/text
// recipe as --accent/--success/--warn, hues spaced away from those semantic
// colors, so each speaker reads as a distinct, tasteful voice rather than a
// rainbow. Mirrors the bg-X-soft/text-X/ring-X convention used by
// SuggestionContextBadge's STATUS_PALETTE.
const CHIP_BASE =
  "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition-all";

const SPEAKER_PALETTE = [
  "bg-speaker-1-soft text-speaker-1 ring-speaker-1/20",
  "bg-speaker-2-soft text-speaker-2 ring-speaker-2/20",
  "bg-speaker-3-soft text-speaker-3 ring-speaker-3/20",
  "bg-speaker-4-soft text-speaker-4 ring-speaker-4/20",
  "bg-speaker-5-soft text-speaker-5 ring-speaker-5/20",
] as const;

function colorForSpeaker(label: string, order: string[]): string {
  const idx = order.indexOf(label);
  return SPEAKER_PALETTE[(idx < 0 ? 0 : idx) % SPEAKER_PALETTE.length];
}

function fallbackName(label: string): string {
  return `Speaker ${/^[A-Za-z]$/.test(label) ? label.toUpperCase() : label}`;
}

function displayName(label: string, speakerMap?: Record<string, string | null>): string {
  return speakerMap?.[label]?.trim() || fallbackName(label);
}

interface Turn {
  speaker: string;
  text: string;
}

/** Merge consecutive same-speaker segments into one visual turn (read as a conversation, not a segment dump). */
function mergeTurns(segments: TranscriptionSegmentRow[]): Turn[] {
  const turns: Turn[] = [];
  for (const s of segments) {
    const text = s.text.trim();
    if (!text) continue;
    const last = turns[turns.length - 1];
    if (last && last.speaker === s.speaker) {
      last.text += ` ${text}`;
    } else {
      turns.push({ speaker: s.speaker, text });
    }
  }
  return turns;
}

function SpeakerChip({
  label,
  name,
  colorClass,
  onRename,
}: {
  label: string;
  name: string;
  colorClass: string;
  onRename: (name: string | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState(name);
  const inputId = React.useId();

  function commit() {
    const trimmed = value.trim();
    setOpen(false);
    if (trimmed !== name) onRename(trimmed || null);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setValue(name);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            CHIP_BASE,
            "group hover:brightness-95 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            colorClass
          )}
          aria-label={`Rename ${fallbackName(label)}, currently ${name}`}
        >
          {name}
          <Pencil
            className="size-2.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56">
        <label htmlFor={inputId} className="text-xs font-medium text-ink-2">
          Name for {fallbackName(label)}
        </label>
        <Input
          id={inputId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
          }}
          placeholder={fallbackName(label)}
          autoFocus
        />
        <div className="flex justify-end gap-1.5">
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={commit}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DiarizedTranscript({
  segments,
  speakerMap,
  canEdit,
  onRenameSpeaker,
}: {
  segments: TranscriptionSegmentRow[];
  speakerMap?: Record<string, string | null>;
  canEdit: boolean;
  onRenameSpeaker?: (label: string, name: string | null) => void;
}) {
  const order = React.useMemo(() => [...new Set(segments.map((s) => s.speaker))], [segments]);
  const turns = React.useMemo(() => mergeTurns(segments), [segments]);

  return (
    <ol className="animate-in fade-in space-y-2.5 duration-300">
      {turns.map((turn, i) => {
        const colorClass = colorForSpeaker(turn.speaker, order);
        const name = displayName(turn.speaker, speakerMap);
        return (
          <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
            {canEdit && onRenameSpeaker ? (
              <SpeakerChip
                label={turn.speaker}
                name={name}
                colorClass={colorClass}
                onRename={(next) => onRenameSpeaker(turn.speaker, next)}
              />
            ) : (
              <span className={cn(CHIP_BASE, colorClass)}>{name}</span>
            )}
            <span className="mt-0.5 text-ink-2">{turn.text}</span>
          </li>
        );
      })}
    </ol>
  );
}
