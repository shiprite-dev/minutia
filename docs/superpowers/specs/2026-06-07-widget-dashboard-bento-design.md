# Widget Dashboard: replace GridStack with a dnd-kit + CSS Grid bento

Date: 2026-06-07
Branch: `fix/widget-canvas-sizing`
Status: approved (design), implementation pending

## Problem

The OIL Board dashboard widgets clip their content. On `main` (GridStack, fixed
row heights) every card is given `h * cellHeight` pixels; content taller than
that is hidden behind an internal scrollbar, and shorter content leaves dead
space. The "morning fix" (`sizeToContent: true`) made it worse: every widget
collapsed to one 86px row with content clipped underneath.

## Root cause (proven against gridstack 12.6.0 source)

`GridStack.resizeToContent` measures `.grid-stack-item-content`'s
`firstElementChild` and assumes a single content child (gridstack.js dist lines
1502, 1554-1560). In `widget-shell.tsx` the first child is the **absolute-
positioned action toolbar** (~24px), not the body. So GridStack sizes every
widget to ~1 row and `overflow: hidden` clips the real content. GridStack also
has no per-widget content observer (its only `ResizeObserver` watches the grid
element for width/column changes), so it never re-measures when React Query
content loads or when filters change item counts.

This is a model mismatch, not a one-line bug: fixed-row grids treat
content-hugging as a fragile, bolted-on feature. react-grid-layout has the same
`rowHeight` limitation, so switching to it would not fix the problem.

## Decision

Drop GridStack. Use **dnd-kit (already a dependency) + CSS Grid** for a
content-driven bento. This deletes the entire measurement/clipping bug class:
row heights come from content via the browser's own layout engine, with no JS
measurement of widget height.

## Data model

Replace the GridStack `layout: {x,y,w,h}` per widget with a footprint:

```ts
interface WidgetInstance {
  id: string;
  type: string;
  colSpan: 1 | 2 | 3 | 4; // width in the 4-col desktop grid
  rowSpan: number;        // number of row bands the card occupies (default 1)
}
```

Order = array position (what dnd-kit reorders). Persisted in the existing
Zustand `minutia-widgets` store, bumped to **version 3**, with a `migrate` that
discards stale GridStack `layout`/`x`/`y`/`w`/`h` and `span`, seeding per-type
defaults from the registry. localStorage key unchanged.

`getWidgetLayout`, `getWidgetMinHeight`, `syncLayouts`, `isDesktopLayout`, and
the `DEFAULT_LAYOUTS`/`DEFAULT_SIZES`/`NARROW_HEIGHTS` tables are GridStack-only
and get removed/replaced by a small `getWidgetFootprint(type)` helper.

## Layout

Desktop = 4-column CSS Grid (the current 12-col defaults ÷ 3). Row tracks are
content-sized; `align-items: stretch` makes cards in a band share the band
height, so a short card beside a tall one matches height (aligned, not ragged).
Multi-row cards span bands via `grid-row: span rowSpan` and auto-align with
stacked single-row neighbors (the user's bento mockup).

Default footprints:

| widget       | colSpan | rowSpan |
|--------------|---------|---------|
| hero         | 2       | 1       |
| next-meeting | 1       | 1       |
| series       | 1       | 1       |
| outstanding  | 4       | 1 (content) |
| decisions    | 1       | 1       |
| age          | 1       | 1       |
| stale-items  | 1       | 1       |
| series-health| 2       | 1       |
| meeting-triage| 2      | 1       |
| workload     | 2       | 1       |

CSS contract: `.grid-stack`-style classes and all gridstack CSS in `globals.css`
are removed. The card body has **no** `overflow: hidden` and **no** fixed
height; content defines height.

Tradeoff (accepted): a short card shares its band's height, carrying some bottom
whitespace. This is the deliberate aligned/premium look and is strictly better
than clipping. Mitigated by grouping similar-density widgets and top-aligning
content with comfortable padding.

## Controls & behavior

- Reorder: dnd-kit `SortableContext` (rect sorting) + the existing drag handle;
  `moveWidget(from,to)` already exists.
- Resize: existing width toggle cycles `colSpan` (1 <-> 2); outstanding stays
  colSpan 4 and locked.
- Add/remove: existing "Add widget" + per-card remove, unchanged.
- Responsive: 4 -> 2 -> 1 columns; spans clamp to the available column count;
  mobile = single full-width column in array order.
- a11y/motion: keyboard sortable sensor; reduced-motion respected; the gridstack
  `gs-*` attributes and imperative `makeWidget` lifecycle are gone.

## Dependencies

Remove `gridstack` from package.json and all imports. Confirm `@dnd-kit/core`,
`@dnd-kit/sortable`, `@dnd-kit/utilities` present (used elsewhere per CLAUDE.md).

## Testing strategy (TDD, includes visual)

1. Store unit/contract: `getWidgetFootprint` defaults, v2->v3 migration drops
   GridStack fields, `toggleSpan` flips colSpan, `moveWidget` reorders.
2. E2E (`widgets.spec.ts`, rewritten): canvas renders, each widget has correct
   `data-col-span`, reorder via keyboard changes order, width toggle changes
   span, add/remove works.
3. **Visual / clipping (the real gate):** at 1440x1200 authenticated, assert no
   `.widget-card-content` has `scrollHeight > clientHeight + 1` (nothing
   clipped), and capture a full-page screenshot for human review at the bug
   viewport. Replace the misleading `widget-canvas-sizing.component.spec.ts`
   (it gave a false positive by not reproducing the real DOM).
4. Run full `pnpm test:e2e` before PR.

Each red/green step is verified both by assertion and by an eyeballed screenshot
of the live dashboard.

## Out of scope

Free-form pixel resize, arbitrary 2D drag placement, native CSS
`grid-template-rows: masonry` (not broadly supported in 2026).
