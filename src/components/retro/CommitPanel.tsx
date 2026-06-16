"use client";

import React from "react";
import type { RetroAction } from "@/lib/retro/types";
import { Button } from "./Button";
import { Avatar } from "./Avatar";
import { Badge } from "./Badge";
import { Icons } from "./icons";

export interface CommitPanelProps {
  actions: RetroAction[];
  sealed: boolean;
  onSeal: () => void;
  bloom: boolean;
}

export function CommitPanel({ actions, sealed, onSeal, bloom }: CommitPanelProps) {
  return (
    <div style={{ height: "100%", overflowY: "auto", display: "flex", justifyContent: "center", padding: "var(--space-12) var(--space-6)", position: "relative" }}>
      {/* closure bloom flash across the board */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: bloom ? 1 : 0,
        background: "radial-gradient(circle at 50% 40%, rgba(248,122,78,0.18), transparent 60%)",
        transition: "opacity var(--dur-grand) var(--ease-out)" }} />

      <div style={{ width: "100%", maxWidth: 620, position: "relative" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(2rem,4vw,2.75rem)", fontWeight: 600, color: "var(--studio-ink)", margin: "0 0 8px", letterSpacing: "-0.01em" }}>
            {sealed ? "Sealed — nice work." : "Commit the actions"}
          </h2>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: 15.5, color: "var(--studio-ink-2)", margin: 0 }}>
            {sealed ? "Three decisions, each with an owner. They won't get lost." : "Each theme becomes an action item with an owner and a due date."}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
          {actions.map((a, i) => (
            <div key={a.id} style={{
              display: "flex", alignItems: "center", gap: 14, padding: "16px 18px",
              background: "var(--studio-raised)", borderRadius: "var(--r-panel)",
              border: "1px solid " + (sealed ? "color-mix(in oklab, var(--accent) 35%, transparent)" : "var(--studio-line)"),
              boxShadow: sealed ? "var(--glow-accent)" : "var(--lift-1)",
              transition: "all var(--dur-slow) var(--ease-out)", transitionDelay: (i * 90) + "ms",
            }}>
              <span style={{ display: "inline-flex", width: 26, height: 26, borderRadius: "50%", alignItems: "center", justifyContent: "center",
                background: sealed ? "var(--accent)" : "transparent", border: "1.5px solid " + (sealed ? "var(--accent)" : "var(--studio-line-2)"), color: "#1a1815", flex: "0 0 auto" }}>
                {sealed && <Icons.Check size={14} />}
              </span>
              <span style={{ flex: 1, fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--studio-ink)", lineHeight: 1.4 }}>{a.text}</span>
              <Avatar name={a.owner_name} color={a.color} size={28} />
              <Badge tone={a.due === "Fri" ? "warn" : "neutral"}>{a.due}</Badge>
            </div>
          ))}
        </div>

        {!sealed ? (
          <div style={{ textAlign: "center" }}>
            <Button variant="primary" size="lg" onClick={onSeal} iconLeft={<Icons.CheckCircle size={20} />}>Seal these decisions</Button>
          </div>
        ) : (
          // The nudge — a calm card, not a modal wall.
          <div style={{ background: "var(--paper)", color: "var(--card-ink)", borderRadius: "var(--r-panel)", padding: "var(--space-6)", boxShadow: "var(--lift-card)", backgroundImage: "radial-gradient(rgba(0,0,0,0.02) 1px, transparent 1px)", backgroundSize: "4px 4px" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--font-sans)", fontSize: 11.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent-deep)", marginBottom: 10 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} /> Keep them alive
            </div>
            <h3 style={{ fontFamily: "var(--font-serif)", fontSize: "1.6rem", fontWeight: 600, margin: "0 0 8px", lineHeight: 1.15 }}>
              The only retro where the action items don&apos;t die.
            </h3>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: 15, lineHeight: 1.5, color: "color-mix(in oklab, var(--card-ink) 78%, transparent)", margin: "0 0 20px", maxWidth: 460 }}>
              Keep these alive in Minutia so your next retro starts with what&apos;s still open. One tap seeds a living issue log — no copy-paste, nothing forgotten.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Button variant="primary" size="lg" iconRight={<Icons.ArrowRight size={18} />}>Save to Minutia</Button>
              <button type="button" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "transparent", border: "none", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 14.5, fontWeight: 500, color: "color-mix(in oklab, var(--card-ink) 60%, transparent)" }}>
                <Icons.Download size={17} /> Just export markdown
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
