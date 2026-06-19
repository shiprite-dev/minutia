"use client";

import React from "react";
import Link from "next/link";
import type { RetroColumn, RetroCard as RetroCardData, RetroAction } from "@/lib/retro/types";
import { RetroCard } from "./RetroCard";
import { Avatar } from "./Avatar";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Icons } from "./icons";

export interface RetroSummaryProps {
  boardName: string;
  columns: RetroColumn[];
  cards: RetroCardData[];
  votes: Record<string, number>;
  actions: RetroAction[];
  savedSeriesId: string | null;
  onExport: () => void;
}

export function RetroSummary({ boardName, columns, cards, votes, actions, savedSeriesId, onExport }: RetroSummaryProps) {
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "var(--space-10) var(--space-6)" }}>
      <div style={{ width: "100%", maxWidth: 920, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--success)", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>
            <Icons.CheckCircle size={16} /> Retro complete
          </div>
          <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(2rem,4vw,2.75rem)", fontWeight: 600, color: "var(--studio-ink)", margin: 0, letterSpacing: "-0.01em" }}>{boardName || "Minutia Retro"}</h1>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--studio-ink-2)", margin: "8px 0 0" }}>
            This board is read-only. Live editing has ended.
          </p>
        </div>

        {actions.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "1.4rem", fontWeight: 600, color: "var(--studio-ink)", margin: "0 0 16px" }}>Action items</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {actions.map((a) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", background: "var(--studio-raised)", borderRadius: "var(--r-panel)", border: "1px solid color-mix(in oklab, var(--accent) 35%, transparent)", boxShadow: "var(--glow-accent)" }}>
                  <span style={{ display: "inline-flex", width: 26, height: 26, borderRadius: "50%", alignItems: "center", justifyContent: "center", background: "var(--accent)", color: "#1a1815", flex: "0 0 auto" }}>
                    <Icons.Check size={14} />
                  </span>
                  <span style={{ flex: 1, fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--studio-ink)", lineHeight: 1.4 }}>{a.text}</span>
                  {a.owner_name && <Avatar name={a.owner_name} color={a.color} size={28} />}
                  {a.due && <Badge tone={a.due === "Fri" ? "warn" : "neutral"}>{a.due}</Badge>}
                </div>
              ))}
            </div>
          </section>
        )}

        <section style={{ marginBottom: 40 }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))`, gap: "var(--space-5)" }}>
            {columns.map((col) => {
              const items = cards.filter((c) => c.column_id === col.id);
              return (
                <div key={col.id}>
                  <header style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid var(--studio-line)" }}>
                    <h3 style={{ fontFamily: "var(--font-serif)", fontSize: "1.25rem", fontWeight: 600, color: "var(--studio-ink)", margin: 0 }}>{col.title}</h3>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--studio-ink-3)" }}>{items.length}</span>
                  </header>
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                    {items.map((card) => (
                      <RetroCard key={card.id} color={card.color} author={card.author_name} votes={votes[card.id] ?? null} faceDown={false} tilt={0}>
                        {card.text}
                      </RetroCard>
                    ))}
                    {items.length === 0 && (
                      <span style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--studio-ink-3)", padding: "8px 2px" }}>Nothing here.</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, paddingTop: 8 }}>
          {savedSeriesId && (
            <Link href={`/series/${savedSeriesId}`} style={{ fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 600, color: "var(--accent-bright)" }}>
              Open the series &rarr;
            </Link>
          )}
          <Button variant="ghost" onClick={onExport} iconLeft={<Icons.Download size={17} />}>Export markdown</Button>
        </div>
      </div>
    </div>
  );
}
