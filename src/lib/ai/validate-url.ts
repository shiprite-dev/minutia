import { isIP } from "node:net";

export type ValidateAiBaseUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: "invalid-url" | "invalid-scheme" | "blocked-host" | "insecure-http" };

/** Strip IPv6 brackets so isIP() can classify the address. */
function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

/** Parse octets only for valid IPv4 addresses; returns null otherwise. */
function ipv4Octets(hostname: string): [number, number, number, number] | null {
  if (isIP(hostname) !== 4) return null;
  const parts = hostname.split(".");
  return [Number(parts[0]), Number(parts[1]), Number(parts[2]), Number(parts[3])];
}

/** 169.254.0.0/16 link-local block (covers cloud metadata at 169.254.169.254). */
function isLinkLocal(hostname: string): boolean {
  const octets = ipv4Octets(hostname);
  return octets !== null && octets[0] === 169 && octets[1] === 254;
}

/** 127.0.0.0/8 or ::1 loopback. */
function isLoopback(plain: string): boolean {
  const octets = ipv4Octets(plain);
  if (octets !== null) return octets[0] === 127;
  return plain === "::1";
}

/** RFC 1918 private IPv4: 10/8, 172.16/12, 192.168/16. */
function isPrivateIPv4(hostname: string): boolean {
  const octets = ipv4Octets(hostname);
  if (octets === null) return false;
  const [a, b] = octets;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Returns true when the host is allowed over plain HTTP. */
function isHttpAllowed(hostname: string): boolean {
  if (hostname === "localhost") return true;
  if (hostname === "host.docker.internal") return true;
  if (hostname.endsWith(".local")) return true;
  const plain = stripBrackets(hostname);
  if (isLoopback(plain)) return true;
  if (isPrivateIPv4(hostname)) return true;
  return false;
}

/** Strip exactly one trailing slash from the path component. */
function normalizeUrl(parsed: URL): string {
  const cleanPath =
    parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
  return parsed.origin + cleanPath + parsed.search + parsed.hash;
}

export function validateAiBaseUrl(raw: string): ValidateAiBaseUrlResult {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  const { protocol, hostname } = parsed;

  if (protocol !== "http:" && protocol !== "https:") {
    return { ok: false, reason: "invalid-scheme" };
  }

  // Block link-local (169.254.0.0/16) for all schemes.
  if (isLinkLocal(hostname)) {
    return { ok: false, reason: "blocked-host" };
  }

  if (protocol === "http:" && !isHttpAllowed(hostname)) {
    return { ok: false, reason: "insecure-http" };
  }

  return { ok: true, url: normalizeUrl(parsed) };
}
