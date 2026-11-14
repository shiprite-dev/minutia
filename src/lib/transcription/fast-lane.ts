// ---------------------------------------------------------------------------
// Pure fast-lane transcript assembly + segment resume planner.
//
// The fast lane transcribes short WebM segments as a meeting records, persisting
// each to meeting_audio_segments. This module turns those per-segment rows into
// (1) a single flowing transcript for the streamed recap, and (2) a resume plan
// for the final pass so a provider hiccup on one segment never loses the meeting.
// No env, no Supabase, no React; deterministic over its inputs so it unit-tests
// in isolation.
// ---------------------------------------------------------------------------

import type { TranscriptionSegment } from "./shared";

export interface SegmentRow {
  seq: number;
  status: string;
  transcript_text: string | null;
  storage_path: string;
  model?: string | null;
  provider?: string | null;
  /** Persisted terminal outcome ("speech" | "no_speech"); null/absent on
   * legacy rows written before outcomes existed. */
  transcription_outcome?: string | null;
  them_storage_path?: string | null;
  offset_seconds?: number | null;
  transcript_segments?: TranscriptionSegment[] | null;
  recorded_by?: string | null;
}

/** A row is usable transcript when it completed AND carries non-empty trimmed text. */
function hasUsableText(row: SegmentRow): boolean {
  return row.status === "completed" && (row.transcript_text?.trim() ?? "") !== "";
}

/** A completed row with a persisted no_speech outcome is terminal silence:
 * it counts toward coverage and must never be retried. Legacy completed-empty
 * rows without the outcome stay retryable (their emptiness is unexplained). */
export function isTerminalNoSpeech(row: SegmentRow): boolean {
  return (
    row.status === "completed" &&
    (row.transcript_text?.trim() ?? "") === "" &&
    row.transcription_outcome === "no_speech"
  );
}

/**
 * Join every completed, non-empty segment (ascending by seq) into one transcript,
 * texts trimmed and separated by a blank line. Returns "" when nothing is usable.
 * Does not mutate the input array.
 */
export function assembleFastTranscript(rows: SegmentRow[]): string {
  return [...rows]
    .filter(hasUsableText)
    .sort((a, b) => a.seq - b.seq)
    .map((row) => (row.transcript_text as string).trim())
    .join("\n\n");
}

/**
 * Partition segment rows for the resumable final pass. `completed` holds rows
 * with real text plus confirmed-terminal silence rows; `retry` holds every other
 * row (uploaded, failed, processing, or completed-with-unexplained-empty-text)
 * sorted by seq. `processing` counts as retry because resume runs only after
 * atomically claiming the whole meeting, so a lingering processing segment is a
 * crashed run. `usable` is true whenever any rows exist.
 */
export function planSegmentResume(rows: SegmentRow[]): {
  retry: SegmentRow[];
  completed: SegmentRow[];
  usable: boolean;
} {
  const bySeq = (a: SegmentRow, b: SegmentRow) => a.seq - b.seq;
  const completed = rows.filter((row) => hasUsableText(row) || isTerminalNoSpeech(row)).sort(bySeq);
  const retry = rows.filter((row) => !hasUsableText(row) && !isTerminalNoSpeech(row)).sort(bySeq);
  const usable = rows.length > 0 && completed.length + retry.length > 0;
  return { retry, completed, usable };
}

/**
 * True only when the persisted segment rows exactly cover the segment count the
 * client reported at stop (`expected`): the row count matches AND the seqs are
 * exactly the contiguous range 0..expected-1. Guards the resume path against a
 * tail segment that has not registered its row yet, a hole, or a duplicate seq.
 * Returns false when `expected` is null (legacy callers) so those fall back to
 * the safe full-file path.
 */
export function segmentsCoverExpected(rows: SegmentRow[], expected: number | null): boolean {
  if (expected === null || rows.length !== expected) return false;
  const seqs = rows.map((row) => row.seq).sort((a, b) => a - b);
  return seqs.every((seq, index) => seq === index);
}
