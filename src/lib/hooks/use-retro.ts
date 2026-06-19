"use client";

import * as React from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { applyRetroEvent } from "@/lib/retro/apply-event";
import type {
  RetroSnapshot,
  RetroBroadcast,
  RetroParticipant,
} from "@/lib/retro/types";

export const retroKeys = {
  snapshot: (token: string) => ["retro", token] as const,
};

/** Authoritative board state via the snapshot RPC. Polls every 3s to reconcile
 * any broadcast event a peer missed (broadcast is best-effort, DB is truth).
 * Passing the caller's participant key resolves `my_votes` and unredacts the
 * caller's own cards during the Reflect phase. The key is part of the query key
 * so the query refetches once identity resolves client-side; invalidations use
 * the token-only prefix (`retroKeys.snapshot`) which matches by prefix. */
export function useRetroSnapshot(token: string, meKey?: string, initialData?: RetroSnapshot) {
  const supabase = React.useMemo(() => createClient(), []);
  return useQuery<RetroSnapshot>({
    queryKey: [...retroKeys.snapshot(token), meKey ?? null],
    initialData,
    // Poll every 3s while live; stop once the board is ended (frozen). Reading the
    // query's own data avoids a chicken-and-egg with a derived `ended` flag, and
    // also halts the poll for peers whose board ends mid-session.
    refetchInterval: (query) => (query.state.data?.board?.ended_at ? false : 3000),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("retro_snapshot", { p_token: token, p_key: meKey ?? null });
      if (error) throw error;
      return data as RetroSnapshot;
    },
  });
}

type PresenceMeta = {
  participant_key: string;
  name: string;
  color: string;
  is_facilitator: boolean;
};

/**
 * Broadcast + presence on `retro:{boardId}`. Returns a `broadcast` fn to push
 * events to peers, and feeds live presence back through `onPresence`. Incoming
 * broadcast events invalidate the snapshot query for an instant peer update.
 */
export function useRetroChannel(
  token: string,
  boardId: string,
  me: PresenceMeta,
  onPresence: (people: RetroParticipant[]) => void,
  onEvent?: (e: RetroBroadcast) => void,
  enabled = true
) {
  const qc = useQueryClient();
  const channelRef = React.useRef<RealtimeChannel | null>(null);
  // Keep the latest callbacks without re-subscribing the channel.
  const presenceCb = React.useRef(onPresence);
  const eventCb = React.useRef(onEvent);
  React.useEffect(() => {
    presenceCb.current = onPresence;
    eventCb.current = onEvent;
  });

  React.useEffect(() => {
    if (!enabled || !boardId || !me.participant_key) return;
    const supabase = createClient();
    const channel = supabase.channel(`retro:${boardId}`, {
      config: { presence: { key: me.participant_key } },
    });

    channel.on("broadcast", { event: "retro" }, (m) => {
      // broadcast.self defaults to false, so this only fires for OTHER clients;
      // the sender already applied its own change optimistically in useRetroRpc.
      const payload = m.payload as RetroBroadcast;
      eventCb.current?.(payload);
      // Apply the event straight to the cache (no DB round-trip) when it carries
      // enough data; otherwise fall back to a refetch. applyRetroEvent returns
      // the same reference when it cannot resolve the event locally.
      let applied = false;
      qc.setQueriesData<RetroSnapshot>({ queryKey: retroKeys.snapshot(token) }, (prev) => {
        if (!prev) return prev;
        const next = applyRetroEvent(prev, payload, me.participant_key);
        if (next !== prev) applied = true;
        return next;
      });
      if (!applied) void qc.invalidateQueries({ queryKey: retroKeys.snapshot(token) });
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<PresenceMeta>();
      const people = Object.values(state)
        .map((metas) => metas[0])
        .filter(Boolean)
        .map((p) => ({
          participant_key: p.participant_key,
          name: p.name,
          color: p.color as RetroParticipant["color"],
          is_facilitator: p.is_facilitator,
        }));
      presenceCb.current(people);
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") await channel.track(me);
    });

    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
    // Re-subscribe only when the board or our identity changes. Flipping `enabled`
    // false (board ended) runs the cleanup above, tearing down presence/broadcast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, me.participant_key, me.name, me.color, me.is_facilitator, token, enabled]);

  const broadcast = React.useCallback((payload: RetroBroadcast) => {
    void channelRef.current?.send({ type: "broadcast", event: "retro", payload });
  }, []);

  return { broadcast };
}

export type RetroRpcOptions = {
  /** Patch the local snapshot immediately for instant feedback, before the RPC
   *  resolves. The trailing refetch reconciles (and rolls back on error). */
  optimistic?: (snap: RetroSnapshot) => RetroSnapshot;
  /** Build the broadcast event from the RPC result (e.g. the inserted card or
   *  authoritative vote count) so peers apply it without a round-trip. */
  event?: (data: unknown) => RetroBroadcast | null;
};

/** Thin RPC caller: optimistically patches our own cache, runs the function,
 * broadcasts the matching event so peers update instantly, and refreshes the
 * snapshot to reconcile. Throws on RPC error (and refetches to roll back). */
export function useRetroRpc(
  token: string,
  broadcast: (e: RetroBroadcast) => void
) {
  const qc = useQueryClient();
  const supabase = React.useMemo(() => createClient(), []);
  return React.useCallback(
    async (
      fn: string,
      args: Record<string, unknown>,
      opts?: RetroRpcOptions
    ): Promise<unknown> => {
      const optimistic = opts?.optimistic;
      if (optimistic) {
        qc.setQueriesData<RetroSnapshot>({ queryKey: retroKeys.snapshot(token) }, (prev) =>
          prev ? optimistic(prev) : prev
        );
      }
      const { data, error } = await supabase.rpc(fn, args);
      if (error) {
        // Discard the optimistic patch by pulling authoritative truth.
        void qc.invalidateQueries({ queryKey: retroKeys.snapshot(token) });
        throw error;
      }
      const event = opts?.event?.(data);
      if (event) broadcast(event);
      void qc.invalidateQueries({ queryKey: retroKeys.snapshot(token) });
      return data;
    },
    [supabase, broadcast, qc, token]
  );
}
