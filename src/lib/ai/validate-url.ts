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

/**
 * If the IPv6 address is an IPv4-mapped form (::ffff:a.b.c.d or ::ffff:HHHH:HHHH),
 * return the embedded dotted-quad. Returns null for all other addresses.
 */
function ipv4MappedAddress(ipv6: string): string | null {
  // Dotted form: ::ffff:169.254.169.254
  const dottedMatch = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ipv6);
  if (dottedMatch) return dottedMatch[1];
  // Hex form: ::ffff:a9fe:a9fe (two 16-bit groups)
  const hexMatch = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ipv6);
  if (hexMatch) {
    const hi = parseInt(hexMatch[1], 16);
    const lo = parseInt(hexMatch[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

/**
 * Returns true for IPv6 addresses that are always internal/private:
 * loopback (::1), link-local (fe80::/10), or unique-local (fc00::/7).
 */
function isPrivateIPv6(ipv6: string): boolean {
  if (ipv6 === "::1") return true;
  // fe80::/10 covers fe80:: through febf::
  if (/^fe[89ab][0-9a-f]:/i.test(ipv6)) return true;
  // fc00::/7 covers addresses starting with fc or fd
  if (/^f[cd]/i.test(ipv6)) return true;
  return false;
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

  // Handle IPv6 literals: strip brackets then classify.
  const ipv6Plain = stripBrackets(hostname);
  if (isIP(ipv6Plain) === 6) {
    const mapped = ipv4MappedAddress(ipv6Plain);
    if (mapped !== null) {
      // IPv4-mapped: apply the same IPv4 classification to the embedded address.
      // Link-local and loopback are blocked regardless of scheme.
      if (isLinkLocal(mapped) || isLoopback(mapped)) {
        return { ok: false, reason: "blocked-host" };
      }
      // Private mapped over https: allowed, consistent with plain IPv4 behavior.
    } else if (protocol === "https:" && isPrivateIPv6(ipv6Plain)) {
      // Block ::1, fe80::/10, and fc00::/7 on the https "allow any host" path.
      return { ok: false, reason: "blocked-host" };
    }
  }

  if (protocol === "http:" && !isHttpAllowed(hostname)) {
    return { ok: false, reason: "insecure-http" };
  }

  return { ok: true, url: normalizeUrl(parsed) };
}
