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

export interface SegmentRow {
  seq: number;
  status: string;
  transcript_text: string | null;
  storage_path: string;
}

/** A row is usable transcript when it completed AND carries non-empty trimmed text. */
function hasUsableText(row: SegmentRow): boolean {
  return row.status === "completed" && (row.transcript_text?.trim() ?? "") !== "";
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
 * Partition segment rows for the resumable final pass. `completed` holds rows with
 * real text; `retry` holds every other row (uploaded, failed, processing, or
 * completed-with-empty-text) sorted by seq. `processing` counts as retry because
 * resume runs only after atomically claiming the whole meeting, so a lingering
 * processing segment is a crashed run. `usable` is true whenever any rows exist.
 */
export function planSegmentResume(rows: SegmentRow[]): {
  retry: SegmentRow[];
  completed: SegmentRow[];
  usable: boolean;
} {
  const bySeq = (a: SegmentRow, b: SegmentRow) => a.seq - b.seq;
  const completed = rows.filter(hasUsableText).sort(bySeq);
  const retry = rows.filter((row) => !hasUsableText(row)).sort(bySeq);
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
