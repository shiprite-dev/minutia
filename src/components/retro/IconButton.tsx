"use client";

import React from "react";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "ghost" | "solid" | "outline";
  size?: "sm" | "md" | "lg";
  active?: boolean;
  disabled?: boolean;
  "aria-label": string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function IconButton({
  children,
  size = "md",
  variant = "ghost",
  active = false,
  disabled = false,
  "aria-label": ariaLabel,
  style = {},
  ...rest
}: IconButtonProps) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const dim = ({ sm: 30, md: 36, lg: 44 } as Record<string, number>)[size] || 36;

  const variants: Record<string, React.CSSProperties> = {
    ghost: {
      background: active ? "var(--accent-soft)" : hover ? "var(--studio-raised)" : "transparent",
      color: active ? "var(--accent-bright)" : "var(--studio-ink-2)",
      border: "1px solid " + (active ? "transparent" : "transparent"),
    },
    solid: {
      background: hover ? "var(--accent-bright)" : "var(--accent)",
      color: "#1a1815",
      border: "1px solid transparent",
    },
    outline: {
      background: hover ? "var(--studio-raised)" : "transparent",
      color: "var(--studio-ink)",
      border: "1px solid var(--studio-line-2)",
    },
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: dim,
        height: dim,
        borderRadius: "var(--r-control)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transform: press && !disabled ? "scale(0.92)" : "scale(1)",
        transition: "background var(--dur-fast) var(--ease-out), transform var(--dur-instant) var(--ease-out), color var(--dur-fast) var(--ease-out)",
        ...(variants[variant] || variants.ghost),
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
