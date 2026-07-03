// ---------------------------------------------------------------------------
// WebM segment cutting for the fast recap lane.
//
// A single continuous MediaRecorder produces one growing WebM stream. To start
// transcribing before the meeting ends, we carve independently-decodable
// segment files at Cluster boundaries (`0x1F43B675`) while recording: the init
// segment (bytes before the first Cluster) is prepended to a run of whole
// Clusters, and the still-growing trailing Cluster is never cut. Reuses
// `findWebmClusterOffsets` so the container heuristic lives in one place.
// ---------------------------------------------------------------------------

import { findWebmClusterOffsets } from "@/lib/transcription/chunk";

/** Cut a segment once ~4MB of whole Clusters have accumulated. */
export const SEGMENT_TARGET_BYTES = 4 * 1024 * 1024;

/** Force a cut at most every 5 minutes even if the target is not reached. */
export const SEGMENT_MAX_MS = 5 * 60_000;

/** Never cut a segment smaller than this; tiny files waste provider calls. */
export const SEGMENT_MIN_BYTES = 256 * 1024;

/** True iff the mime type is a WebM audio container we can segment. */
export function isSegmentableMime(mime: string): boolean {
  return mime.trim().toLowerCase().startsWith("audio/webm");
}

/** Split off the init segment (bytes before the first Cluster). Null until one exists. */
export function splitInitSegment(bytes: Uint8Array): { init: Uint8Array; rest: Uint8Array } | null {
  const offsets = findWebmClusterOffsets(bytes);
  if (offsets.length === 0) return null;
  const first = offsets[0];
  return { init: bytes.subarray(0, first), rest: bytes.subarray(first) };
}

/** Split into whole Clusters (head) and the trailing still-growing Cluster (tail). */
export function cutAtLastClusterStart(bytes: Uint8Array): { head: Uint8Array; tail: Uint8Array } {
  const offsets = findWebmClusterOffsets(bytes);
  if (offsets.length < 2) return { head: bytes.subarray(0, 0), tail: bytes };
  const last = offsets[offsets.length - 1];
  return { head: bytes.subarray(0, last), tail: bytes.subarray(last) };
}

/** Concatenate an init segment and a run of Clusters into one WebM file. */
export function buildSegmentFile(init: Uint8Array, clusters: Uint8Array): Uint8Array {
  const out = new Uint8Array(init.length + clusters.length);
  out.set(init, 0);
  out.set(clusters, init.length);
  return out;
}

/** Cut when enough bytes have piled up, capped by the max interval. */
export function shouldCutSegment(pendingBytes: number, msSinceLastCut: number): boolean {
  return (
    pendingBytes >= SEGMENT_MIN_BYTES &&
    (pendingBytes >= SEGMENT_TARGET_BYTES || msSinceLastCut >= SEGMENT_MAX_MS)
  );
}

/** Extensions a segment may use; the web recorder always cuts webm, the desktop companion uploads m4a. */
export const SEGMENT_EXTENSIONS = ["webm", "m4a", "ogg", "mp3", "wav"] as const;
export type SegmentExtension = (typeof SEGMENT_EXTENSIONS)[number];

const SEGMENT_MIME: Record<SegmentExtension, string> = {
  webm: "audio/webm",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

export function segmentMimeForExt(ext: SegmentExtension): string {
  return SEGMENT_MIME[ext];
}

/** Storage path for a meeting segment: `${meetingId}/seg-${seq}.${ext}`. */
export function segmentStoragePath(
  meetingId: string,
  seq: number,
  ext: SegmentExtension = "webm"
): string {
  return `${meetingId}/seg-${seq}.${ext}`;
}

/** Validate a client-supplied segment path against the canonical shape. */
export function parseSegmentPath(
  meetingId: string,
  seq: number,
  path: unknown
): { ext: SegmentExtension } | null {
  if (typeof path !== "string") return null;
  const ext = SEGMENT_EXTENSIONS.find((e) => path === segmentStoragePath(meetingId, seq, e));
  return ext ? { ext } : null;
}
