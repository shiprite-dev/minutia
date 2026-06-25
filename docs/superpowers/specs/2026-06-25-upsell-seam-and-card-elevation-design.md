# Design: Natural Upsell Seam + Bounded Shadow/Neumorphic Cards

Date: 2026-06-25
Status: Proposed (awaiting review)

## 1. Goals

1. Place upgrade nudges at the moments a free user is gaining the most value, so the
   nudge feels earned rather than pushy, and so no gated action dead-ends.
2. Replace card "borders" (`ring-1 ring-foreground/10`) with restrained elevation
   (soft layered shadows, subtle raised/inset feel) without losing readability.
3. Keep dashboard widgets inside their canvas slot: cap list lengths with
   click-to-expand affordances so a widget never grows unbounded.
4. Capture fresh screenshots of the redesigned UI for the README.

## 2. Constraints (set up front, not retrofitted)

- **Destination is config-driven.** Upsell CTA URL + label come from `instance_config`,
  never hardcoded. A self-host instance can point at "add your AI key" docs; a hosted
  instance points at its upgrade surface. Copy may be confident and value-forward;
  only the destination/label are externalized. No-config renders the informational
  notice with **no** CTA (never a broken/empty button).
- **Security.** CTA URLs validated to `http(s)` only (no `javascript:`/`data:`), same
  posture as today's `resolveAiNoticeCta`. Reuse, do not reinvent.
- **Performance budget.** Nudges add no blocking fetch on the hot path: notice-URL
  query stays lazy + cached (5 min staleTime, only on gated surfaces), dismissal state
  is local-only (`localStorage`, no network). Dashboard caps reduce DOM nodes, never add.
- **A11y.** Passive notices use `role="status"`; the capacity popover is focus-managed
  and dismissible by Escape; CTAs are real `<a>` links; all motion respects
  `prefers-reduced-motion`. Text contrast stays WCAG AA (the tonal step between
  `--card` and `--background` is the readability fallback when shadows are imperceptible).
- **Scope fences.** Retro's scoped `[data-retro]` design system is out of scope.
  No pricing tables, plan matrices, or `minutia-cloud` symbols enter committed code.

## 3. Workstream A — Upsell placements & interaction

### 3.1 Seam generalization

Today: `src/lib/ai/notice.ts` exposes `resolveAiNoticeCta(url, label)` reading
`instance_config.ai_notice_url`. Generalize to one pure resolver feeding named slots:

```
resolveUpsellCta(url?: string|null, label?: string|null, defaultLabel?: string)
  -> { href, label } | null
```

- Same validation (trim, `new URL`, http(s) only, label fallback).
- `resolveAiNoticeCta` becomes a thin wrapper (`defaultLabel = "Learn more"`) so existing
  call sites and the `verify-*` contract stay green; no behavioral change to the AI notice.
- `instance_config` slots: `ai_notice_url` (exists), new `capacity_notice_url`. The
  existing `/api/ai-notice` route is generalized to accept an optional `?slot=` query
  (default `ai` for back-compat) and return `{ ctaUrl }` for that slot. One admin field
  per slot in `/admin/settings`
  (reuse the existing instance-config editor; secrets-style "configured" treatment not
  needed since URLs are not secret).

### 3.2 Placements (ranked by naturalness)

| # | Trigger moment | Today | New behavior |
|---|---|---|---|
| 1 (primary) | Board reaches 25/25 active items | FAB disables; tooltip "Item limit reached"; dead-end | Counter shifts ink-4 -> accent at >= 20/25 (gentle heads-up). At 25, clicking the FAB opens a small dismissible **popover** anchored to the FAB (never a blocking modal): headline + `capacity_notice_url` CTA. Create still blocked, but now there is a path. |
| 2 | AI surfaces: Ask series, Ask meeting, record/transcribe, suggestions | `AiUnavailableNotice` renders, but no CTA in staging (no URL configured) | Same calm inline notice; CTA resolves whenever `ai_notice_url` is set. (No structural change, just confirm the seam + tests.) |
| 3 | Post-meeting / post-retro-graduation success | nothing | One-time, dismissible toast: "Want AI to draft these next time?" with the AI CTA. Frequency-capped (see 3.3). |
| 4 (conservative) | Empty AI suggestion area | nothing | Single soft value line, **no** hard CTA. Kept deliberately low-pressure. |

### 3.3 Interaction spec

- **Form:** inline banner (notices) or popover anchored to the gated control (capacity).
  Never a full-screen modal that blocks a free workflow.
- **Dismissal + cooldown:** pure helper in `src/lib/upsell/` keyed per slot:
  `shouldShowNudge(slot, now, dismissedAt, cooldownDays = 14)`. Dismissal persisted in
  `localStorage` (`minutia.upsell.<slot>.dismissedAt`). Capacity nudge reappears only when
  the user hits the wall again after the cooldown. Pure-tested.
- **Motion:** appear = fade + 4px rise, 180ms, `var(--ease)`; counter color transition on
  approach; all gated behind `prefers-reduced-motion`.
- **Copy:** confident, value-first, no fake urgency or countdowns. Example headline:
  "You've filled all 25 active items." CTA label from config (default "Learn more").

### 3.4 Components

- New `src/lib/upsell/` (pure): `resolveUpsellCta`, `shouldShowNudge`, slot constants.
- New `CapacityNudge` popover component (board); wires into `QuickAddButton` +
  `ItemUsageCounter` in `dashboard/page.tsx`.
- `AiUnavailableNotice` unchanged behaviorally (now imports from generalized seam).
- Optional `UpsellToast` for placement #3 (reuses existing toast system).

## 4. Workstream B — Borders -> restrained elevation

### 4.1 Tokens (`globals.css`, light + dark)

Add component-layer tokens:

- `--shadow-raised`: soft layered drop. Light: `0 1px 2px color-mix(in oklch, var(--ink) 6%, transparent), 0 2px 8px color-mix(in oklch, var(--ink) 5%, transparent)`. Dark: deeper drop plus a crisp top highlight `inset 0 1px 0 color-mix(in oklch, white 5%, transparent)` so cards read as raised without the muddy symmetric-neumorphism trap.
- `--shadow-raised-hover`: slightly stronger drop for interactive cards.
- `--shadow-inset`: subtle recess for wells/inputs (e.g. the "Ask this series" textarea).

Exact OKLCH values tuned during implementation against real screenshots; the above are the starting recipe.

### 4.2 `Card` primitive (`src/components/ui/card.tsx`)

- Remove `ring-1 ring-foreground/10`.
- Add `shadow-[var(--shadow-raised)]` + `transition-shadow`; interactive cards lift to
  `--shadow-raised-hover` on hover.
- `--card` keeps its existing one-step tonal offset from `--background` (paper-2 vs paper)
  as the contrast fallback. No generic line-clamp here (clamping is dashboard-specific, 4.3).

### 4.3 Canvas-bounded dashboard widgets

The widget must respect its canvas slot; long lists cap with an expand affordance rather
than growing the card. Concrete, grounded changes:

| Widget (`dashboard/page.tsx` unless noted) | Change |
|---|---|
| `SeriesWidget` ("Your series") | Currently **uncapped**. Cap to 5; render "+N more" inline expander (or rely on existing "View all" link plus a `+N more` count). |
| `OutstandingWidget` | Already caps at `PREVIEW_COUNT = 3` with expand. Keep. |
| `DecisionsWidget` | Caps at 5 but silently drops the rest. Add a "+N more" affordance for parity. |
| Series timeline issues-per-meeting (`date-anchored-timeline.tsx`) | `ISSUE_PREVIEW_LIMIT 5 -> 2`. Existing "Show all N items" expander already present; only the constant changes. |
| Timeline meetings shown (`INITIAL_DISPLAY_COUNT = 5`) | Keep. |

Widget shell gets a sensible bounded behavior so capped lists keep the card within its
grid slot (no inner infinite scroll on the dashboard).

### 4.4 Scope

App-wide via the shared `Card` primitive (board widgets, series brief, issue cards,
settings, admin). Sidebar/header (rule-based, not cards) unchanged unless visibly
inconsistent. Retro (`[data-retro]`) untouched.

## 5. README screenshots

After the redesign lands, capture polished screenshots (board + series detail, and the
capacity nudge) via the staging instance and update the README image(s). Screenshots are
a deliverable, captured from the new visual system, not mockups.

## 6. Testing (TDD)

**Pure (node:test / `scripts/verify-*.mjs`):**
- `resolveUpsellCta`: http(s)-only, label fallback, null on empty/unsafe; `resolveAiNoticeCta`
  wrapper unchanged.
- `shouldShowNudge`: shows when never dismissed; hides within cooldown; reshows after cooldown.

**E2E (Playwright, free user):**
- At 25/25: FAB click opens capacity popover; CTA present when `capacity_notice_url` set,
  absent when not; dismissal persists across reload (cooldown).
- AI notice: CTA present iff `ai_notice_url` set.
- Visual containment: a series with a very long name in "Your series" keeps the widget
  within its expected bounding box; a meeting with >2 issues shows exactly 2 + expander.
- Assert `Card` renders no `ring-*` class and a shadow is applied.

Run full `pnpm test:e2e` + relevant `pnpm test:*` verifiers before push.

## 7. Files touched (estimate)

- `src/lib/ai/notice.ts` -> generalize (or add `src/lib/upsell/cta.ts`)
- `src/lib/upsell/` (new pure module: cta + nudge gating + slots)
- `src/lib/hooks/use-ai-access.ts` (notice-url hook generalized per slot)
- `src/app/api/ai-notice/route.ts` (slot-aware)
- `src/components/minutia/ai-unavailable-notice.tsx` (import path only)
- `src/components/minutia/capacity-nudge.tsx` (new)
- `src/app/(app)/dashboard/page.tsx` (FAB/counter wiring; SeriesWidget + DecisionsWidget caps)
- `src/components/minutia/date-anchored-timeline.tsx` (`ISSUE_PREVIEW_LIMIT` 5 -> 2)
- `src/components/ui/card.tsx` (remove ring, add shadow)
- `src/app/globals.css` (elevation tokens)
- `scripts/verify-*.test.mjs` (+ new upsell verifier), `e2e/regression/*`
- `README.md` (+ screenshot assets)

## 8. Second-order risks

- Removing the ring app-wide touches every card surface: verify dark mode and the
  accent-highlighted brief card still read correctly (the brief card has its own
  `border-color`/`box-shadow` accent treatment in `globals.css` lines ~214-215; confirm it
  composes with the new shadow rather than fighting it).
- `ISSUE_PREVIEW_LIMIT` is also referenced by the "Show all N items" copy; lowering to 2
  must keep that affordance correct (grep all references).
- Generalizing `ai_notice_url` must not break the existing `/api/ai-notice` contract or the
  retro/suggestion gating; keep the wrapper and re-run the AI-access E2E.
- Dashboard caps must not hide data with no way to reach it (always provide expand/View all).
