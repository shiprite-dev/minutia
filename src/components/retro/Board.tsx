"use client";

import React from "react";
import type { RetroCard as RetroCardData, RetroColumn, RetroCarry, RetroPhase } from "@/lib/retro/types";
import { RetroCard } from "./RetroCard";
import { VoteTally } from "./VoteTally";
import { CarryoverItem } from "./CarryoverItem";
import { Badge } from "./Badge";
import { Icons } from "./icons";

function tiltFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000 - 0.5) * 1.2;
}

function AddCard({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button type="button" onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "12px 14px", cursor: "pointer",
        borderRadius: "var(--r-card)", border: "1.5px dashed " + (hover ? "var(--accent)" : "var(--studio-line-2)"),
        background: hover ? "var(--accent-soft)" : "transparent", color: hover ? "var(--accent-bright)" : "var(--studio-ink-3)",
        fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 500, transition: "all var(--dur-fast) var(--ease-out)" }}>
      <Icons.Plus size={17} /> Add a card
    </button>
  );
}

function EmptyColumn() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "26px 14px", textAlign: "center",
      borderRadius: "var(--r-card)", border: "1px dashed var(--studio-line)", color: "var(--studio-ink-3)" }}>
      <Icons.EyeOff size={18} />
      <span style={{ fontFamily: "var(--font-sans)", fontSize: 12.5 }}>Nothing here this time</span>
    </div>
  );
}

function EmptyNote({ icon, title, body, tone }: { icon: React.ReactNode; title: string; body: string; tone?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "20px 14px", borderRadius: "var(--r-control)",
      border: "1px dashed var(--studio-line)", textAlign: "left" }}>
      <span style={{ color: tone === "success" ? "var(--success)" : "var(--studio-ink-3)" }}>{icon}</span>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 600, color: "var(--studio-ink)" }}>{title}</span>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, lineHeight: 1.45, color: "var(--studio-ink-3)" }}>{body}</span>
    </div>
  );
}

export interface BoardProps {
  columns: RetroColumn[];
  phase: RetroPhase;
  revealedSet: Set<string>;
  revealComplete: boolean;
  votes: Record<string, number>;
  onVote: (cardId: string) => void;
  carry: RetroCarry[];
  onToggleCarry: (id: string) => void;
  cards: RetroCardData[];
  onAddCardClick: (colId: string) => void;
  onEditCard: (cardId: string) => void;
  me: string;
  suggestion?: { label: string; count: number } | null;
}

export function Board({ columns, phase, revealedSet, revealComplete, votes, onVote, carry, onToggleCarry, cards = [], onAddCardClick, onEditCard, me, suggestion = null }: BoardProps) {
  const isReflect = phase === "reflect";
  // Reveal & Vote: cards flip in, anyone can tidy/group them, and dot-voting is live.
  const isReveal = phase === "reveal";
  const isDiscuss = phase === "discuss";
  const canEdit = isReflect || isReveal;

  function mine(card: RetroCardData) { return card.author_key === me; }
  function cardFaceDown(card: RetroCardData) {
    if (isReflect) return !mine(card);
    if (isReveal) return !revealComplete && !revealedSet.has(card.id);
    return false;
  }

  const openCarry = carry.filter((c) => !c.done);

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      {/* LEFT: Still open carryover rail */}
      <aside style={{ width: 268, flex: "0 0 268px", background: "var(--studio-surface)", borderRight: "1px solid var(--studio-line)", padding: "var(--space-5) var(--space-4)", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <Icons.Clock size={15} style={{ color: openCarry.length ? "var(--warn)" : "var(--success)" }} />
          <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--studio-ink-2)" }}>Still open</span>
          <Badge tone={openCarry.length ? "warn" : "success"} style={{ marginLeft: "auto" }}>{openCarry.length}</Badge>
        </div>
        {carry.length === 0 ? (
          <EmptyNote icon={<Icons.CheckCircle size={22} />} title="Nothing carried over" body="A clean slate, first retro for this series, or last time you closed it all out." />
        ) : openCarry.length === 0 ? (
          <EmptyNote icon={<Icons.CheckCircle size={22} />} title="Nothing's open" body="That's a good sign. Everything from last time got closed." tone="success" />
        ) : (
          <React.Fragment>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, lineHeight: 1.4, color: "var(--studio-ink-3)", margin: "0 0 14px" }}>
              Riding over from last time. Close one to feel the progress.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {carry.map((c) => (
                <CarryoverItem key={c.id} done={c.done} onToggle={() => onToggleCarry(c.id)}>{c.text}</CarryoverItem>
              ))}
            </div>
          </React.Fragment>
        )}
      </aside>

      {/* CENTER: columns */}
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: "var(--space-6)", position: "relative" }}>
        {isReflect && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, padding: "10px 14px", borderRadius: "var(--r-control)", background: "var(--accent-soft)", border: "1px solid color-mix(in oklab, var(--accent) 30%, transparent)", maxWidth: "fit-content" }}>
            <Icons.EyeOff size={16} style={{ color: "var(--accent-bright)" }} />
            <span style={{ fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--studio-ink)" }}>Writing privately. Your cards are hidden from everyone until the reveal.</span>
          </div>
        )}
        {isReveal && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, padding: "10px 14px", borderRadius: "var(--r-control)", background: "var(--accent-soft)", border: "1px solid color-mix(in oklab, var(--accent) 45%, transparent)", boxShadow: "var(--glow-accent)", maxWidth: "fit-content" }}>
            <Icons.Sparkles size={16} style={{ color: "var(--accent-bright)" }} />
            <span style={{ fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--studio-ink)" }}>
              <b style={{ fontFamily: "var(--font-serif)", fontWeight: 600 }}>The reveal.</b> Every card, all at once. Group what belongs together, then dot-vote what matters most.
            </span>
            <span style={{ marginLeft: 6, fontFamily: "var(--font-mono)", fontSize: 12, fontVariantNumeric: "tabular-nums", color: "var(--accent-bright)" }}>{revealedSet.size}/{cards.length}</span>
          </div>
        )}
        {isReveal && suggestion && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18, padding: "8px 12px", borderRadius: "var(--r-pill)", background: "var(--studio-raised)", border: "1px solid var(--studio-line-2)", maxWidth: "fit-content" }}>
            <Icons.Sparkles size={15} style={{ color: "var(--accent-bright)" }} />
            <span style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--studio-ink-2)" }}>{suggestion.count} cards look related, <b style={{ color: "var(--studio-ink)" }}>&quot;{suggestion.label}&quot;</b></span>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`, gap: "var(--space-5)" }}>
          {columns.map((col) => {
            const items = cards.filter((c) => c.column_id === col.id);
            return (
              <section key={col.id}>
                <header style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid var(--studio-line)" }}>
                  <h3 style={{ fontFamily: "var(--font-serif)", fontSize: "1.5rem", fontWeight: 600, color: "var(--studio-ink)", margin: 0 }}>{col.title}</h3>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--studio-ink-3)" }}>{items.length}</span>
                </header>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  {canEdit && (
                    <AddCard onClick={() => onAddCardClick(col.id)} />
                  )}

                  {items.length === 0 && !canEdit && (
                    <EmptyColumn />
                  )}

                  {items.map((card) => {
                    const v = votes[card.id] ?? 0;
                    const editable = canEdit && (isReveal || mine(card));
                    return (
                      <div key={card.id}>
                        <div
                          onClick={editable ? () => onEditCard(card.id) : undefined}
                          style={{ cursor: editable ? "pointer" : "default" }}
                        >
                          <RetroCard
                            color={card.color}
                            author={isReflect ? "" : card.author_name}
                            votes={isReveal || isDiscuss ? v : null}
                            faceDown={cardFaceDown(card)}
                            tilt={tiltFor(card.id)}
                          >
                            {card.text}
                          </RetroCard>
                        </div>
                        {isReflect && mine(card) && (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6, marginLeft: 2, fontFamily: "var(--font-sans)", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--studio-ink-3)" }}>
                            <Icons.EyeOff size={12} /> only you can see this
                          </div>
                        )}
                        {isReveal && (
                          <div style={{ marginTop: 8 }}>
                            <VoteTally count={v} max={10} onVote={() => onVote(card.id)} voted={(votes[card.id] ?? 0) > 0} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
