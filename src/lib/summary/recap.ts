import { sanitizeRecap } from "@/lib/summary/structure";
import type { TranscriptionUiState } from "@/components/minutia/transcription-status";

export type RecapUpdate = {
  recap_markdown: string;
  recap_generated_at: string;
  recap_model: string;
};
export type RecapFailure = "unavailable" | "error" | "stopped";
export type RecapView = "text" | "streaming" | "skeleton" | "failed" | "stopped" | "hidden";
export type RecapStep = "transcribe" | "extract" | "recap";

const TRANSCRIBE_STATES: TranscriptionUiState[] = [
  "saving",
  "saved_pending",
  "transcribing",
  "processing_return",
];

export function buildRecapUpdate(text: string, model: string, now: Date): RecapUpdate | null {
  const recap = sanitizeRecap(text);
  if (!recap) return null;
  return { recap_markdown: recap, recap_generated_at: now.toISOString(), recap_model: model };
}

// Streams words to the client and stores the recap only when the provider
// finished and the client is still listening. Resolves false when no recap was
// produced (throw, abort or blank), so the route can tell the client.
export async function pipeRecap(input: {
  words: AsyncIterable<string>;
  emit: (word: string) => void;
  signal: AbortSignal;
  model: string;
  persist: (row: RecapUpdate) => Promise<void>;
}): Promise<boolean> {
  let text = "";
  try {
    for await (const word of input.words) {
      input.emit(word);
      text += word;
    }
  } catch {
    return false;
  }
  if (input.signal.aborted) return false;
  const row = buildRecapUpdate(text, input.model, new Date());
  if (!row) return false;
  try {
    await input.persist(row);
  } catch {
    return false;
  }
  return true;
}

export function shouldAutoStartRecap(p: {
  canGenerate: boolean;
  storedText: string | null;
  hasSource: boolean;
}): boolean {
  return p.canGenerate && p.hasSource && !p.storedText?.trim();
}

export function resolveRecapView(p: {
  storedText: string | null;
  streamedText: string;
  streaming: boolean;
  preparing: boolean;
  failure: RecapFailure | null;
  canGenerate: boolean;
}): RecapView {
  if (p.streaming) return "streaming";
  if (p.streamedText.trim() || p.storedText?.trim()) return "text";
  if (!p.canGenerate) return "hidden";
  if (p.preparing) return "skeleton";
  if (p.failure === "error") return "failed";
  if (p.failure === "stopped") return "stopped";
  return "hidden";
}

export function recapFailureFromStatus(status: number): "unavailable" | "error" {
  return status === 503 || status === 403 ? "unavailable" : "error";
}

export function recapStep(
  state: TranscriptionUiState,
  extracting: boolean,
  recapActive: boolean
): RecapStep | null {
  if (TRANSCRIBE_STATES.includes(state)) return "transcribe";
  if (state === "transcript_ready" && extracting) return "extract";
  if (recapActive) return "recap";
  return null;
}

export function recapProgressDetail(
  state: TranscriptionUiState,
  details: string[]
): string | undefined {
  if (state === "saving") return "Saving the recording…";
  if (state === "saved_pending") return "Preparing…";
  if ((state === "transcribing" || state === "processing_return") && details.length > 0) {
    return details.join(" · ");
  }
  return undefined;
}

export function formatRecapAge(at: Date | string, now: Date): string {
  const then = new Date(at);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
