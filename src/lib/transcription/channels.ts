import { flattenSegments } from "./diarization";
import type { DiarizedAssembly } from "./assemble";
import type { TranscriptionSegment } from "./shared";

export interface TimedText {
  start: number;
  end: number;
  text: string;
}

export interface ChannelInput {
  text: string;
  durationSeconds: number | null;
  timed?: TimedText[];
  outcome?: "speech" | "no_speech";
}

const ECHO_TOLERANCE_SECONDS = 1.5;
const ECHO_WORD_SHARE = 0.6;

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}']+/u)
      .filter(Boolean),
  );
}

/** A mic segment is echo when it overlaps a system segment in time and most of its words appear there. */
export function isEcho(me: TimedText, them: TimedText): boolean {
  const overlaps =
    me.start <= them.end + ECHO_TOLERANCE_SECONDS &&
    me.end >= them.start - ECHO_TOLERANCE_SECONDS;
  if (!overlaps) return false;
  const mine = [...words(me.text)];
  if (mine.length === 0) return false;
  const theirs = words(them.text);
  return (
    mine.filter((w) => theirs.has(w)).length / mine.length >= ECHO_WORD_SHARE
  );
}

/** Untimed channels degrade to one block spanning the whole segment window. */
function channelTimed(input: ChannelInput): TimedText[] {
  return (
    input.timed ?? [
      { start: 0, end: input.durationSeconds ?? 0, text: input.text },
    ]
  );
}

/** Interleave me/them by start time at absolute offsets; echo suppression only when both channels are timed. */
export function mergeChannels({
  me,
  them,
  offsetSeconds,
}: {
  me: ChannelInput | null;
  them: ChannelInput | null;
  offsetSeconds: number;
}): TranscriptionSegment[] {
  const themTimed = them ? channelTimed(them) : [];
  const meTimed = me ? channelTimed(me) : [];
  const keptMe =
    me?.timed && them?.timed
      ? meTimed.filter((m) => !themTimed.some((t) => isEcho(m, t)))
      : meTimed;
  const label = (speaker: "me" | "them", list: TimedText[]) =>
    list.map((s) => ({
      speaker,
      start: s.start + offsetSeconds,
      end: s.end + offsetSeconds,
      text: s.text.trim(),
      confidence: null,
    }));
  return [...label("me", keptMe), ...label("them", themTimed)]
    .filter((s) => s.text !== "")
    .sort((a, b) => a.start - b.start);
}

/** Speech when anything merged; no_speech only when every present channel confirmed silence. */
export function channelSegmentOutcome(
  merged: TranscriptionSegment[],
  inputs: (ChannelInput | null)[],
): "speech" | "no_speech" | null {
  if (merged.length > 0) return "speech";
  const present = inputs.filter((i): i is ChannelInput => i != null);
  return present.length > 0 && present.every((i) => i.outcome === "no_speech")
    ? "no_speech"
    : null;
}

/** me = recorder's name, them = unnamed; a prior human correction wins. */
export function resolveChannelSpeakerMap(
  recorderName: string | null,
  priorMap?: Record<string, string | null> | null,
): { me: string | null; them: string | null } {
  return {
    me: priorMap?.me?.trim() || recorderName?.trim() || null,
    them: priorMap?.them?.trim() || null,
  };
}

export function attributionSource({
  diarizingConfigured,
  rows,
}: {
  diarizingConfigured: boolean;
  rows: { transcript_segments?: TranscriptionSegment[] | null }[];
}): "diarizer" | "channels" | "text" {
  if (diarizingConfigured) return "diarizer";
  return rows.length > 0 &&
    rows.every((r) => Array.isArray(r.transcript_segments))
    ? "channels"
    : "text";
}

export function assembleChannelTranscript(
  rows: { seq: number; transcript_segments?: TranscriptionSegment[] | null }[],
  recorderName: string | null,
  priorMap?: Record<string, string | null> | null,
): DiarizedAssembly {
  const segments = [...rows]
    .sort((a, b) => a.seq - b.seq)
    .flatMap((r) => r.transcript_segments ?? []);
  const speakerMap = resolveChannelSpeakerMap(recorderName, priorMap);
  return {
    segments,
    speakerMap,
    transcriptRaw: flattenSegments(segments, speakerMap),
    transcriptDiarized: segments.length > 0,
  };
}
