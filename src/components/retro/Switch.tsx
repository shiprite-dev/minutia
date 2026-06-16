"use client";

import React from "react";

export interface SwitchProps {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  style?: React.CSSProperties;
}

export function Switch({
  checked = false,
  onChange = () => {},
  disabled = false,
  size = "md",
  style = {},
  ...rest
}: SwitchProps & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange">) {
  const w = size === "sm" ? 36 : 44;
  const h = size === "sm" ? 20 : 24;
  const knob = h - 6;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        position: "relative",
        width: w,
        height: h,
        padding: 0,
        border: "none",
        borderRadius: "var(--r-pill)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        background: checked ? "var(--accent)" : "var(--studio-line-2)",
        transition: "background var(--dur-base) var(--ease-out)",
        ...style,
      }}
      {...rest}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: checked ? w - knob - 3 : 3,
          width: knob,
          height: knob,
          borderRadius: "50%",
          background: checked ? "#1a1815" : "var(--studio-ink)",
          boxShadow: "var(--lift-1)",
          transition: "left var(--dur-base) var(--ease-spring)",
        }}
      />
    </button>
  );
}
