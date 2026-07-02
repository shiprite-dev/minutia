// ---------------------------------------------------------------------------
// AssemblyAI diarizing STT client (cloud diarization primary).
//
// Async job model: upload -> create transcript with speaker_labels -> poll.
// speakers_expected is fed from the known series roster size, a real accuracy
// lever. Utterance times are milliseconds; we normalize to seconds. No chunking:
// diarization needs the whole recording in one label space.
// ---------------------------------------------------------------------------

import {
  TranscriptionError,
  mapHttpStatusToCode,
  type TranscriptionResult,
  type TranscriptionSegment,
} from "./shared";

export const ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com";
export const ASSEMBLYAI_DEFAULT_MODEL = "universal";

const POLL_INTERVAL_MS = 2000;

interface AssemblyOptions {
  apiKey: string;
  speakersExpected?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  baseUrl?: string;
}

async function aaiFetch(
  url: string,
  apiKey: string,
  init: RequestInit,
  signal?: AbortSignal
): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { authorization: apiKey, ...init.headers }, signal });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new TranscriptionError(
      mapHttpStatusToCode(res.status),
      `AssemblyAI returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      { status: res.status, provider: "assemblyai" }
    );
  }
  return res;
}

export async function transcribeWithAssemblyAI(
  audio: Blob,
  { apiKey, speakersExpected, timeoutMs = 120_000, signal, baseUrl = ASSEMBLYAI_BASE_URL }: AssemblyOptions
): Promise<TranscriptionResult> {
  const deadline = Date.now() + timeoutMs;

  const uploadRes = await aaiFetch(
    `${baseUrl}/v2/upload`,
    apiKey,
    { method: "POST", body: audio },
    signal
  );
  const { upload_url } = (await uploadRes.json()) as { upload_url: string };

  const body: Record<string, unknown> = { audio_url: upload_url, speaker_labels: true };
  if (speakersExpected && speakersExpected > 1) body.speakers_expected = speakersExpected;

  const createRes = await aaiFetch(
    `${baseUrl}/v2/transcript`,
    apiKey,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    signal
  );
  const { id } = (await createRes.json()) as { id: string };

  // Poll until terminal. The internal deadline caps total time; the injected
  // signal still cancels immediately.
  for (;;) {
    if (Date.now() > deadline) {
      throw new TranscriptionError("timeout", `AssemblyAI job timed out after ${timeoutMs}ms`, {
        provider: "assemblyai",
      });
    }
    const pollRes = await aaiFetch(`${baseUrl}/v2/transcript/${id}`, apiKey, { method: "GET" }, signal);
    const job = (await pollRes.json()) as {
      status: string;
      text?: string;
      error?: string;
      audio_duration?: number;
      utterances?: { speaker: string; start: number; end: number; text: string; confidence: number }[];
    };

    if (job.status === "error") {
      throw new TranscriptionError("provider_error", `AssemblyAI job failed: ${job.error ?? "unknown"}`, {
        provider: "assemblyai",
      });
    }
    if (job.status === "completed") {
      const segments: TranscriptionSegment[] = (job.utterances ?? []).map((u) => ({
        speaker: u.speaker,
        start: u.start / 1000,
        end: u.end / 1000,
        text: u.text,
        confidence: typeof u.confidence === "number" ? u.confidence : null,
      }));
      return {
        text: job.text ?? segments.map((s) => s.text).join(" "),
        model: ASSEMBLYAI_DEFAULT_MODEL,
        provider: "assemblyai",
        durationSeconds: typeof job.audio_duration === "number" ? job.audio_duration : null,
        segments: segments.length ? segments : undefined,
        diarized: segments.length > 0,
      };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}
