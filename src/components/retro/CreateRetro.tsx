"use client";

import React from "react";
import type { RetroTemplate } from "@/lib/retro/templates";
import { Button } from "./Button";
import { Input } from "./Input";
import { Icons } from "./icons";

const pastels = ["var(--c-rose)", "var(--c-amber)", "var(--c-sage)", "var(--c-sky)"];

const vibes = [
  { k: "focused", label: "Focused", sub: "Calm, timed, heads-down" },
  { k: "playful", label: "Playful", sub: "Sound on, looser timers" },
  { k: "quick", label: "Quick & light", sub: "15 min, no discuss" },
] as const;

export interface CreateRetroProps {
  open: boolean;
  initialName?: string;
  templates: RetroTemplate[];
  onClose: () => void;
  onCreate: (opts: { name: string; template: RetroTemplate }) => void;
}

export function CreateRetro({ open, initialName, templates, onClose, onCreate }: CreateRetroProps) {
  const [name, setName] = React.useState(initialName || "");
  const [tpl, setTpl] = React.useState("ssc");
  const [vibe, setVibe] = React.useState("focused");

  React.useEffect(() => { if (open) setName(initialName || ""); }, [open, initialName]);
  if (!open) return null;

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 60, overflowY: "auto", background: "var(--studio-void)" }}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 70% at 50% -10%, color-mix(in oklab, var(--accent) 8%, transparent), transparent 55%)" }} />
      <div style={{ position: "relative", maxWidth: 680, margin: "0 auto", padding: "var(--space-12) var(--space-6)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--accent-bright)", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", boxShadow: "var(--glow-accent)" }} />
            New retro
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: "var(--studio-ink-3)", cursor: "pointer", fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(2rem,4vw,2.75rem)", fontWeight: 600, color: "var(--studio-ink)", margin: "0 0 6px", letterSpacing: "-0.015em" }}>Start a retro</h1>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 15.5, color: "var(--studio-ink-2)", margin: "0 0 28px" }}>No login. You&apos;ll get a share link the moment you create it.</p>

        {/* Name */}
        <label style={{ display: "block", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--studio-ink-3)", marginBottom: 8 }}>Name this retro</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Platform squad, Sprint 24" size="lg" style={{ marginBottom: 28 }} />

        {/* Template */}
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--studio-ink-3)", marginBottom: 10 }}>Template</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 28 }}>
          {templates.map((t) => {
            const active = tpl === t.id;
            return (
              <button key={t.id} type="button" onClick={() => setTpl(t.id)} style={{ textAlign: "left", cursor: "pointer",
                background: active ? "var(--studio-surface)" : "transparent", padding: "14px 16px", borderRadius: "var(--r-card)",
                border: "1px solid " + (active ? "var(--accent)" : "var(--studio-line-2)"), boxShadow: active ? "var(--glow-accent)" : "none", transition: "all var(--dur-fast) var(--ease-out)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontFamily: "var(--font-serif)", fontSize: "1.1rem", fontWeight: 600, color: "var(--studio-ink)" }}>{t.name}</span>
                  {t.minutia && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#1a1815", background: "var(--accent)", padding: "2px 6px", borderRadius: "var(--r-pill)" }}>Minutia</span>}
                </div>
                <p style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--studio-ink-2)", margin: "0 0 10px", lineHeight: 1.4 }}>{t.desc}</p>
                <div style={{ display: "flex", gap: 6 }}>
                  {t.columns.map((c, j) => (
                    <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--font-sans)", fontSize: 11, color: "var(--studio-ink-3)" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: pastels[j % pastels.length] }} />{c.title}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        {/* Vibe */}
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--studio-ink-3)", marginBottom: 10 }}>Vibe</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 32 }}>
          {vibes.map((v) => {
            const active = vibe === v.k;
            return (
              <button key={v.k} type="button" onClick={() => setVibe(v.k)} style={{ textAlign: "left", cursor: "pointer", padding: "12px 14px", borderRadius: "var(--r-control)",
                background: active ? "var(--studio-surface)" : "transparent", border: "1px solid " + (active ? "var(--accent)" : "var(--studio-line-2)"), transition: "all var(--dur-fast) var(--ease-out)" }}>
                <div style={{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 600, color: active ? "var(--studio-ink)" : "var(--studio-ink-2)" }}>{v.label}</div>
                <div style={{ fontFamily: "var(--font-sans)", fontSize: 11.5, color: "var(--studio-ink-3)", marginTop: 2 }}>{v.sub}</div>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Button variant="primary" size="lg" onClick={() => onCreate({ name: name.trim() || "Untitled retro", template: templates.find((t) => t.id === tpl) ?? templates[0] })} iconLeft={<Icons.Link size={18} />}>
            Create &amp; get link
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
