type HeaderReader = { get(name: string): string | null };

export type TrustedProxy = "cloudflare" | "";

export function getTrustedProxy(): TrustedProxy {
  const v = (process.env.TRUSTED_PROXY ?? "").toLowerCase().trim();
  return v === "cloudflare" ? "cloudflare" : "";
}

export function getClientIp(headers: HeaderReader): string {
  const proxy = getTrustedProxy();

  if (proxy === "cloudflare") {
    const cfIp = headers.get("cf-connecting-ip")?.trim();
    if (cfIp) return cfIp;
  }

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}
