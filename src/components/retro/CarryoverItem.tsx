"use client";

import React from "react";

export interface CarryoverItemProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  age?: string;
  aging?: boolean;
  done?: boolean;
  onToggle?: () => void;
  style?: React.CSSProperties;
}

export function CarryoverItem({
  children,
  age = "",
  aging = false,
  done = false,
  onToggle = () => {},
  style = {},
  ...rest
}: CarryoverItemProps) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-3)",
        padding: "var(--space-3)",
        borderRadius: "var(--r-control)",
        background: done ? "color-mix(in oklab, var(--success) 12%, var(--studio-raised))" : hover ? "var(--studio-raised)" : "transparent",
        border: "1px solid " + (done ? "color-mix(in oklab, var(--success) 30%, transparent)" : "var(--studio-line)"),
        transition: "background var(--dur-fast) var(--ease-out)",
        ...style,
      }}
      {...rest}
    >
      <button
        type="button"
        aria-label={done ? "Reopen" : "Mark done"}
        onClick={onToggle}
        style={{
          flex: "0 0 auto", marginTop: 1,
          width: 20, height: 20, borderRadius: "50%", cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: done ? "var(--success)" : "transparent",
          border: "1.5px solid " + (done ? "var(--success)" : "var(--studio-line-2)"),
          color: "#0e1f16",
          transition: "all var(--dur-base) var(--ease-spring)",
        }}
      >
        {done && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: "0.875rem", lineHeight: 1.4, color: done ? "var(--studio-ink-3)" : "var(--studio-ink)", textDecoration: done ? "line-through" : "none" }}>
          {children}
        </div>
        {age && (
          <div style={{ marginTop: 5, fontFamily: "var(--font-mono)", fontSize: "0.6875rem", color: done ? "var(--success)" : aging ? "var(--warn)" : "var(--studio-ink-3)" }}>
            {done ? "closed just now" : age}
          </div>
        )}
      </div>
    </div>
  );
}
