"use client";

import * as React from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type {
  RetroSnapshot,
  RetroBroadcast,
  RetroParticipant,
} from "@/lib/retro/types";

export const retroKeys = {
  snapshot: (token: string) => ["retro", token] as const,
};

/** Authoritative board state via the snapshot RPC. Polls every 3s to reconcile
 * any broadcast event a peer missed (broadcast is best-effort, DB is truth). */
export function useRetroSnapshot(token: string, initialData?: RetroSnapshot) {
  const supabase = React.useMemo(() => createClient(), []);
  return useQuery<RetroSnapshot>({
    queryKey: retroKeys.snapshot(token),
    initialData,
    refetchInterval: 3000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("retro_snapshot", { p_token: token });
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
  onEvent?: (e: RetroBroadcast) => void
) {
  const qc = useQueryClient();
  const channelRef = React.useRef<RealtimeChannel | null>(null);
  // Keep the latest callbacks without re-subscribing the channel.
  const presenceCb = React.useRef(onPresence);
  const eventCb = React.useRef(onEvent);
  presenceCb.current = onPresence;
  eventCb.current = onEvent;

  React.useEffect(() => {
    if (!boardId) return;
    const supabase = createClient();
    const channel = supabase.channel(`retro:${boardId}`, {
      config: { presence: { key: me.participant_key } },
    });

    channel.on("broadcast", { event: "retro" }, (m) => {
      const payload = m.payload as RetroBroadcast;
      eventCb.current?.(payload);
      void qc.invalidateQueries({ queryKey: retroKeys.snapshot(token) });
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
    // Re-subscribe only when the board or our identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, me.participant_key, me.name, me.color, me.is_facilitator, token]);

  const broadcast = React.useCallback((payload: RetroBroadcast) => {
    void channelRef.current?.send({ type: "broadcast", event: "retro", payload });
  }, []);

  return { broadcast };
}

/** Thin RPC caller: runs the function, broadcasts the matching event so peers
 * update instantly, and refreshes our own snapshot. Throws on RPC error. */
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
      event?: RetroBroadcast
    ): Promise<unknown> => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw error;
      if (event) broadcast(event);
      void qc.invalidateQueries({ queryKey: retroKeys.snapshot(token) });
      return data;
    },
    [supabase, broadcast, qc, token]
  );
}
