"use client";

import * as React from "react";
import type {
  RetroSnapshot,
  RetroPhase,
  RetroCarry,
  PastelColor,
} from "@/lib/retro/types";
import {
  useRetroSnapshot,
  useRetroChannel,
  useRetroRpc,
} from "@/lib/hooks/use-retro";
import {
  participantKey,
  facilitatorToken,
  savedName,
  rememberName,
  savedColor,
} from "@/lib/retro/local-identity";
import { remainingVotes } from "@/lib/retro/vote-budget";
import { templateById } from "@/lib/retro/templates";
import { Board } from "@/components/retro/Board";
import { Lobby } from "@/components/retro/Lobby";
import { CommitPanel } from "@/components/retro/CommitPanel";
import { Spotlight } from "@/components/retro/Spotlight";
import { CardEditor } from "@/components/retro/CardEditor";
import { ShareInvite } from "@/components/retro/ShareInvite";
import { PhaseBar } from "@/components/retro/PhaseBar";
import { PresenceStack } from "@/components/retro/PresenceStack";
import { Switch } from "@/components/retro/Switch";
import { Button } from "@/components/retro/Button";
import { Icons } from "@/components/retro/icons";

const PHASES: RetroPhase[] = ["lobby", "reflect", "reveal", "theme", "vote", "discuss", "commit"];
const PHASE_LABELS = ["Lobby", "Reflect", "Reveal", "Theme", "Vote", "Discuss", "Commit"];

type Me = { key: string; name: string; color: PastelColor };

export function RetroClient({
  token,
  initialSnapshot,
}: {
  token: string;
  initialSnapshot: RetroSnapshot;
}) {
  const { data } = useRetroSnapshot(token, initialSnapshot);
  const snapshot = data ?? initialSnapshot;
  const board = snapshot.board;
  const phase = board.phase;
  const phaseIdx = PHASES.indexOf(phase === "closed" ? "commit" : phase);

  const [me, setMe] = React.useState<Me | null>(null);
  const [ftoken, setFtoken] = React.useState<string | null>(null);
  const [theme, setTheme] = React.useState<"studio" | "daylight">("studio");
  const [sound, setSound] = React.useState(false);
  const [people, setPeople] = React.useState(snapshot.participants);
  const [revealed, setRevealed] = React.useState<Set<string>>(() => new Set());
  const [myVotes, setMyVotes] = React.useState<Set<string>>(() => new Set());
  const [carryDone, setCarryDone] = React.useState<Record<string, boolean>>({});
  const [editor, setEditor] = React.useState<{ open: boolean; mode: "add" | "edit"; colId: string | null; cardId: string | null }>({ open: false, mode: "add", colId: null, cardId: null });
  const [showShare, setShowShare] = React.useState(false);
  const [spotIndex, setSpotIndex] = React.useState(0);
  const [sealed, setSealed] = React.useState(false);
  const [bloom, setBloom] = React.useState(false);
  const [now, setNow] = React.useState(0);

  // Anonymous identity (localStorage, client-only).
  React.useEffect(() => {
    setMe({ key: participantKey(token), name: savedName(), color: (savedColor() || "sky") as PastelColor });
    setFtoken(facilitatorToken(token));
  }, [token]);

  const presenceMe = React.useMemo(
    () => ({ participant_key: me?.key ?? "", name: me?.name || "Guest", color: me?.color ?? "sky", is_facilitator: !!ftoken }),
    [me?.key, me?.name, me?.color, ftoken]
  );
  const { broadcast } = useRetroChannel(token, board.id, presenceMe, setPeople);
  const rpc = useRetroRpc(token, broadcast);

  // The Reveal cascade: flip every card, staggered, when the room enters reveal.
  React.useEffect(() => {
    if (phase !== "reveal") return;
    setRevealed(new Set());
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = reduce ? 0 : 90;
    const ids = snapshot.cards.map((c) => c.id);
    const timers = ids.map((id, i) =>
      window.setTimeout(() => setRevealed((prev) => new Set(prev).add(id)), 250 + i * step)
    );
    return () => timers.forEach(clearTimeout);
  }, [phase, snapshot.cards]);

  // Live phase timer (count-up from phase_started_at).
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const isFacilitator = !!ftoken;
  const myParticipant = me ? snapshot.participants.find((p) => p.participant_key === me.key) : undefined;
  const needsJoin = !!me && (!myParticipant || !myParticipant.name);
  const columns = board.columns;
  const template = templateById(board.template);
  const shareLink = typeof window !== "undefined" ? `${window.location.origin}/retro/${token}` : "";

  const timer = React.useMemo(() => {
    if (!board.phase_started_at) return null;
    const start = new Date(board.phase_started_at).getTime();
    const secs = Math.max(0, Math.floor((now - start) / 1000));
    const m = String(Math.floor(secs / 60)).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    return `${m}:${s}`;
  }, [board.phase_started_at, now]);

  // Top themes for the Discuss spotlight, by votes desc.
  const topThemes = React.useMemo(
    () =>
      [...snapshot.cards]
        .map((c) => ({ id: c.id, text: c.text, color: c.color, author: c.author_name, count: snapshot.votes[c.id] ?? 0 }))
        .filter((c) => c.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3),
    [snapshot.cards, snapshot.votes]
  );

  // Facilitator: seed action drafts from the top-voted cards on entering Commit.
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (phase !== "commit" || !isFacilitator || !ftoken) return;
    if (seededRef.current || snapshot.actions.length > 0) return;
    seededRef.current = true;
    const seed = [...snapshot.cards]
      .map((c) => ({ c, count: snapshot.votes[c.id] ?? 0 }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    void Promise.all(
      seed.map((x) =>
        rpc("retro_add_action", { p_ftoken: ftoken, p_text: x.c.text, p_owner: "", p_due: "", p_color: x.c.color, p_source: x.c.id }, { t: "action.changed" })
      )
    );
  }, [phase, isFacilitator, ftoken, snapshot.actions.length, snapshot.cards, snapshot.votes, rpc]);

  function advance() {
    const next = PHASES[phaseIdx + 1];
    if (next && ftoken) void rpc("retro_set_phase", { p_ftoken: ftoken, p_phase: next }, { t: "phase.changed", phase: next });
  }

  function join(name: string) {
    if (!me) return;
    const clean = name.trim() || "Guest";
    rememberName(clean);
    setMe({ ...me, name: clean });
    void rpc("retro_join", { p_token: token, p_key: me.key, p_name: clean, p_color: me.color });
  }

  function saveCard(text: string, color: PastelColor) {
    if (!me) return;
    if (editor.mode === "add" && editor.colId) {
      void rpc("retro_add_card", { p_token: token, p_key: me.key, p_column: editor.colId, p_text: text, p_color: color }, { t: "card.added", key: me.key });
    } else if (editor.mode === "edit" && editor.cardId) {
      void rpc("retro_update_card", { p_token: token, p_key: me.key, p_card: editor.cardId, p_text: text, p_color: color }, { t: "card.updated", key: me.key });
    }
    setEditor({ open: false, mode: "add", colId: null, cardId: null });
  }

  function deleteCard() {
    if (!me || !editor.cardId) return;
    void rpc("retro_delete_card", { p_token: token, p_key: me.key, p_card: editor.cardId }, { t: "card.deleted", key: me.key });
    setEditor({ open: false, mode: "add", colId: null, cardId: null });
  }

  function vote(cardId: string) {
    if (!me || remainingVotes(myVotes.size) <= 0) return;
    setMyVotes((prev) => new Set(prev).add(cardId));
    void rpc("retro_vote", { p_token: token, p_key: me.key, p_card: cardId, p_delta: 1 }, { t: "vote.changed", card_id: cardId });
  }

  function toggleCarry(id: string) {
    setCarryDone((prev) => ({ ...prev, [id]: !(prev[id] ?? false) }));
  }

  function seal() {
    setSealed(true);
    setBloom(true);
    window.setTimeout(() => setBloom(false), 1100);
  }

  const carry: RetroCarry[] = snapshot.carryover.map((c) => ({ ...c, done: carryDone[c.id] ?? c.done }));
  const editing = editor.cardId ? snapshot.cards.find((c) => c.id === editor.cardId) : null;
  const editorCol = columns.find((c) => c.id === editor.colId);

  if (!me) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--studio-ink-3)", fontFamily: "var(--font-sans)" }}>Loading…</div>;
  }

  const showLobby = needsJoin || phase === "lobby";
  const isCommit = phase === "commit" || phase === "closed";
  const isBoard = !showLobby && !isCommit;

  return (
    <div data-retro={theme} style={{ position: "relative", height: "100vh", display: "flex", flexDirection: "column", background: "var(--studio-void)", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 80% at 50% -10%, color-mix(in oklab, var(--accent) 7%, transparent), transparent 55%)" }} />

      {/* Top chrome */}
      <header style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", gap: 16, padding: "0 var(--space-6)", height: 56, borderBottom: "1px solid var(--studio-line)", background: "var(--studio-raised)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", boxShadow: "var(--glow-accent)" }} />
          <span style={{ fontFamily: "var(--font-serif)", fontSize: 17, fontWeight: 600, color: "var(--studio-ink)" }}>{board.name || "Minutia Retro"}</span>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 11px", borderRadius: "var(--r-pill)", background: "var(--studio-surface)", border: "1px solid var(--studio-line)", color: "var(--studio-ink-2)", fontFamily: "var(--font-sans)", fontSize: 12.5 }}>
          <span style={{ width: 7, height: 7, borderRadius: 2, background: "var(--c-rose)" }} />{template?.name ?? board.template}
        </span>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
          <button type="button" onClick={() => setShowShare(true)} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 32, padding: "0 12px", borderRadius: "var(--r-control)", cursor: "pointer", background: "var(--studio-surface)", border: "1px solid var(--studio-line-2)", color: "var(--studio-ink)", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 500 }}>
            <Icons.Link size={15} /> Share
          </button>
          <PresenceStack people={people.length ? people : snapshot.participants} max={5} size={30} />
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <Icons.Sun size={15} style={{ color: theme === "daylight" ? "var(--accent)" : "var(--studio-ink-3)" }} />
            <Switch checked={theme === "daylight"} onChange={(v) => setTheme(v ? "daylight" : "studio")} size="sm" />
            <Icons.Moon size={14} style={{ color: theme === "studio" ? "var(--studio-ink-2)" : "var(--studio-ink-3)" }} />
          </div>
          <button type="button" onClick={() => setSound((s) => !s)} aria-label="sound" style={{ display: "inline-flex", padding: 6, borderRadius: "var(--r-control)", cursor: "pointer", background: "transparent", border: "none", color: sound ? "var(--studio-ink-2)" : "var(--studio-ink-3)" }}>
            <Icons.Volume size={18} style={{ opacity: sound ? 1 : 0.4 }} />
          </button>
        </div>
      </header>

      {/* Phase bar */}
      <div style={{ position: "relative", zIndex: 2 }}>
        <PhaseBar phases={PHASE_LABELS} current={phaseIdx} timer={timer} isFacilitator={isFacilitator} onAdvance={advance} />
      </div>

      {/* Content */}
      <main style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0 }}>
        {showLobby && (
          <Lobby
            boardName={board.name}
            template={template?.name ?? board.template}
            people={people.length ? people : snapshot.participants}
            facilitatorName={me.name}
            theme={theme}
            onEnter={(name) => {
              join(name);
              if (isFacilitator && phase === "lobby") advance();
            }}
          />
        )}
        {isCommit && <CommitPanel actions={snapshot.actions} sealed={sealed} onSeal={seal} bloom={bloom} />}
        {isBoard && (
          <Board
            columns={columns}
            phase={PHASE_LABELS[phaseIdx]}
            revealedSet={revealed}
            votes={snapshot.votes}
            onVote={vote}
            carry={carry}
            onToggleCarry={toggleCarry}
            cards={snapshot.cards}
            onAddCardClick={(colId) => setEditor({ open: true, mode: "add", colId, cardId: null })}
            onEditCard={(cardId) => {
              const c = snapshot.cards.find((x) => x.id === cardId);
              if (c) setEditor({ open: true, mode: "edit", colId: c.column_id, cardId });
            }}
            me={me.key}
          />
        )}
        {phase === "discuss" && <Spotlight themes={topThemes} index={spotIndex} setIndex={setSpotIndex} />}
      </main>

      <CardEditor
        open={editor.open}
        mode={editor.mode}
        colTitle={editorCol?.title ?? ""}
        initialText={editing?.text ?? ""}
        initialColor={(editing?.color ?? me.color) as PastelColor}
        onSave={saveCard}
        onClose={() => setEditor({ open: false, mode: "add", colId: null, cardId: null })}
        onDelete={editor.mode === "edit" ? deleteCard : undefined}
      />
      <ShareInvite
        open={showShare}
        boardName={board.name}
        template={template ?? null}
        people={people.length ? people : snapshot.participants}
        link={shareLink}
        onClose={() => setShowShare(false)}
        onStart={() => {
          setShowShare(false);
          if (isFacilitator && phase === "lobby") advance();
        }}
      />
    </div>
  );
}
