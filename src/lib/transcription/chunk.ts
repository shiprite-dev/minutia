// ---------------------------------------------------------------------------
// Audio chunking for long recordings.
//
// Provider APIs cap a single request (Groq Whisper rejects >25MB), but a long
// meeting easily exceeds that (~1MB/min for Opus-in-WebM). We split into pieces
// under the cap and concatenate the transcripts.
//
// WebM is a container: naive byte slices after the first piece are missing the
// EBML init segment and won't decode. So we split at Cluster boundaries
// (`0x1F43B675`) and prepend the header to every piece, making each chunk an
// independently-decodable WebM. Other (streamable/headerless) containers fall
// back to a plain byte window. The cluster scan is a heuristic; a false match
// inside payload is statistically negligible (~1% chance over a 60MB file).
// ---------------------------------------------------------------------------

/** Stay just under Groq's 25MB request ceiling, with headroom for the header. */
export const MAX_TRANSCRIPTION_BYTES = 24 * 1024 * 1024;

/** Top-level WebM Cluster element id. */
const WEBM_CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75];

export function needsChunking(sizeBytes: number, maxBytes = MAX_TRANSCRIPTION_BYTES): boolean {
  return sizeBytes > maxBytes;
}

/** Byte offsets where each WebM Cluster element starts. */
export function findWebmClusterOffsets(bytes: Uint8Array): number[] {
  const offsets: number[] = [];
  const [a, b, c, d] = WEBM_CLUSTER_ID;
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === a && bytes[i + 1] === b && bytes[i + 2] === c && bytes[i + 3] === d) {
      offsets.push(i);
    }
  }
  return offsets;
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Split a WebM buffer into <=maxBytes pieces, each = init segment + one or more
 * whole Clusters. A single oversized cluster is emitted alone (best effort)
 * rather than dropped or looped on.
 */
export function planWebmChunks(
  bytes: Uint8Array<ArrayBuffer>,
  maxBytes = MAX_TRANSCRIPTION_BYTES
): Uint8Array<ArrayBuffer>[] {
  const offsets = findWebmClusterOffsets(bytes);
  if (offsets.length === 0) return [bytes]; // no clusters found -> cannot split safely

  const header = bytes.subarray(0, offsets[0]);
  const ranges = offsets.map((start, i) => ({
    start,
    end: i + 1 < offsets.length ? offsets[i + 1] : bytes.length,
  }));

  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let current: Uint8Array[] = [];
  let size = header.length;

  for (const { start, end } of ranges) {
    const cluster = bytes.subarray(start, end);
    if (current.length > 0 && size + cluster.length > maxBytes) {
      chunks.push(concat([header, ...current]));
      current = [];
      size = header.length;
    }
    current.push(cluster);
    size += cluster.length;
  }
  if (current.length > 0) chunks.push(concat([header, ...current]));
  return chunks;
}

/**
 * Split a recording blob into provider-sized chunks, preserving order. Returns
 * the original blob untouched when it already fits under the cap.
 */
export async function chunkAudioBlob(
  blob: Blob,
  mimeType: string,
  maxBytes = MAX_TRANSCRIPTION_BYTES
): Promise<Blob[]> {
  if (blob.size <= maxBytes) return [blob];

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const base = mimeType.split(";")[0].trim();

  if (base === "audio/webm") {
    return planWebmChunks(bytes, maxBytes).map((part) => new Blob([part], { type: mimeType }));
  }

  const chunks: Blob[] = [];
  for (let offset = 0; offset < bytes.length; offset += maxBytes) {
    chunks.push(new Blob([bytes.subarray(offset, offset + maxBytes)], { type: mimeType }));
  }
  return chunks;
}
