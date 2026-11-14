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
  parseRetryAfterMs,
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
  deadlineAt?: number;
  baseUrl?: string;
  pollIntervalMs?: number;
}

// Per-request timeout tied to the remaining time budget, matching shared.ts's
// sendTranscription idiom: an internal AbortController that also forwards the
// caller's signal. The timer stays armed until the caller releases it after
// body consumption, so a hung body cannot outlive the deadline.
interface AaiResponse {
  res: Response;
  release: () => void;
}

async function aaiFetch(
  url: string,
  apiKey: string,
  init: RequestInit,
  deadline: number,
  signal?: AbortSignal
): Promise<AaiResponse> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new TranscriptionError("timeout", "AssemblyAI job timed out after the time budget", {
      provider: "assemblyai",
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", onAbort);
  const release = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  };

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { authorization: apiKey, ...init.headers },
      signal: controller.signal,
    });
  } catch (error) {
    release();
    if (error instanceof TranscriptionError) throw error;
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new TranscriptionError(
      aborted ? "timeout" : "provider_error",
      aborted ? "AssemblyAI request timed out" : "AssemblyAI request failed",
      { provider: "assemblyai", cause: error }
    );
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch (error) {
      release();
      throw new TranscriptionError("timeout", "AssemblyAI hung on the error body", {
        provider: "assemblyai",
        cause: error,
      });
    }
    release();
    const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
    throw new TranscriptionError(
      mapHttpStatusToCode(res.status),
      `AssemblyAI returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      { status: res.status, provider: "assemblyai", retryAfterMs: retryAfterMs ?? undefined }
    );
  }
  return { res, release };
}

async function readJson<T>(response: AaiResponse): Promise<T> {
  try {
    return (await response.res.json()) as T;
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new TranscriptionError(
      aborted ? "timeout" : "provider_error",
      aborted ? "AssemblyAI response body timed out" : "AssemblyAI returned invalid JSON",
      { provider: "assemblyai", cause: error }
    );
  } finally {
    response.release();
  }
}

export async function transcribeWithAssemblyAI(
  audio: Blob,
  {
    apiKey,
    speakersExpected,
    timeoutMs = 120_000,
    signal,
    deadlineAt,
    baseUrl = ASSEMBLYAI_BASE_URL,
    pollIntervalMs = POLL_INTERVAL_MS,
  }: AssemblyOptions
): Promise<TranscriptionResult> {
  // Clamp the whole job (upload, create, polling, body reads) to the remaining
  // request budget so this attempt cannot borrow time the request does not have.
  if (deadlineAt != null) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      throw new TranscriptionError("timeout", "Transcription request budget exhausted", {
        provider: "assemblyai",
      });
    }
    timeoutMs = Math.min(timeoutMs, remaining);
  }
  const deadline = Date.now() + timeoutMs;

  const uploadRes = await aaiFetch(
    `${baseUrl}/v2/upload`,
    apiKey,
    { method: "POST", body: audio },
    deadline,
    signal
  );
  const { upload_url } = await readJson<{ upload_url: string }>(uploadRes);

  const body: Record<string, unknown> = { audio_url: upload_url, speaker_labels: true };
  if (speakersExpected && speakersExpected > 1) body.speakers_expected = speakersExpected;

  const createRes = await aaiFetch(
    `${baseUrl}/v2/transcript`,
    apiKey,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    deadline,
    signal
  );
  const { id } = await readJson<{ id: string }>(createRes);

  // Poll until terminal. The internal deadline caps total time; the injected
  // signal still cancels immediately. Each fetch also carries its own
  // remaining-budget timeout (aaiFetch), so a single hung request can't
  // block past the deadline; this between-iteration check is a cheap
  // belt-and-suspenders guard on top of that.
  for (;;) {
    if (Date.now() > deadline) {
      throw new TranscriptionError("timeout", `AssemblyAI job timed out after ${timeoutMs}ms`, {
        provider: "assemblyai",
      });
    }
    const pollRes = await aaiFetch(`${baseUrl}/v2/transcript/${id}`, apiKey, { method: "GET" }, deadline, signal);
    const job = await readJson<{
      status: string;
      text?: string;
      error?: string;
      audio_duration?: number;
      utterances?: { speaker: string; start: number; end: number; text: string; confidence: number }[];
    }>(pollRes);

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
      const text = job.text ?? segments.map((s) => s.text).join(" ");
      // Silence is terminal only with positive evidence: an explicit empty
      // utterance collection (or explicit empty text) from a finished job. A
      // completed job whose payload carries neither is malformed, not silent:
      // fail loudly instead of manufacturing an empty success.
      if (text.trim() === "" && job.text == null && !Array.isArray(job.utterances)) {
        throw new TranscriptionError("provider_error", "AssemblyAI returned an invalid empty result", {
          provider: "assemblyai",
        });
      }
      const outcome: "speech" | "no_speech" = text.trim() === "" ? "no_speech" : "speech";
      return {
        text,
        model: ASSEMBLYAI_DEFAULT_MODEL,
        provider: "assemblyai",
        durationSeconds: typeof job.audio_duration === "number" ? job.audio_duration : null,
        segments: segments.length ? segments : undefined,
        diarized: segments.length > 0,
        outcome,
      };
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}
