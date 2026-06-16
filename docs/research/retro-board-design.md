# Minutia Retro: Design System (design.md)

Handoff spec for a design agent (Stitch / claude design). Self-contained. OKLCH is canonical (matches the Minutia codebase); hex values are approximate fallbacks for tools that need them.

---

## Brand & mood

**Name:** Minutia Retro. **Soul: "The Studio After Dark."**

The live retro is Minutia's daylight editorial world at night: a calm, focused dark room where a team can be honest. Warm paper cards glow like physical sticky notes on a dark desk. A single warm vermilion accent carries energy, the timer, votes, and the act of committing. The two signature moments, The Reveal (all cards flip up at once) and The Close (decisions seal and bloom), are bursts of light against the quiet.

**Adjectives:** calm, candid, tactile, cinematic, premium, alive. **Not:** corporate, sterile, slack-blue, garish-sticky-rainbow, whiteboard-chaotic.

**Modes:** Dark "Studio" is the hero for the live session. Light "Daylight" exists for async boards, embeds, and summary export.

## Design principles
1. **Opinionated ritual, not a blank canvas.** The board guides a 7-phase arc; the UI changes character per phase.
2. **Cards are physical objects.** They lift, cast warm shadows, drop with a spring, flip with weight.
3. **One accent, used with restraint.** Vermilion means energy/live/commit. Everything else is paper and ink.
4. **Delight is choreographed, not sprinkled.** Two big moments (Reveal, Close) earn the spotlight; everything else stays quiet.
5. **Calm color.** Author/column colors are desaturated paper pastels in one lightness band, so a full board stays serene.

---

## Color

### Studio (dark, hero)
| Token | OKLCH | ~Hex | Use |
|---|---|---|---|
| `studio-void` | `0.16 0.008 70` | `#1a1815` | Room background (warm charcoal, not cold slate) |
| `studio-surface` | `0.20 0.010 70` | `#221f1c` | Rails, columns, panels |
| `studio-raised` | `0.245 0.010 70` | `#2a2723` | Toolbar, popovers, menus |
| `studio-line` | `0.30 0.008 70` | `#34302c` | Hairlines |
| `studio-line-2` | `0.38 0.008 70` | `#443f3a` | Stronger dividers, inputs |
| `studio-ink` | `0.95 0.004 70` | `#f3f1ee` | Primary text on dark |
| `studio-ink-2` | `0.78 0.006 70` | `#c2bdb7` | Secondary text |
| `studio-ink-3` | `0.62 0.006 70` | `#918c86` | Tertiary / placeholder |

### Paper (cards)
| Token | OKLCH | ~Hex | Use |
|---|---|---|---|
| `paper` | `0.94 0.012 85` | `#f0ece1` | Default card |
| `card-ink` | `0.22 0.010 70` | `#262320` | Text on paper cards |

### Card / author / presence palette (desaturated paper pastels, one lightness band)
| Token | OKLCH | ~Hex |
|---|---|---|
| `c-amber` | `0.90 0.060 75` | `#f2dcae` |
| `c-rose` | `0.88 0.055 25` | `#f4cdc2` |
| `c-sage` | `0.89 0.048 150` | `#cfe5cd` |
| `c-sky` | `0.89 0.045 235` | `#cde2ef` |
| `c-lilac` | `0.88 0.050 300` | `#e3d4ee` |
| `c-sand` | `0.92 0.028 90` | `#ebe3d1` |

One pastel per participant = their identity color (card tint, cursor, avatar ring).

### Accent (energy / live / commit) and semantic
| Token | OKLCH (dark) | ~Hex | OKLCH (light) | Use |
|---|---|---|---|---|
| `accent` | `0.68 0.205 35` | `#e9623c` | `0.490 0.220 35` (`#bb401d`) | Timer, votes, commit, active phase |
| `accent-bright` | `0.745 0.210 35` | `#f87a4e` | | Hover, reveal flash |
| `accent-deep` | `0.58 0.200 35` | `#cd4e2c` | | Pressed |
| `accent-soft` | `0.30 0.060 35` | `#482b22` | | Tinted fills on dark |
| `success` | `0.62 0.130 155` | `#429f6f` | | Done, resolved |
| `warn` | `0.62 0.140 85` | `#ad8528` | | Aging / due soon |
| `danger` | `0.60 0.165 25` | `#cd4f3e` | | Overdue / destructive |

### Daylight (light) overrides
`studio-void #f9f9f9` · `studio-surface #efefef` · `studio-raised #ffffff` · `studio-line #e3e3e3` · `studio-ink #0d0d0d` · `paper #fcfaf4` · `card-ink #1c1a17` · `accent #bb401d`. Card pastels, semantic, type, spacing, radius, and motion inherit unchanged.

---

## Typography

Family (carried from Minutia for funnel continuity):
- **Fraunces** (serif, high-contrast old-style): ritual headlines, phase names, column titles. Gives the ritual gravitas and soul.
- **Satoshi** (geometric sans): UI, body, card text.
- **JetBrains Mono** (tabular-nums): timer, vote counts, card metadata. Numbers feel instrument-like.

| Token | Size | Font | Notes |
|---|---|---|---|
| `text-phase` | `clamp(2.5rem, 5vw, 4rem)` | Fraunces | "Reflect", "The Reveal"; leading 1.1 |
| `text-display` | `clamp(1.5rem, 2.5vw, 2rem)` | Fraunces | Section / column header |
| `text-title` | `1.125rem` | Satoshi 600 | Card group titles, dialog titles |
| `text-body` | `1rem` | Satoshi 400 | Body, leading 1.5 |
| `text-card` | `0.9375rem` | Satoshi 400 | Card content |
| `text-label` | `0.75rem` | Satoshi 500 | Uppercase, tracking 0.08em |
| `text-mono` | `0.875rem` | JetBrains Mono | tabular-nums |

---

## Spacing, radius, elevation

**Space (4px base):** 1=4 · 2=8 · 3=12 · 4=16 · 5=20 · 6=24 · 8=32 · 10=40 · 12=48 · 16=64 · 20=80.

**Radius:** chip 8 · control 10 · card 14 · panel 18 · pill 9999. Cards use the soft sticky-note 14px.

**Elevation (warm, layered: paper lifting off a dark desk, with a top rim-light):**
- `lift-1`: `0 1px 2px rgb(0 0 0 / 0.30)`
- `lift-card`: `inset 0 1px 0 rgb(255 255 255 / 0.10), 0 2px 4px rgb(0 0 0 / 0.30), 0 12px 28px rgb(0 0 0 / 0.45)`
- `lift-drag`: `inset 0 1px 0 rgb(255 255 255 / 0.14), 0 18px 48px rgb(0 0 0 / 0.55), 0 0 0 1px rgb(233 98 60 / 0.40)`
- `lift-panel`: `0 24px 64px rgb(0 0 0 / 0.50)`
- `glow-accent`: `0 0 0 1px rgb(233 98 60 / 0.50), 0 0 24px rgb(233 98 60 / 0.35)`
- `glow-reveal`: `0 0 40px rgb(248 122 78 / 0.45)` (flip flash + closure bloom)

---

## Motion (the soul of the ritual)

**Easing:** `ease-out cubic-bezier(0.2,0.8,0.2,1)` (matches Minutia) · `ease-spring cubic-bezier(0.34,1.56,0.64,1)` (card drops/flips, slight overshoot) · `ease-in-out cubic-bezier(0.4,0,0.2,1)`.

**Duration:** instant 90 · fast 140 · base 200 · slow 360 · ritual 600 (single card flip) · grand 900 (closure bloom). `stagger-card 40ms` per card in the reveal cascade.

**Named beats:**
- **card-drop**: `ease-spring`, `base`. Lands with tiny overshoot + `lift-card`.
- **the-reveal**: per-card `rotateY(180deg -> 0)` over `ritual`, cascade by `stagger-card` (center-out or left-to-right), one-frame `glow-reveal` flash as each lands, optional soft chord. Reduced-motion -> staggered crossfade.
- **vote-fill**: bar fills with `accent`, `ease-out`, count ticks in mono.
- **presence-pop**: avatar springs in with its pastel identity ring; live cursor shares the color.
- **commit / closure-bloom**: action item seals with `glow-accent`, then a single `grand` `glow-reveal` bloom across the board. The screenshot moment and the funnel handoff.

**Sound (off by default, a real delight lever):** three micro-cues, card-place tick, reveal whoosh/chord, commit click.

**Texture:** faint paper grain on cards; a barely-there warm radial behind the active spotlight in the void to avoid flat banding. Respect `prefers-reduced-motion` (zero all durations, as Minutia already does).

---

## Components (character notes)
- **Card:** paper fill (author pastel), `card-ink` text, `r-card`, `lift-card`. Face-down state during Reflect (back texture, no content). Hover lifts slightly; drag uses `lift-drag`.
- **Column:** `studio-surface`, Fraunces `text-display` header, subtle `studio-line` divider, card count in mono.
- **Carryover rail ("Still open"):** left rail, `studio-raised`, each item shows age in `warn` when aging, `success` closure beat when marked done.
- **Phase bar (top):** current phase in Fraunces, mono timer, accent on active phase, facilitator-only advance control.
- **Vote dot / tally:** accent dot, live filling bar, mono count.
- **Presence:** avatar stack with pastel rings; one live cursor per remote user in their pastel.
- **Commit panel:** action item rows (text + owner avatar + due), seal animation, then the Minutia nudge card.
- **The nudge:** a calm card, not a modal wall. "Keep these alive in Minutia so your next retro starts with what's still open." One primary accent button, a quiet "just export markdown" secondary.

---

## Screens to design (priority order)
1. **Live board, mid-session, Studio (dark).** THE hero frame. Left "Still open" carryover rail, 3 columns of glowing pastel cards, presence avatars + one live cursor top-right, mono timer + current phase ("Theme") center-top in Fraunces, accent on active phase. Establishes the entire language.
2. **The Reveal (transition state).** Cards mid-flip cascade, `glow-reveal` flashes.
3. **Lobby / join.** Guest name entry, presence assembling, optional mood pulse, the calm before.
4. **Vote phase.** Dot voting, bars filling live.
5. **Commit / Close + the Minutia nudge.** Actions sealing, closure bloom, the disguised-funnel card.
6. **Create / template picker.** Mad-Sad-Glad / Start-Stop-Continue / 4Ls / "What's still on fire", vibe set, instant share link.
7. **Daylight (light) variant** of the live board for async/embed.
