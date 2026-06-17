import type { RetroSnapshot, RetroBroadcast, RetroCard, RetroPhase } from "./types";

// Defense-in-depth: never let another participant's card text reach a viewer's
// cache while the room is still in Reflect (peers must not see hidden cards).
// Card payloads are only broadcast post-Reflect, so this normally no-ops; it
// guards the cache boundary in case a future caller forgets that rule.
function redactForViewer(card: RetroCard, phase: RetroPhase, viewerKey: string | null): RetroCard {
  if (phase === "reflect" && card.author_key !== viewerKey) {
    return { ...card, text: "", author_name: "" };
  }
  return card;
}

/**
 * Pure snapshot reducer shared by the optimistic-writer path (instant local
 * feedback) and the peer broadcast path (apply without a DB round-trip).
 *
 * Returns the SAME reference when the event carries nothing the cache can apply
 * locally (no card payload, or an event that needs server data). Callers treat
 * an unchanged reference as the signal to fall back to a snapshot refetch.
 */
export function applyRetroEvent(
  snap: RetroSnapshot,
  e: RetroBroadcast,
  viewerKey: string | null
): RetroSnapshot {
  switch (e.t) {
    case "phase.changed":
      if (snap.board.phase === e.phase) return snap;
      return { ...snap, board: { ...snap.board, phase: e.phase } };

    case "vote.changed":
      return { ...snap, votes: { ...snap.votes, [e.card_id]: Math.max(0, e.count) } };

    case "card.deleted":
      if (!snap.cards.some((c) => c.id === e.card_id)) return snap;
      return { ...snap, cards: snap.cards.filter((c) => c.id !== e.card_id) };

    case "card.added": {
      if (!e.card) return snap;
      const card = redactForViewer(e.card, snap.board.phase, viewerKey);
      const exists = snap.cards.some((c) => c.id === card.id);
      return {
        ...snap,
        cards: exists
          ? snap.cards.map((c) => (c.id === card.id ? card : c))
          : [...snap.cards, card],
      };
    }

    case "card.updated": {
      if (!e.card) return snap;
      const card = redactForViewer(e.card, snap.board.phase, viewerKey);
      if (!snap.cards.some((c) => c.id === card.id)) return snap;
      return { ...snap, cards: snap.cards.map((c) => (c.id === card.id ? { ...c, ...card } : c)) };
    }

    default:
      // action.changed, carry.toggled: server-derived; caller refetches.
      return snap;
  }
}
