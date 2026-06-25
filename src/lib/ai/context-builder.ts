// MIN-121: Series-history context for AI item extraction.
//
// This is the moat. Competitors summarize one meeting in isolation; Minutia
// feeds the model the living state of the whole series (open OIL items, recent
// decisions, recent status changes) so it can deduplicate, detect resolutions,
// follow up on prior items, and flag contradictions.
//
// The module is intentionally dependency-light (no Supabase or Zod imports, a
// structural client type) so it bundles and unit-tests in isolation. The fetch,
// the prompt rendering, and the referential-integrity normalization are all
// pure and deterministic.

/** Statuses that count as "still open" and therefore carry across meetings. */
export const OPEN_ISSUE_STATUSES = ["open", "in_progress", "pending"] as const;

export interface SeriesContextIssue {
  issue_number: number;
  title: string;
  category: string;
  status: string;
  priority: string;
  owner_name: string | null;
  due_date: string | null;
}

export interface SeriesContextDecision {
  title: string;
  rationale: string | null;
  made_by: string | null;
  created_at: string;
}

export interface SeriesContextUpdate {
  issue_number: number | null;
  issue_title: string | null;
  previous_status: string | null;
  new_status: string | null;
  note: string | null;
  created_at: string;
}

export interface SeriesContext {
  openIssues: SeriesContextIssue[];
  recentDecisions: SeriesContextDecision[];
  recentUpdates: SeriesContextUpdate[];
}

// Minimal structural shape of the Supabase query builder we depend on. Split
// into start -> filter the way PostgREST does (select() returns the filter
// builder) so both the real client and a hand-rolled mock are assignable. Kept
// local so this module has no runtime imports and stays trivially mockable.
interface QueryResult<T> {
  data: T[] | null;
  error: unknown;
}
interface FilterLike<T> extends PromiseLike<QueryResult<T>> {
  eq(column: string, value: unknown): FilterLike<T>;
  in(column: string, values: readonly unknown[]): FilterLike<T>;
  order(column: string, options: { ascending: boolean }): FilterLike<T>;
  limit(count: number): FilterLike<T>;
}
interface SupabaseLike {
  from(table: string): { select(columns: string): FilterLike<Record<string, unknown>> };
}

/** The slice of the Supabase client buildSeriesContext needs. Exported so the
 * caller can cast its richly-typed client (whose PostgREST generics are too deep
 * for TS to structurally verify against this) without re-deriving the shape. */
export type SeriesContextClient = SupabaseLike;

// Bound the context so the prompt stays well within the model's window even for
// long-running series. Most-recent-first ordering keeps the freshest signal.
const OPEN_ISSUE_LIMIT = 50;
const DECISION_LIMIT = 20;
const UPDATE_LIMIT = 30;

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/**
 * Load the full series history that informs context-aware extraction: every
 * open OIL item across all meetings in the series, the most recent decisions,
 * and the most recent status changes. All three are series-scoped (RLS already
 * confines them to series the caller can access).
 */
export async function buildSeriesContext(
  supabase: SupabaseLike,
  seriesId: string
): Promise<SeriesContext> {
  const [issuesRes, decisionsRes, updatesRes] = await Promise.all([
    supabase
      .from("issues")
      .select("issue_number, title, category, status, priority, owner_name, due_date")
      .eq("series_id", seriesId)
      .in("status", OPEN_ISSUE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(OPEN_ISSUE_LIMIT),
    supabase
      .from("decisions")
      .select("title, rationale, made_by, created_at")
      .eq("series_id", seriesId)
      .order("created_at", { ascending: false })
      .limit(DECISION_LIMIT),
    supabase
      .from("issue_updates")
      .select(
        "previous_status, new_status, note, created_at, issue:issues!inner(issue_number, title, series_id)"
      )
      .eq("issue.series_id", seriesId)
      .order("created_at", { ascending: false })
      .limit(UPDATE_LIMIT),
  ]);

  const openIssues: SeriesContextIssue[] = (issuesRes.data ?? []).map((row) => ({
    issue_number: num(row.issue_number) ?? 0,
    title: str(row.title) ?? "",
    category: str(row.category) ?? "action",
    status: str(row.status) ?? "open",
    priority: str(row.priority) ?? "medium",
    owner_name: str(row.owner_name),
    due_date: str(row.due_date),
  }));

  const recentDecisions: SeriesContextDecision[] = (decisionsRes.data ?? []).map((row) => ({
    title: str(row.title) ?? "",
    rationale: str(row.rationale),
    made_by: str(row.made_by),
    created_at: str(row.created_at) ?? "",
  }));

  const recentUpdates: SeriesContextUpdate[] = (updatesRes.data ?? []).flatMap((row) => {
    // PostgREST returns the embedded to-one relation as an object, but tolerate
    // an array shape too so a provider quirk never throws here.
    const embedded = (Array.isArray(row.issue) ? row.issue[0] : row.issue) as
      | Record<string, unknown>
      | undefined;
    // Belt-and-suspenders series scoping: the embedded-resource filter
    // (.eq("issue.series_id", ...)) is PostgREST-version-dependent, so never
    // trust it alone. Drop any update whose issue is not in this series, so
    // cross-series history can never leak into the prompt.
    if (str(embedded?.series_id) !== seriesId) return [];
    return [{
      issue_number: num(embedded?.issue_number),
      issue_title: str(embedded?.title),
      previous_status: str(row.previous_status),
      new_status: str(row.new_status),
      note: str(row.note),
      created_at: str(row.created_at) ?? "",
    }];
  });

  return { openIssues, recentDecisions, recentUpdates };
}

/**
 * Render the series context as a compact, OIL-keyed prompt block the model can
 * reason over. Deterministic so it is unit-testable and reproducible across
 * runs. Empty sections read "(none)" rather than vanishing, so the model knows
 * the difference between "no history" and "history omitted".
 */
export function formatSeriesContextForPrompt(context: SeriesContext): string {
  const issues = context.openIssues.length
    ? context.openIssues
        .map(
          (i) =>
            `  - OIL-${i.issue_number} [${i.category}] ${i.title} (status: ${i.status}, owner: ${
              i.owner_name?.trim() || "unassigned"
            })`
        )
        .join("\n")
    : "  (none)";

  const decisions = context.recentDecisions.length
    ? context.recentDecisions
        .map((d) => `  - ${d.title}${d.made_by?.trim() ? ` (by ${d.made_by.trim()})` : ""}`)
        .join("\n")
    : "  (none)";

  const updates = context.recentUpdates.length
    ? context.recentUpdates
        .map((u) => {
          const key = u.issue_number != null ? `OIL-${u.issue_number}` : "an item";
          const transition =
            u.previous_status && u.new_status
              ? `${u.previous_status} -> ${u.new_status}`
              : u.new_status ?? "updated";
          const note = u.note?.trim() ? `: ${u.note.trim()}` : "";
          return `  - ${key} ${transition}${note}`;
        })
        .join("\n")
    : "  (none)";

  return [
    "OPEN ITEMS ALREADY TRACKED IN THIS SERIES (the OIL board):",
    issues,
    "",
    "RECENT DECISIONS IN THIS SERIES:",
    decisions,
    "",
    "RECENT STATUS CHANGES IN THIS SERIES:",
    updates,
  ].join("\n");
}

export type SuggestionType = "new_item" | "status_update" | "duplicate_warning";

/** The minimal provider-shaped suggestion this module reasons about. Callers
 * pass their richer object (title, category, ...) and get it back intact. */
export interface RawSuggestion {
  type: SuggestionType;
  related_issue_number: number | null;
  suggested_status: string | null;
}

/**
 * Enforce referential integrity on the model's output before it ever reaches
 * the OIL board. The model can hallucinate references, so every status_update /
 * duplicate_warning must point at a real open item, and:
 *
 * - new_item: any stray reference or status is cleared (it is, by definition,
 *   not about an existing item).
 * - status_update: kept only when it targets a real open item AND moves it to a
 *   genuinely different status; a no-op or dangling update is dropped as noise.
 * - duplicate_warning: kept only when it points at a real open item; it never
 *   carries a status change.
 *
 * This is what keeps the cross-meeting badges trustworthy, which is what keeps
 * the flywheel turning.
 */
export function normalizeSuggestions<T extends RawSuggestion>(
  suggestions: T[],
  openIssues: { issue_number: number; status: string }[]
): T[] {
  const statusByNumber = new Map(openIssues.map((i) => [i.issue_number, i.status]));

  return suggestions.flatMap((suggestion): T[] => {
    if (suggestion.type === "status_update") {
      const ref = suggestion.related_issue_number;
      if (ref == null || !statusByNumber.has(ref)) return [];
      const next = suggestion.suggested_status;
      if (!next || next === statusByNumber.get(ref)) return [];
      return [{ ...suggestion, related_issue_number: ref, suggested_status: next }];
    }

    if (suggestion.type === "duplicate_warning") {
      const ref = suggestion.related_issue_number;
      if (ref == null || !statusByNumber.has(ref)) return [];
      return [{ ...suggestion, related_issue_number: ref, suggested_status: null }];
    }

    // new_item (and any unexpected type) tracks nothing pre-existing.
    return [{ ...suggestion, type: "new_item", related_issue_number: null, suggested_status: null }];
  });
}
