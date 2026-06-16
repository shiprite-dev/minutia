"use client";

import React from "react";
import type { PastelColor } from "@/lib/retro/types";
import { Avatar } from "./Avatar";

export interface Participant {
  name: string;
  color?: PastelColor | string;
}

export interface PresenceStackProps extends React.HTMLAttributes<HTMLDivElement> {
  people: Participant[];
  max?: number;
  size?: number;
  showCount?: boolean;
  style?: React.CSSProperties;
}

export function PresenceStack({ people = [], max = 5, size = 34, showCount = true, style = {}, ...rest }: PresenceStackProps) {
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", ...style }} {...rest}>
      <div style={{ display: "flex", alignItems: "center" }}>
        {shown.map((p, i) => (
          <span key={p.name + i} style={{ marginLeft: i === 0 ? 0 : -10, zIndex: shown.length - i }}>
            <Avatar name={p.name} color={p.color} size={size} />
          </span>
        ))}
        {overflow > 0 && (
          <span
            style={{
              marginLeft: -10,
              width: size, height: size, borderRadius: "var(--r-pill)",
              background: "var(--studio-raised)", border: "1px solid var(--studio-line-2)",
              boxShadow: "0 0 0 2px var(--studio-surface)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontFamily: "var(--font-mono)", fontSize: "0.75rem", fontWeight: 600, color: "var(--studio-ink-2)",
            }}
          >
            +{overflow}
          </span>
        )}
      </div>
      {showCount && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", fontSize: "0.8125rem", color: "var(--studio-ink-3)", fontVariantNumeric: "tabular-nums" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--success)" }} />
          {people.length} here
        </span>
      )}
    </div>
  );
}
