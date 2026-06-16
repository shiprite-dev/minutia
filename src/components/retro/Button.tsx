"use client";

import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  disabled = false,
  iconLeft = null,
  iconRight = null,
  style = {},
  ...rest
}: ButtonProps) {
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);

  const sizes: Record<string, { padding: string; height: number; font: string }> = {
    sm: { padding: "0 var(--space-3)", height: 32, font: "0.8125rem" },
    md: { padding: "0 var(--space-5)", height: 40, font: "0.9375rem" },
    lg: { padding: "0 var(--space-6)", height: 48, font: "1rem" },
  };
  const s = sizes[size] || sizes.md;

  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--space-2)",
    height: s.height,
    padding: s.padding,
    fontFamily: "var(--font-sans)",
    fontSize: s.font,
    fontWeight: 600,
    lineHeight: 1,
    border: "1px solid transparent",
    borderRadius: "var(--r-control)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    transition: "background var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out), transform var(--dur-instant) var(--ease-out), color var(--dur-fast) var(--ease-out)",
    transform: active && !disabled ? "scale(0.97)" : "scale(1)",
    whiteSpace: "nowrap",
    userSelect: "none",
  };

  const variants: Record<string, React.CSSProperties> = {
    primary: {
      background: active ? "var(--accent-deep)" : hover ? "var(--accent-bright)" : "var(--accent)",
      color: "#1a1815",
      boxShadow: hover && !disabled ? "var(--glow-accent)" : "var(--lift-1)",
    },
    secondary: {
      background: hover ? "var(--studio-line)" : "var(--studio-raised)",
      color: "var(--studio-ink)",
      borderColor: "var(--studio-line-2)",
    },
    ghost: {
      background: hover ? "var(--studio-raised)" : "transparent",
      color: "var(--studio-ink-2)",
    },
    danger: {
      background: hover ? "var(--danger)" : "transparent",
      color: hover ? "#fff" : "var(--danger)",
      borderColor: "var(--danger)",
    },
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setActive(false); }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      style={{ ...base, ...(variants[variant] || variants.primary), ...style }}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}
