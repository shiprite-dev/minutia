# Minutia Retro: Free Collaborative Retro Board as a Funnel

**Status:** Product concept. Research + design handoff. Not scheduled.
**Date:** 2026-06-15
**Hats:** Research + Product Owner.
**Purpose:** A free, multiplayer retrospective board that is exceptional enough to spread on its own, and that graduates its output into Minutia. Customer acquisition that does not feel like it.

---

## 1. The insight

Every "best retro tool" roundup ranks features. The failure mode teams actually complain about is identical across all of them: **action items go to die.**

- Easy Agile usage data: teams complete only **40-50%** of retro action items. After shipping a feature that simply *surfaces incomplete actions from last time*, completion rose to **65%**.
- Coveros: missing/untracked action items are "the single biggest cause of ineffective retrospectives."

The board is not the problem. The board is solved (EasyRetro, Parabol, Neatro, Kollabe, RetroFlow all do columns + voting fine). **The loop between retros is the problem, and that loop is literally Minutia's data model.** A retro action item *is* an Outstanding Issue. We are not bolting a CTA onto a retro tool; we are giving the retro tool the one thing it structurally cannot have on its own: a persistent home for decisions, across every recurring meeting, not just the next retro.

### What already exists (so "never seen" survives contact with reality)
- **Memory between retros** exists (Echometer carries open measures forward) but it is paywalled and traps the items inside that one tool.
- **AI clustering / summaries** exist (Kollabe). AI grouping alone is table stakes now, not a differentiator.

### The under-served space (our two moats)
1. **The live retro as a *designed emotional ritual*.** These tools are functional and soulless. Nobody has made the 30-minute session itself feel crafted, with real delight beats. Pure design/craft win.
2. **Graduation instead of lock-in.** The free retro is a genuine gift (run it, export it, no signup). The *continuity* is Minutia. The funnel is the product narrative, not a popup.

---

## 2. The concept

**Working name:** Minutia Retro, on `retro.getminutia.com`. Alt names: Loop, Open Retro, Afterword.

**One line:** The only retro where the action items don't die. Free, instant, multiplayer. When you finish, your decisions graduate into a living issue log, so next time you'll actually know what got fixed.

### Three things that make it unlike anything in the category

**1. The Reveal (signature live moment).** During *Reflect*, everyone writes privately, cards face-down to others, a calm timer running. When the facilitator ends reflection, every card flips up **simultaneously** with a choreographed cascade and a soft sound. Not decoration: hiding cards until a synchronized reveal kills anchoring bias and groupthink (a real facilitation win). Also the shareable "whoa" that gets screenshotted. No free tool nails the theatrical simultaneous reveal.

**2. Living carryover (the hook).** A recurring retro *remembers*. Open action items from the last session ride at the top in a "Still open" rail, aged ("raised 2 retros ago"). Marking one done triggers a closure beat. Turns the retro from venting into visible progress, the dopamine the category is missing.

**3. Graduation, not lock-in (the disguised funnel).** At *Commit*, voted themes crystallize into action items with owner + due date. The nudge: *"Keep these alive in Minutia so your next retro starts with what's still open."* One tap seeds a Minutia workspace/series with these as tracked issues. Conversion at peak value, read as a gift not a gate. Markdown/clipboard export stays free forever, so there is no resentment.

### The flow (a guided ritual, not a blank board)

Everyone's screen advances together; the facilitator runs a shared stage. That synchronized feeling is rare and is part of the magic.

0. **Create** (no login): pick a template (Mad/Sad/Glad, Start/Stop/Continue, 4Ls, or a Minutia "What's still on fire" seeded from carryover), get a share link instantly, set a vibe.
1. **Lobby**: guests join with a name only; presence avatars assemble; optional one-tap mood pulse tints the room.
2. **Reflect** (private, timed): focus mode, your cards only, hidden from others.
3. **The Reveal**: simultaneous flip cascade.
4. **Theme**: drag to cluster; AI *suggests* groupings ("3 cards about deploys"), never auto-merges.
5. **Vote**: dot voting, bars fill live.
6. **Discuss**: top themes spotlight one at a time, timed, decisions/actions captured inline.
7. **Commit / Close**: actions crystallize (owner + due), closure bloom, then the Minutia nudge. Free summary export regardless.

### What we deliberately do NOT build (stay exceptional, not bloated)
- No generic infinite whiteboard. One opinionated, beautiful flow.
- 3-4 great templates, not a library of 40.
- No Jira/Linear/Slack integrations at launch. **Minutia is the integration.** Markdown export is the free escape hatch.
- No team-health radar / analytics v1 (later paid Minutia surface).
- Browser-only. No native app.

---

## 3. Threat model + performance budget (designed in, not retrofitted)

- A public, no-auth, realtime board is an abuse surface. Board = capability token (reuse Minutia's existing anon share-token + RLS pattern). Rate-limit card creation per session/IP; cap cards/participants per board; ephemeral boards auto-expire (~30 days) unless saved to Minutia. Escape all card text (XSS). Length/size caps on input.
- The guest->auth boundary at "save to Minutia" is the sensitive seam: seeded issues are owned by the converting user's new workspace, server-side; never trust client-claimed ownership.
- Budgets: 60fps card drag; reveal animation GPU-composited (transform/opacity only); presence cursors throttled (~20-30Hz, coalesced); board cold render < 1.5s; smooth at ~12 concurrent users / ~80 cards. Realtime via Supabase broadcast + presence (already in stack).

---

## 4. Design direction

Full design system and screen specs live in `retro-board-design.md` (Stitch-ready) with machine-readable tokens in `retro-board-tokens.json`.

**Design soul: "The Studio After Dark."** Minutia's existing identity is daylight editorial: warm paper, ink, a Fraunces serif, and a confident warm vermilion accent (OKLCH hue 35), already distinctive and nothing like the cold-slate-indigo sea every competitor swims in. The live retro is *the same world at night*: a calm, focused dark room where warm paper cards glow like physical sticky notes on a dark desk, vermilion is the energy/commit color, and the Reveal and Close are bursts of light. Dark is the hero for the live session (presence, cursors, spotlight, and the flip all read better on dark, and it differentiates instantly). A "Daylight" light mode exists for async/embed. Keeps the funnel handoff seamless: retro and Minutia feel like one family.

---

## 5. Open questions for build time
- Name + domain lock (`retro.getminutia.com` vs standalone brand).
- Carryover requires a recurring retro identity; how does that map to a Minutia series before signup? (Likely: anonymous board can be "claimed" into a series at Commit.)
- STT/AI clustering: reuse existing OpenRouter pipeline (`src/lib/ai/openrouter.ts`) for theme suggestion.
- Realtime cost at scale: Supabase Realtime quotas for many concurrent ephemeral boards.

---

## Sources
- Easy Agile, retro action-item follow-through: https://www.easyagile.com/blog/improve-sprint-retrospective-action-items
- Coveros, retrospectives without action items: https://www.coveros.com/blog/retrospectives-without-action-items-means-nothing-gets-done/
- Echometer, carrying open measures forward: https://echometerapp.com/en/retro-action-items/
- Neatro, free retro tools 2026: https://www.neatro.io/blog/free-retrospective-tools/
- RetroFlow, free tool comparison 2026: https://retroflow.org/blog/post/free-retrospective-tools
