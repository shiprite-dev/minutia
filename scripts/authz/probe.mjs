// The probe atom — runs one (node, identity) pair against the REAL bundled guard
// code and normalizes the result to a plain-object verdict ({ outcome, ... }).
// Every verdict is a plain object: no React refs, no Response instances leak out.
//
// Outcomes: "pass" | "redirect:/x" | "401" | "403" | "error:<msg>".

import { COOKIE_NAME } from "./identity.mjs";

let ipCounter = 0;
function uniqueIp() {
  // Unique x-forwarded-for per call so the middleware's per-IP rate-limit
  // buckets never accumulate across the crawl (avoids spurious 429s).
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 0xff}.${(ipCounter >> 8) & 0xff}.${ipCounter & 0xff}`;
}

export function setProbeContext(identity) {
  globalThis.__PROBE_CTX__ = {
    cookies: identity.cookie ? [{ name: COOKIE_NAME, value: identity.cookie }] : [],
    headers: {},
  };
}

function makeRequest(url, identity, NextRequest) {
  const headers = new Headers();
  headers.set("x-forwarded-for", uniqueIp());
  if (identity.cookie) headers.set("cookie", `${COOKIE_NAME}=${identity.cookie}`);
  return new NextRequest(new URL(url), { headers });
}

export function digestTarget(e) {
  // NEXT_REDIRECT;replace;<url>;307;
  return String(e?.digest ?? "").split(";")[2];
}

function isRedirect(res) {
  return res.status === 307 || res.status === 308 || res.headers.get("location") != null;
}

export function normalizeMw(res) {
  if (isRedirect(res)) {
    const location = res.headers.get("location");
    return { outcome: "redirect:" + new URL(location).pathname, status: res.status };
  }
  if (res.status === 401) return { outcome: "401" };
  return { outcome: "pass", status: res.status };
}

export function normalizeEndpoint(res, body) {
  const status = res.status;
  const outcome =
    status === 401
      ? "401"
      : status === 403
        ? "403"
        : status >= 200 && status < 300
          ? "pass"
          : "error:" + status;
  return { outcome, status, body };
}

export async function probeScreen(url, identity, mw) {
  setProbeContext(identity);
  const req = makeRequest("http://localhost:3000" + url, identity, mw.NextRequest);
  const res = await mw.middleware(req);
  return normalizeMw(res);
}

export async function probeGuard(identity, guardModule) {
  setProbeContext(identity);
  try {
    const el = await guardModule.default({ children: null });
    if (el && typeof el === "object" && "$$typeof" in el) return { outcome: "pass" };
    return { outcome: "error:guard-returned-non-element" };
  } catch (e) {
    if (e && e.message === "NEXT_REDIRECT") return { outcome: "redirect:" + digestTarget(e) };
    return { outcome: "error:" + (e?.message ?? String(e)) };
  }
}

export async function probeEndpoint(identity, endpointModule, method, url, mw) {
  // The real request first traverses middleware; if it bounces there (redirect or
  // 401), the handler is never reached, so that IS the verdict.
  const mwReq = makeRequest(url, identity, mw.NextRequest);
  const mwRes = await mw.middleware(mwReq);
  if (isRedirect(mwRes) || mwRes.status === 401) return normalizeMw(mwRes);

  setProbeContext(identity);
  const req = makeRequest(url, identity, mw.NextRequest);
  const res = await endpointModule[method](req);
  const body = await res.clone().json().catch(() => null);
  return normalizeEndpoint(res, body);
}
