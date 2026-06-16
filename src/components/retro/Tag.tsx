"use client";

import React from "react";

export type TagProps = Omit<React.HTMLAttributes<HTMLSpanElement>, "color"> & {
  color?: string | null;
  onRemove?: (() => void) | null;
  children: React.ReactNode;
  style?: React.CSSProperties;
};

export function Tag({ children, onRemove = null, color = null, style = {}, ...rest }: TagProps) {
  const [hover, setHover] = React.useState(false);
  return (
    <span
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        height: 24,
        padding: "0 var(--space-2)",
        borderRadius: "var(--r-chip)",
        background: "var(--studio-raised)",
        border: "1px solid var(--studio-line)",
        color: "var(--studio-ink-2)",
        fontFamily: "var(--font-sans)",
        fontSize: "0.8125rem",
        fontWeight: 500,
        lineHeight: 1,
        ...style,
      }}
      {...rest}
    >
      {color && (
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flex: "0 0 auto" }} />
      )}
      {children}
      {onRemove && (
        <button
          type="button"
          aria-label="Remove"
          onClick={onRemove}
          style={{
            display: "inline-flex",
            border: "none",
            background: "transparent",
            color: hover ? "var(--studio-ink)" : "var(--studio-ink-3)",
            cursor: "pointer",
            padding: 0,
            marginLeft: 2,
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}
