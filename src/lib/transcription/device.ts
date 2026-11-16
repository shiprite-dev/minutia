import { z } from "zod";
import { flattenSegments } from "./diarization";
import { isEcho, resolveChannelSpeakerMap } from "./channels";
import type { TranscriptionSegment } from "./shared";

export const DEVICE_TRANSCRIPT_MAX_BYTES = 2 * 1024 * 1024;

const MAX_DURATION_SECONDS = 21600;
const MAX_TOTAL_TEXT = 600000;
const END_SLACK_SECONDS = 5;

const label = z.string().max(100);
const time = z.number().finite().min(0);

const deviceTranscriptSchema = z.strictObject({
  schema_version: z.literal(1),
  source: z.strictObject({
    kind: z.literal("device"),
    engine: label,
    engine_version: label,
    model: label,
    model_revision: label,
    app_version: label,
    compute: z.enum(["ane", "gpu", "cpu"]),
  }),
  language: z.string().regex(/^[a-z]{2}$/),
  duration_seconds: z.number().finite().gt(0).max(MAX_DURATION_SECONDS),
  outcome: z.enum(["speech", "no_speech"]),
  segments: z
    .array(
      z.strictObject({
        speaker: z.string().regex(/^(me|them|them-([1-9]|[1-9]\d))$/),
        start: time,
        end: time,
        text: z.string().min(1).max(2000),
        confidence: z.number().min(0).max(1).nullish(),
      }),
    )
    .max(20000),
});

export type DeviceTranscript = z.infer<typeof deviceTranscriptSchema>;

export type DeviceTranscriptParse =
  { ok: true; value: DeviceTranscript } | { ok: false; fields: string[] };

function cleanText(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseDeviceTranscript(body: unknown): DeviceTranscriptParse {
  const result = deviceTranscriptSchema.safeParse(body);
  if (!result.success) {
    const fields = result.error.issues.flatMap((issue) =>
      issue.code === "unrecognized_keys"
        ? issue.keys.map((key) => [...issue.path, key].join("."))
        : [issue.path.join(".") || "body"],
    );
    return { ok: false, fields: [...new Set(fields)] };
  }
  const value = result.data;
  const fields: string[] = [];
  value.segments.forEach((s, i) => {
    if (s.end < s.start) fields.push(`segments.${i}.end`);
    else if (s.end > value.duration_seconds + END_SLACK_SECONDS)
      fields.push(`segments.${i}.end`);
  });
  const totalText = value.segments.reduce((n, s) => n + s.text.length, 0);
  const hasText = value.segments.some((s) => cleanText(s.text) !== "");
  if (
    totalText > MAX_TOTAL_TEXT ||
    (value.outcome === "speech" ? !hasText : value.segments.length > 0)
  )
    fields.push("segments");
  return fields.length > 0 ? { ok: false, fields } : { ok: true, value };
}

export function assembleDeviceTranscript(
  value: DeviceTranscript,
  {
    recorderName,
    priorSpeakerMap,
  }: {
    recorderName: string | null;
    priorSpeakerMap: Record<string, string | null> | null;
  },
) {
  const cleaned: TranscriptionSegment[] = value.segments
    .map((s) => ({
      speaker: s.speaker,
      start: s.start,
      end: s.end,
      text: cleanText(s.text),
      confidence: s.confidence ?? null,
    }))
    .filter((s) => s.text !== "")
    .sort((a, b) => a.start - b.start);
  const them = cleaned.filter((s) => s.speaker !== "me");
  const segments = cleaned.filter(
    (s) => s.speaker !== "me" || !them.some((t) => isEcho(s, t)),
  );
  const speakerMap = resolveChannelSpeakerMap(recorderName, priorSpeakerMap);
  return {
    segments,
    speakerMap,
    transcriptRaw: flattenSegments(segments, speakerMap),
    outcome: value.outcome,
  };
}
