"use client";

import React from "react";
import type { PastelColor } from "@/lib/retro/types";
import { Icons } from "./icons";

export interface SpotlightTheme {
  id: string;
  text: string;
  color: PastelColor;
  author: string;
  count: number;
}

export interface SpotlightProps {
  themes: SpotlightTheme[];
  index: number;
  setIndex: (i: number) => void;
}

export function Spotlight({ themes, index, setIndex }: SpotlightProps) {
  const card = themes[index];
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    setShown(false);
    const t = setTimeout(() => setShown(true), 30);
    return () => clearTimeout(t);
  }, [index, card?.id]);

  // empty state: discussion with nothing voted up
  if (!card) {
    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center",
        background: "color-mix(in oklab, var(--studio-void) 72%, transparent)", backdropFilter: "blur(7px)", WebkitBackdropFilter: "blur(7px)" }}>
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <div style={{ display: "inline-flex", color: "var(--studio-ink-3)", marginBottom: 14 }}><Icons.Sparkles size={30} /></div>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: "1.6rem", color: "var(--studio-ink)", marginBottom: 6 }}>Nothing voted up yet</div>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: 14.5, color: "var(--studio-ink-2)", lineHeight: 1.5 }}>Head back to Vote and give the themes a few dots, the top ones spotlight here, one at a time.</div>
        </div>
      </div>
    );
  }

  const pastel = "var(--c-" + card.color + ")";
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 30, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, padding: "var(--space-10) var(--space-8)",
      background: "color-mix(in oklab, var(--studio-void) 74%, transparent)", backdropFilter: "blur(7px)", WebkitBackdropFilter: "blur(7px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent-bright)" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", boxShadow: "var(--glow-accent)" }} />
        Discussing · theme {index + 1} of {themes.length}
      </div>

      <div key={card.id} style={{ width: "100%", maxWidth: 620, opacity: shown ? 1 : 0, transform: shown ? "scale(1) translateY(0)" : "scale(0.9) translateY(10px)", transition: "opacity var(--dur-slow) var(--ease-out), transform var(--dur-slow) var(--ease-spring)" }}>
        <div style={{ background: pastel, color: "var(--card-ink)", borderRadius: "var(--r-panel)", boxShadow: "var(--lift-panel), var(--lift-card)",
          backgroundImage: "radial-gradient(rgba(0,0,0,0.025) 1px, transparent 1px)", backgroundSize: "5px 5px", padding: "var(--space-10) var(--space-8)" }}>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(1.8rem, 3.4vw, 2.6rem)", fontWeight: 600, lineHeight: 1.15, letterSpacing: "-0.01em" }}>
            {card.text}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 22 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--card-ink)", opacity: 0.7 }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", background: pastel, boxShadow: "0 0 0 2px rgba(0,0,0,0.18)" }} />
              {card.author}
            </span>
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", fontSize: 17, fontWeight: 600, color: "var(--accent-deep)" }}>
              <Icons.ThumbsUp size={17} /> {card.count} votes
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button type="button" aria-label="Previous theme" disabled={index === 0} onClick={() => setIndex(index - 1)}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: "50%", cursor: index === 0 ? "default" : "pointer",
            background: "var(--studio-raised)", border: "1px solid var(--studio-line-2)", color: "var(--studio-ink)", opacity: index === 0 ? 0.35 : 1 }}>
          <span style={{ transform: "rotate(180deg)", display: "inline-flex" }}><Icons.ArrowRight size={18} /></span>
        </button>
        <div style={{ display: "flex", gap: 7 }}>
          {themes.map((t, i) => (
            <button key={t.id} type="button" onClick={() => setIndex(i)} style={{ width: i === index ? 22 : 8, height: 8, borderRadius: "var(--r-pill)", border: "none", padding: 0, cursor: "pointer",
              background: i === index ? "var(--accent)" : "var(--studio-line-2)", transition: "all var(--dur-base) var(--ease-out)" }} />
          ))}
        </div>
        <button type="button" aria-label="Next theme" disabled={index === themes.length - 1} onClick={() => setIndex(index + 1)}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: "50%", cursor: index === themes.length - 1 ? "default" : "pointer",
            background: "var(--accent)", border: "none", color: "#1a1815", opacity: index === themes.length - 1 ? 0.35 : 1 }}>
          <Icons.ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}
