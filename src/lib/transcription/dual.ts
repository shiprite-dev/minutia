import { transcribeAudio } from "@/lib/transcription";
import { channelSegmentOutcome, mergeChannels } from "./channels";
import { flattenSegments } from "./diarization";

/** Transcribe a segment's me/them channel files in parallel with timestamps and merge them. */
export async function transcribeDualSegment({
  meAudio,
  themAudio,
  offsetSeconds,
  fileName,
  mimeType,
  deadlineAt,
}: {
  meAudio: Blob;
  themAudio: Blob | null;
  offsetSeconds: number;
  fileName: string;
  mimeType: string;
  deadlineAt: number;
}) {
  const run = (audio: Blob) =>
    transcribeAudio(audio, { fileName, mimeType, preferFast: true, timestamps: true, deadlineAt });
  const [me, them] = await Promise.all([run(meAudio), themAudio ? run(themAudio) : null]);
  const merged = mergeChannels({ me, them, offsetSeconds });
  return {
    merged,
    transcriptText: flattenSegments(merged, {}),
    outcome: channelSegmentOutcome(merged, [me, them]),
    model: me.model,
    provider: me.provider,
    durationSeconds: me.durationSeconds,
  };
}
