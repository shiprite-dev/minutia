"use client";

import React from "react";

export interface VoteTallyProps extends React.HTMLAttributes<HTMLDivElement> {
  count?: number;
  max?: number;
  label?: string;
  onVote?: (() => void) | null;
  voted?: boolean;
  style?: React.CSSProperties;
}

export function VoteTally({
  count = 0,
  max = 12,
  label = "",
  onVote = null,
  voted = false,
  style = {},
  ...rest
}: VoteTallyProps) {
  const pct = Math.max(0, Math.min(100, (count / (max || 1)) * 100));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", ...style }} {...rest}>
      {onVote && (
        <button
          type="button"
          aria-label="Vote"
          onClick={onVote}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: "50%", cursor: "pointer",
            background: voted ? "var(--accent)" : "transparent",
            border: "1.5px solid " + (voted ? "var(--accent)" : "var(--studio-line-2)"),
            color: voted ? "#1a1815" : "var(--studio-ink-3)",
            transition: "all var(--dur-fast) var(--ease-out)",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={voted ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" /></svg>
        </button>
      )}
      <div style={{ flex: 1, minWidth: 80 }}>
        {label && <div style={{ fontFamily: "var(--font-sans)", fontSize: "0.8125rem", color: "var(--studio-ink-2)", marginBottom: 5 }}>{label}</div>}
        <div style={{ position: "relative", height: 8, borderRadius: "var(--r-pill)", background: "var(--studio-line)", overflow: "hidden" }}>
          <div
            style={{
              position: "absolute", inset: 0, width: pct + "%",
              background: "linear-gradient(90deg, var(--accent-deep), var(--accent))",
              borderRadius: "var(--r-pill)",
              transition: "width var(--dur-slow) var(--ease-out)",
            }}
          />
        </div>
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.9375rem", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--accent)", minWidth: 24, textAlign: "right" }}>
        {count}
      </div>
    </div>
  );
}
