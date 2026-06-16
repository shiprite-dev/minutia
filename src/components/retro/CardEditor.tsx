"use client";

import React from "react";
import type { PastelColor } from "@/lib/retro/types";
import { Button } from "./Button";
import { Icons } from "./icons";

const PAL: PastelColor[] = ["amber", "rose", "sage", "sky", "lilac", "sand"];

export interface CardEditorProps {
  open: boolean;
  mode: "add" | "edit";
  colTitle?: string;
  initialText?: string;
  initialColor?: PastelColor;
  onSave: (text: string, color: PastelColor) => void;
  onClose: () => void;
  onDelete?: () => void;
}

export function CardEditor({ open, mode, colTitle, initialText, initialColor, onSave, onClose, onDelete }: CardEditorProps) {
  const [text, setText] = React.useState(initialText || "");
  const [color, setColor] = React.useState<PastelColor>(initialColor || "sky");
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (open) {
      setText(initialText || "");
      setColor(initialColor || "sky");
      const t = setTimeout(() => ref.current && ref.current.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open, initialText, initialColor]);

  if (!open) return null;
  const pastel = "var(--c-" + color + ")";
  function save() { if (text.trim()) onSave(text.trim(), color); }

  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-8)",
      background: "color-mix(in oklab, var(--studio-void) 70%, transparent)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--studio-ink-3)" }}>
            {mode === "edit" ? "Edit card" : "Add a card"}
          </span>
          {colTitle && <span style={{ fontFamily: "var(--font-serif)", fontSize: 18, color: "var(--studio-ink)" }}>· {colTitle}</span>}
        </div>

        {/* The paper card you write on */}
        <div style={{ background: pastel, color: "var(--card-ink)", borderRadius: "var(--r-card)", boxShadow: "var(--lift-drag)",
          backgroundImage: "radial-gradient(rgba(0,0,0,0.025) 1px, transparent 1px)", backgroundSize: "4px 4px", padding: "var(--space-5)", transition: "background var(--dur-base) var(--ease-out)" }}>
          <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)} maxLength={180}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(); if (e.key === "Escape") onClose(); }}
            placeholder="What's on your mind?"
            style={{ width: "100%", minHeight: 96, resize: "none", border: "none", outline: "none", background: "transparent",
              color: "var(--card-ink)", fontFamily: "var(--font-sans)", fontSize: "1.0625rem", fontWeight: 500, lineHeight: 1.45, boxSizing: "border-box" }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>
              {PAL.map((c) => (
                <button key={c} type="button" aria-label={c} onClick={() => setColor(c)} style={{ width: 22, height: 22, borderRadius: "50%", cursor: "pointer",
                  background: "var(--c-" + c + ")", border: "none",
                  boxShadow: color === c ? "0 0 0 2px var(--card-ink)" : "inset 0 0 0 1px rgba(0,0,0,0.12)" }} />
              ))}
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--card-ink)", opacity: 0.5 }}>{text.length}/180</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18 }}>
          <Button variant="primary" onClick={save} disabled={!text.trim()} iconLeft={mode === "edit" ? <Icons.Check size={18} /> : <Icons.Plus size={18} />}>
            {mode === "edit" ? "Save card" : "Add card"}
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {mode === "edit" && onDelete && (
            <Button variant="ghost" onClick={onDelete} style={{ marginLeft: "auto", color: "var(--danger)" }}>Delete</Button>
          )}
        </div>
        <div style={{ marginTop: 10, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--studio-ink-3)" }}>⌘↵ to save · esc to cancel</div>
      </div>
    </div>
  );
}
