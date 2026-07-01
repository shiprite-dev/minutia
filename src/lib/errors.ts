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
    const o = err as { message?: unknown; error?: { message?: unknown } };
    if (typeof o.message === "string") return o.message;
    if (o.error && typeof o.error.message === "string") return o.error.message;
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

export function humanizeError(err: unknown): string {
  const raw = extractMessage(err).trim();
  const code = extractCode(err);
  const m = raw.toLowerCase();

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
