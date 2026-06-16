"use client";

import React from "react";
import type { PastelColor } from "@/lib/retro/types";

const PASTELS: Record<PastelColor, string> = {
  amber: "var(--c-amber)",
  rose: "var(--c-rose)",
  sage: "var(--c-sage)",
  sky: "var(--c-sky)",
  lilac: "var(--c-lilac)",
  sand: "var(--c-sand)",
};

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  name?: string;
  color?: PastelColor | string;
  size?: number;
  src?: string | null;
  ring?: boolean;
  style?: React.CSSProperties;
}

export function Avatar({
  name = "",
  color = "amber",
  size = 36,
  src = null,
  ring = true,
  style = {},
  ...rest
}: AvatarProps) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "·";
  const pastel = PASTELS[color as PastelColor] || color;

  return (
    <span
      title={name}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "var(--r-pill)",
        background: src ? "transparent" : pastel,
        color: "var(--card-ink)",
        fontFamily: "var(--font-sans)",
        fontSize: Math.round(size * 0.38),
        fontWeight: 700,
        lineHeight: 1,
        userSelect: "none",
        boxShadow: ring
          ? `0 0 0 2px var(--studio-surface), 0 0 0 4px ${pastel}`
          : "none",
        overflow: "hidden",
        flex: "0 0 auto",
        ...style,
      }}
      {...rest}
    >
      {src ? (
        <img src={src} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        initials
      )}
    </span>
  );
}
