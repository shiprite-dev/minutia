import { createHash, timingSafeEqual } from "node:crypto";

const MAX_TOKEN_AGE_SECONDS = 300;
const MAX_CLOCK_SKEW_SECONDS = 60;
const HANDOFF_LIFETIME_MS = 10 * 60 * 1000;

export type HandoffRow = {
  token_digest: string;
  nonce_digest: string;
  created_at: string;
  used_at: string | null;
};

export type HandoffCheck = "ok" | "used" | "expired" | "mismatch" | "missing";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function tokenIssuedAt(jwt: string): number {
  try {
    const { iat } = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof iat === "number" ? iat : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

export function isFreshToken(iatSeconds: number, nowSeconds: number): boolean {
  return (
    iatSeconds >= nowSeconds - MAX_TOKEN_AGE_SECONDS &&
    iatSeconds <= nowSeconds + MAX_CLOCK_SKEW_SECONDS
  );
}

export function checkHandoff(
  row: HandoffRow | null,
  { tokenHash, nonce, now }: { tokenHash: string; nonce: string; now: Date },
): HandoffCheck {
  if (!row || row.token_digest !== sha256Hex(tokenHash)) return "missing";
  if (row.used_at) return "used";
  if (!(now.getTime() - Date.parse(row.created_at) <= HANDOFF_LIFETIME_MS)) return "expired";
  const expected = Buffer.from(row.nonce_digest, "hex");
  const actual = Buffer.from(sha256Hex(nonce), "hex");
  if (!nonce || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return "mismatch";
  }
  return "ok";
}
