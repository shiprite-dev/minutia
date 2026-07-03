import { resolveSpeakerMap, flattenSegments } from "./diarization";
import type { TranscriptionSegment } from "./shared";

export interface DiarizedAssembly {
  segments: TranscriptionSegment[];
  speakerMap: Record<string, string | null>;
  transcriptRaw: string;
  transcriptDiarized: boolean;
}

/** Resolve speakers to attendees and produce the attributed transcript_raw. */
export function assembleDiarizedTranscript(
  segments: TranscriptionSegment[],
  attendees: string[],
  priorMap?: Record<string, string | null>
): DiarizedAssembly {
  const { map } = resolveSpeakerMap(segments, attendees, priorMap);
  return {
    segments,
    speakerMap: map,
    transcriptRaw: flattenSegments(segments, map),
    transcriptDiarized: segments.length > 0,
  };
}
