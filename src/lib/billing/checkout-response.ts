/**
 * Extracts the checkout redirect URL from a BFF upstream response.
 * Returns null on any error condition so the caller can return 502.
 */
export function extractCheckoutUrl(ok: boolean, body: unknown): string | null {
  if (!ok) return null;
  if (!body || typeof body !== "object") return null;
  const url = (body as { url?: unknown }).url;
  return typeof url === "string" && url.length > 0 ? url : null;
}
