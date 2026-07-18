// Bounded PostgREST + GoTrue emulator — the single fetch seam the hermetic authz
// harness swaps in for globalThis.fetch. It implements ONLY the request grammar
// the gate surface actually issues (GoTrue user validation + a handful of scoped
// REST reads), NOT a general PostgREST. Anything outside that grammar (any write,
// any RPC, any unknown path) is a probe reaching further than intended, so it is
// logged to `unmatched` and thrown as UnmatchedRequestError rather than silently
// answered.
//
// RLS note: filters are applied literally regardless of anon vs service-role key.
// Every gate-relevant read carries its own explicit .eq()/.in() scoping (the app
// code does the tenant scoping, not the database), so no RLS emulation is needed —
// the fixture just honors the URL filters exactly as PostgREST would.

import { gotrueUser, bearerToken, decodeSub } from "./identity.mjs";

export class UnmatchedRequestError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "UnmatchedRequestError";
  }
}

// Embed resolution map: for a base table, which relation names in a select embed
// resolve to which ref table, joining localKey (on the base row) to refKey (on the
// ref row). Only the embeds the gate surface uses are declared.
const EMBEDS = {
  organization_members: {
    organizations: { table: "organizations", localKey: "organization_id", refKey: "id" },
    profiles: { table: "profiles", localKey: "user_id", refKey: "id" },
  },
};

// Control params to skip when filtering rows. NOTE: limit/order/offset are
// intentionally NOT honored — the fixture returns the full filtered set,
// unordered. Authz cares about row VISIBILITY (which tenant's rows come back),
// not pagination or ordering.
const FILTER_SKIP = new Set(["select", "order", "limit", "offset", "on_conflict"]);

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const PGRST116 = {
  code: "PGRST116",
  message: "JSON object requested, multiple (or no) rows returned",
  details: "The result contains 0 rows",
};

function cmp(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && a !== "" && b !== "") {
    return na < nb ? -1 : na > nb ? 1 : 0;
  }
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function parseList(arg) {
  return arg
    .replace(/^\(/, "")
    .replace(/\)$/, "")
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter((s) => s.length > 0);
}

// Evaluate one PostgREST filter (`eq.X`, `neq.X`, `is.null`, `in.(...)`,
// `not.in.(...)`, `ilike.X`, `gte/lte/lt/gt.X`) against a single cell value.
function matchFilter(cell, raw) {
  let negate = false;
  let v = raw;
  if (v.startsWith("not.")) {
    negate = true;
    v = v.slice(4);
  }
  const dot = v.indexOf(".");
  const op = dot === -1 ? v : v.slice(0, dot);
  const arg = dot === -1 ? "" : v.slice(dot + 1);
  let result;
  switch (op) {
    case "eq":
      result = String(cell) === arg;
      break;
    case "neq":
      result = String(cell) !== arg;
      break;
    case "is":
      result = arg === "null" ? cell == null : String(cell) === arg;
      break;
    case "in":
      result = parseList(arg).includes(String(cell));
      break;
    case "ilike": {
      const pat = arg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*").replace(/%/g, ".*");
      result = new RegExp(`^${pat}$`, "i").test(String(cell ?? ""));
      break;
    }
    case "gte":
      result = cmp(cell, arg) >= 0;
      break;
    case "lte":
      result = cmp(cell, arg) <= 0;
      break;
    case "lt":
      result = cmp(cell, arg) < 0;
      break;
    case "gt":
      result = cmp(cell, arg) > 0;
      break;
    default:
      result = true; // unknown operator: do not filter it out
  }
  return negate ? !result : result;
}

// Split a select body on top-level commas (commas inside embed parens stay put).
function splitTopLevel(str) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of str) {
    if (ch === "(") {
      depth++;
      cur += ch;
    } else if (ch === ")") {
      depth--;
      cur += ch;
    } else if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((s) => s.trim()).filter(Boolean);
}

const EMBED_RE = /^([A-Za-z_][A-Za-z0-9_]*)(?:!([A-Za-z0-9_]+))?\((.*)\)$/;

// -> { columns:[...], embeds:[{ relation, subcols:[...] }] }
function parseSelect(selectStr) {
  const columns = [];
  const embeds = [];
  if (!selectStr) return { columns, embeds };
  for (const part of splitTopLevel(selectStr)) {
    const m = part.match(EMBED_RE);
    if (m) {
      embeds.push({ relation: m[1], subcols: splitTopLevel(m[3]) });
    } else {
      columns.push(part);
    }
  }
  return { columns, embeds };
}

function project(obj, cols) {
  const out = {};
  for (const c of cols) out[c] = obj?.[c] ?? null;
  return out;
}

export function makeFixture(scenario) {
  const db = scenario?.db ?? {};
  const requestLog = [];
  const unmatched = [];

  function tableRows(table) {
    return Array.isArray(db[table]) ? db[table] : [];
  }

  function findProfile(id) {
    return tableRows("profiles").find((r) => r.id === id) ?? null;
  }

  function resolveEmbed(table, relation, row) {
    const cfg = EMBEDS[table]?.[relation];
    if (!cfg) return null;
    return tableRows(cfg.table).find((r) => r[cfg.refKey] === row[cfg.localKey]) ?? null;
  }

  async function fetch(input, init) {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const method = String(
      init?.method ?? (typeof input === "object" ? input?.method : undefined) ?? "GET"
    ).toUpperCase();
    const headers = new Headers(
      init?.headers ?? (typeof input === "object" ? input?.headers : undefined) ?? {}
    );
    const u = new URL(url);
    const p = u.pathname;
    requestLog.push(`${method} ${p}`);

    // 1. GoTrue user validation, identity keyed off the JWT `sub`.
    if ((method === "GET" || method === "HEAD") && p === "/auth/v1/user") {
      const sub = decodeSub(bearerToken(headers.get("authorization")) ?? "");
      const prof = sub ? findProfile(sub) : null;
      if (!prof) return jsonResponse({ msg: "invalid token" }, 401);
      return jsonResponse(gotrueUser(prof.id, prof.email));
    }

    // 3. Storage bucket list (some admin reads enumerate buckets).
    if ((method === "GET" || method === "HEAD") && p === "/storage/v1/bucket") {
      return jsonResponse([]);
    }

    // 2. REST reads.
    if ((method === "GET" || method === "HEAD") && p.startsWith("/rest/v1/") && !p.startsWith("/rest/v1/rpc/")) {
      const table = p.slice("/rest/v1/".length);
      // Declared-but-empty tables return []; an UNDECLARED table means a probed
      // handler read further than the scenario models — treat it as a hermeticity
      // gap (log + throw), not a silent []. Seed the table empty in scenarios.mjs
      // to declare it.
      if (!Object.prototype.hasOwnProperty.call(db, table)) {
        const msg = `${method} /rest/v1/${table} (table not modeled in scenario)`;
        unmatched.push(msg);
        throw new UnmatchedRequestError(msg);
      }
      let rows = tableRows(table);

      // Apply URL filters (skip control params).
      for (const [key, value] of u.searchParams.entries()) {
        if (FILTER_SKIP.has(key)) continue;
        rows = rows.filter((row) => matchFilter(row[key], value));
      }

      const { embeds } = parseSelect(u.searchParams.get("select") ?? "");
      const projected =
        embeds.length === 0
          ? rows
          : rows.map((row) => {
              const out = { ...row };
              for (const e of embeds) {
                const ref = resolveEmbed(table, e.relation, row);
                out[e.relation] = ref ? project(ref, e.subcols) : null;
              }
              return out;
            });

      // count=exact / head: supabase-js reads the total from content-range.
      const prefer = (headers.get("prefer") ?? "").toLowerCase();
      if (prefer.includes("count=exact")) {
        const n = projected.length;
        const range = n > 0 ? `0-${n - 1}/${n}` : `*/0`;
        return jsonResponse(projected, 200, { "content-range": range });
      }

      // .single(): Accept application/vnd.pgrst.object+json (maybeSingle does NOT
      // send this header in postgrest-js 2.105.1).
      if ((headers.get("accept") ?? "").includes("application/vnd.pgrst.object+json")) {
        if (projected.length === 1) return jsonResponse(projected[0]);
        return jsonResponse(PGRST116, 406);
      }

      return jsonResponse(projected);
    }

    // Everything else (writes, RPC, unknown paths): a probe overreached.
    unmatched.push(`${method} ${url}`);
    throw new UnmatchedRequestError(`${method} ${url}`);
  }

  function reset() {
    requestLog.length = 0;
    unmatched.length = 0;
  }

  return { fetch, requestLog, unmatched, reset };
}
