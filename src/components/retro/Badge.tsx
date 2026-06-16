"use client";

import React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "accent" | "success" | "warn" | "danger";
  solid?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function Badge({ children, tone = "neutral", solid = false, style = {}, ...rest }: BadgeProps) {
  const tones: Record<string, { fg: string; soft: string; solidBg: string; solidFg: string }> = {
    neutral: { fg: "var(--studio-ink-2)", soft: "var(--studio-raised)", solidBg: "var(--studio-line-2)", solidFg: "var(--studio-ink)" },
    accent:  { fg: "var(--accent-bright)", soft: "var(--accent-soft)", solidBg: "var(--accent)", solidFg: "#1a1815" },
    success: { fg: "var(--success)", soft: "color-mix(in oklab, var(--success) 18%, var(--studio-surface))", solidBg: "var(--success)", solidFg: "#0e1f16" },
    warn:    { fg: "var(--warn)", soft: "color-mix(in oklab, var(--warn) 18%, var(--studio-surface))", solidBg: "var(--warn)", solidFg: "#241a05" },
    danger:  { fg: "var(--danger)", soft: "color-mix(in oklab, var(--danger) 18%, var(--studio-surface))", solidBg: "var(--danger)", solidFg: "#2a0c08" },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        height: 22,
        padding: "0 var(--space-2)",
        borderRadius: "var(--r-pill)",
        fontFamily: "var(--font-sans)",
        fontSize: "0.75rem",
        fontWeight: 600,
        lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
        background: solid ? t.solidBg : t.soft,
        color: solid ? t.solidFg : t.fg,
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
