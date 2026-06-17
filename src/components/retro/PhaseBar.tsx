"use client";

import React from "react";

const DEFAULT_PHASES = ["Lobby", "Reflect", "Reveal & Vote", "Discuss", "Commit"];

export interface PhaseBarProps extends React.HTMLAttributes<HTMLDivElement> {
  phases?: string[];
  current?: number;
  timer?: string | null;
  isFacilitator?: boolean;
  onAdvance?: () => void;
  style?: React.CSSProperties;
}

export function PhaseBar({
  phases = DEFAULT_PHASES,
  current = 1,
  timer = null,
  isFacilitator = false,
  onAdvance = () => {},
  style = {},
  ...rest
}: PhaseBarProps) {
  const currentName = phases[current] || "";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-6)",
        height: 72,
        padding: "0 var(--space-6)",
        background: "var(--studio-raised)",
        borderBottom: "1px solid var(--studio-line)",
        boxShadow: "var(--lift-1)",
        ...style,
      }}
      {...rest}
    >
      <div style={{ fontFamily: "var(--font-serif)", fontSize: "1.75rem", fontWeight: 600, color: "var(--studio-ink)", letterSpacing: "-0.01em", minWidth: 160 }}>
        {currentName}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flex: 1, justifyContent: "center" }}>
        {phases.map((p, i) => {
          const state = i < current ? "past" : i === current ? "active" : "future";
          return (
            <React.Fragment key={p}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: state === "active" ? 9 : 7,
                    height: state === "active" ? 9 : 7,
                    borderRadius: "50%",
                    background: state === "active" ? "var(--accent)" : state === "past" ? "var(--studio-ink-3)" : "var(--studio-line-2)",
                    boxShadow: state === "active" ? "var(--glow-accent)" : "none",
                  }}
                />
                <span
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: "0.75rem",
                    fontWeight: state === "active" ? 600 : 500,
                    letterSpacing: "0.04em",
                    color: state === "active" ? "var(--accent-bright)" : state === "past" ? "var(--studio-ink-3)" : "var(--studio-ink-3)",
                    opacity: state === "future" ? 0.6 : 1,
                  }}
                >
                  {p}
                </span>
              </span>
              {i < phases.length - 1 && (
                <span style={{ width: 14, height: 1, background: "var(--studio-line)" }} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {timer !== null && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "1.5rem", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--accent)", letterSpacing: "0.02em", minWidth: 78, textAlign: "right" }}>
          {timer}
        </div>
      )}

      {isFacilitator && (
        <button
          type="button"
          onClick={onAdvance}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8, height: 40, padding: "0 var(--space-4)",
            background: "var(--accent)", color: "#1a1815", border: "none", borderRadius: "var(--r-control)",
            fontFamily: "var(--font-sans)", fontSize: "0.9375rem", fontWeight: 600, cursor: "pointer",
          }}
        >
          Advance
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
        </button>
      )}
    </div>
  );
}
