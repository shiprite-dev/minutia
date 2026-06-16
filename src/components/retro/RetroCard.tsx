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

function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || ""
  );
}

export interface RetroCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  color?: PastelColor | string;
  author?: string;
  votes?: number | null;
  faceDown?: boolean;
  dragging?: boolean;
  tilt?: number;
  style?: React.CSSProperties;
}

export function RetroCard({
  children,
  color = "amber",
  author = "",
  votes = null,
  faceDown = false,
  dragging = false,
  tilt = 0,
  style = {},
  ...rest
}: RetroCardProps) {
  const [hover, setHover] = React.useState(false);
  const pastel = PASTELS[color as PastelColor] || color;

  const wasDown = React.useRef(faceDown);
  const [bloom, setBloom] = React.useState(0);
  React.useEffect(() => {
    if (wasDown.current && !faceDown) setBloom((n) => n + 1);
    wasDown.current = faceDown;
  }, [faceDown]);

  const shadow = dragging
    ? "var(--lift-drag)"
    : hover
    ? "inset 0 1px 0 rgb(255 255 255 / 0.12), inset 0 -1px 0 rgb(0 0 0 / 0.05), 0 6px 12px rgb(0 0 0 / 0.32), 0 20px 44px rgb(0 0 0 / 0.5)"
    : "var(--lift-card)";

  const liftTransform = dragging
    ? "translateY(-7px) rotate(-1.4deg)"
    : hover
    ? "translateY(-3px) rotate(0deg)"
    : `translateY(0) rotate(${tilt}deg)`;

  const ini = initialsOf(author);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ perspective: 1000, ...style }}
      {...rest}
    >
      {/* tilt + lift — fast spring */}
      <div
        style={{
          transform: liftTransform,
          transition: "transform var(--dur-base) var(--ease-spring), filter var(--dur-base) var(--ease-out)",
          willChange: "transform",
        }}
      >
        {/* flip — weighty spring */}
        <div
          style={{
            position: "relative",
            transformStyle: "preserve-3d",
            transform: `rotateY(${faceDown ? 180 : 0}deg)`,
            transition: "transform var(--dur-ritual) var(--ease-spring)",
          }}
        >
          {/* FRONT */}
          <div
            style={{
              position: "relative",
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
              opacity: faceDown ? 0 : 1,
              boxShadow: shadow,
              transition: "box-shadow var(--dur-base) var(--ease-out), opacity var(--dur-base) var(--ease-out)",
              background: pastel,
              backgroundImage: "radial-gradient(rgba(0,0,0,0.025) 1px, transparent 1px)",
              backgroundSize: "4px 4px",
              color: "var(--card-ink)",
              borderRadius: "var(--r-card)",
              padding: "var(--space-4)",
              minHeight: 92,
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
              boxSizing: "border-box",
            }}
          >
            <div style={{ fontFamily: "var(--font-sans)", fontSize: "0.9375rem", lineHeight: 1.45, fontWeight: 500, textWrap: "pretty" } as React.CSSProperties}>
              {children}
            </div>
            {(author || votes !== null) && (
              <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                {author && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: "0.75rem", fontWeight: 500, color: "var(--card-ink)" }}>
                    <span
                      aria-hidden="true"
                      style={{
                        flex: "0 0 auto",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: "rgba(0,0,0,0.06)",
                        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.16)",
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: "0.01em",
                        lineHeight: 1,
                        color: "var(--card-ink)",
                      }}
                    >
                      {ini}
                    </span>
                    <span style={{ opacity: 0.62, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{author}</span>
                  </span>
                )}
                {votes !== null && (
                  <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "var(--font-mono)", fontSize: "0.8125rem", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--accent-deep)" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }} />
                    {votes}
                  </span>
                )}
              </div>
            )}

            {/* reveal bloom — one-shot accent ring + glow that fades */}
            {bloom > 0 && (
              <span
                key={bloom}
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "var(--r-card)",
                  pointerEvents: "none",
                  boxShadow: "0 0 0 1.5px var(--accent), var(--glow-reveal)",
                  animation: "mr-reveal-bloom var(--dur-grand) var(--ease-out) forwards",
                }}
              />
            )}
          </div>

          {/* BACK */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
              opacity: faceDown ? 1 : 0,
              transition: "opacity var(--dur-base) var(--ease-out)",
              transform: "rotateY(180deg)",
              boxShadow: shadow,
              background: "color-mix(in oklab, var(--paper) 30%, var(--studio-raised))",
              backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,0.03) 0 6px, transparent 6px 12px)",
              border: "1px solid var(--studio-line)",
              borderRadius: "var(--r-card)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ width: 24, height: 24, borderRadius: "50%", background: pastel, opacity: 0.5 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
