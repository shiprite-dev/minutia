"use client";

import React from "react";

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  size?: "sm" | "md" | "lg";
  invalid?: boolean;
  iconLeft?: React.ReactNode;
  style?: React.CSSProperties;
}

export function Input({
  value,
  onChange,
  placeholder = "",
  size = "md",
  invalid = false,
  iconLeft = null,
  style = {},
  ...rest
}: InputProps) {
  const [focus, setFocus] = React.useState(false);
  const height = ({ sm: 36, md: 44, lg: 52 } as Record<string, number>)[size] || 44;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        height,
        padding: "0 var(--space-3)",
        background: "var(--studio-surface)",
        border: "1px solid " + (invalid ? "var(--danger)" : focus ? "var(--accent)" : "var(--studio-line-2)"),
        borderRadius: "var(--r-control)",
        boxShadow: focus ? "0 0 0 3px color-mix(in oklab, var(--accent) 28%, transparent)" : "none",
        transition: "border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)",
        ...style,
      }}
    >
      {iconLeft && <span style={{ display: "inline-flex", color: "var(--studio-ink-3)" }}>{iconLeft}</span>}
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--studio-ink)",
          fontFamily: "var(--font-sans)",
          fontSize: "0.9375rem",
          lineHeight: 1.4,
        }}
        {...rest}
      />
    </div>
  );
}
