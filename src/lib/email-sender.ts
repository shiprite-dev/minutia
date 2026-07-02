/**
 * Pure sender-address ("from") resolution + validation, shared by every email
 * path (Resend API and SMTP) so a sender configured in Admin -> Settings is
 * honored consistently. Kept free of app/runtime imports so it unit-tests in
 * node (see scripts/verify-email-sender.test.mjs).
 */

export const SENDER_NOT_CONFIGURED_MESSAGE =
  "No sender email is configured. Set the sender address in Admin -> Settings (or the EMAIL_FROM env var) before sending email.";

/** First non-blank candidate, in priority order; null if none. */
export function resolveSenderFrom(
  ...candidates: (string | null | undefined)[]
): string | null {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/** Extract the bare email address from `addr` or `Name <addr>`; null if absent. */
function extractAddress(from: string): string | null {
  const angle = from.match(/<([^>]*)>/);
  const candidate = (angle ? angle[1] : from).trim();
  return candidate || null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NON_ROUTABLE_HOST = /(^|\.)(localhost|local|internal|test|invalid)$/i;

/**
 * True only when `from` carries a real, routable email address. Rejects empty,
 * name-only, malformed, and non-routable hosts (localhost/.local/etc.) so we
 * never hand a provider like Resend an address it will 550 on.
 */
export function isDeliverableSender(from: string | null | undefined): boolean {
  if (!from) return false;
  const address = extractAddress(from);
  if (!address || !EMAIL_RE.test(address)) return false;
  const host = address.slice(address.lastIndexOf("@") + 1);
  return !NON_ROUTABLE_HOST.test(host);
}

/** Normalize to `Name <addr>` (some providers require a display name). */
export function formatSender(from: string): string {
  return from.includes("<") ? from : `Minutia <${from}>`;
}
