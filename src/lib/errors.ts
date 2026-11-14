// Turn an arbitrary thrown value (Error, Supabase/PostgREST error, string, or
// opaque object) into a single, friendly, user-safe sentence. Low-level
// database/stack noise is never shown; recognized failure classes get canned
// copy; a clean server-authored sentence passes through unchanged.

const GENERIC = "Something went wrong. Please try again.";

// Tokens that mark a message as internal plumbing we must not surface verbatim.
const NOISE = [
  "violates",
  "constraint",
  "column",
  "null value",
  "invalid input syntax",
  "syntax error",
  "pgrst",
  "relation ",
  "permission denied for",
  "deadlock",
  "stack",
  "econn",
  "undefined",
];

function extractMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const o = err as { message?: unknown; error?: unknown };
    // A BFF error body carries its user-facing sentence in a top-level `error`.
    if (typeof o.error === "string") return o.error;
    if (typeof o.message === "string") return o.message;
    const nested = o.error as { message?: unknown } | undefined;
    if (nested && typeof nested.message === "string") return nested.message;
  }
  return "";
}

function extractCode(err: unknown): string {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
    if (typeof code === "number") return String(code);
  }
  return "";
}

// Transcription failure codes, mapped to plain, non-technical copy. Keyed off
// the machine code so a body like { error, code } always yields a human reason
// instead of leaking the code or falling through to the generic message.
const TRANSCRIPTION_CODE_COPY: Record<string, string> = {
  timeout: "Transcription took too long. Try again.",
  rate_limit: "Transcription is temporarily busy. Try again in a moment.",
  auth_error: "This workspace has not been set up for transcription yet. Ask your administrator.",
  no_api_key: "This workspace has not been set up for transcription yet. Ask your administrator.",
  provider_not_configured:
    "This workspace has not been set up for transcription yet. Ask your administrator.",
  transcription_unconfigured:
    "This workspace has not been set up for transcription yet. Ask your administrator.",
  unsupported_format: "This recording format is not supported. Try uploading the recording again.",
  provider_error: "Transcription failed. Try again.",
  processing_conflict: "This recording is already being transcribed.",
  input_mismatch: "This recording changed. Refresh to see its current status.",
  extraction_failed: "Your transcript is ready, but action items could not be created.",
  download_failed: "The recording could not be downloaded. Try again.",
};

export function humanizeError(err: unknown): string {
  const raw = extractMessage(err).trim();
  const code = extractCode(err);
  const m = raw.toLowerCase();

  const normalizedCode = code.toLowerCase();
  const transcriptionCopy = Object.prototype.hasOwnProperty.call(TRANSCRIPTION_CODE_COPY, normalizedCode)
    ? TRANSCRIPTION_CODE_COPY[normalizedCode]
    : undefined;
  if (transcriptionCopy) return transcriptionCopy;

  if (m.includes("invalid login credentials")) {
    return "That email or password doesn't match our records.";
  }
  if (
    m.includes("jwt expired") ||
    m.includes("token expired") ||
    m.includes("not authenticated") ||
    m.includes("auth session missing") ||
    m.includes("invalid claim")
  ) {
    return "Your session expired. Please sign in again.";
  }
  if (
    code === "23505" ||
    m.includes("duplicate key") ||
    m.includes("unique constraint") ||
    m.includes("already exists")
  ) {
    return "That already exists.";
  }
  if (code === "429" || m.includes("rate limit") || m.includes("too many") || m.includes("429")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("network error") ||
    m.includes("load failed") ||
    m.includes("network request failed")
  ) {
    return "Network error. Check your connection and try again.";
  }

  // Pass a clean, human-authored sentence straight through; otherwise be generic.
  const looksHuman =
    raw.length > 0 &&
    raw.length <= 160 &&
    /[a-z]/i.test(raw) &&
    raw.trim().split(/\s+/).length >= 2 &&
    !NOISE.some((t) => m.includes(t));

  return looksHuman ? raw : GENERIC;
}
