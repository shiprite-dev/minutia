"use client";

import React from "react";
import { Button } from "./Button";
import { Icons } from "./icons";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  warning?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  tone?: "danger" | "default";
}

export function ConfirmDialog({ open, title, body, warning, confirmLabel, onConfirm, onCancel, tone = "default" }: ConfirmDialogProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-8)",
      background: "color-mix(in oklab, var(--studio-void) 74%, transparent)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title} style={{ width: "100%", maxWidth: 440, background: "var(--studio-raised)", borderRadius: "var(--r-panel)", border: "1px solid var(--studio-line-2)", boxShadow: "var(--lift-panel)", padding: "var(--space-8)" }}>
        <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "1.5rem", fontWeight: 600, color: "var(--studio-ink)", margin: "0 0 10px", letterSpacing: "-0.01em" }}>{title}</h2>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 14.5, lineHeight: 1.5, color: "var(--studio-ink-2)", margin: 0 }}>{body}</p>
        {warning && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 14, padding: "10px 12px", borderRadius: "var(--r-control)", background: "var(--accent-soft)", border: "1px solid color-mix(in oklab, var(--accent) 30%, transparent)" }}>
            <Icons.Clock size={16} style={{ color: "var(--accent-bright)", flex: "0 0 auto", marginTop: 1 }} />
            <span style={{ fontFamily: "var(--font-sans)", fontSize: 13, lineHeight: 1.45, color: "var(--studio-ink)" }}>{warning}</span>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 22 }}>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
