"use client";

import React from "react";
import type { RetroParticipant } from "@/lib/retro/types";
import type { RetroTemplate } from "@/lib/retro/templates";
import { Button } from "./Button";
import { PresenceStack } from "./PresenceStack";
import { Icons } from "./icons";

export interface ShareInviteProps {
  open: boolean;
  boardName: string;
  template?: RetroTemplate | null;
  people: RetroParticipant[];
  link: string;
  onClose: () => void;
  onStart: () => void;
}

export function ShareInvite({ open, boardName, template, people, link, onClose, onStart }: ShareInviteProps) {
  const [copied, setCopied] = React.useState(false);
  const display = link.replace(/^https?:\/\//, "");

  React.useEffect(() => { if (open) setCopied(false); }, [open]);
  if (!open) return null;

  function copy() {
    setCopied(true);
    if (navigator.clipboard) navigator.clipboard.writeText(link).catch(() => {});
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-8)",
      background: "color-mix(in oklab, var(--studio-void) 74%, transparent)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: "var(--studio-raised)", borderRadius: "var(--r-panel)", border: "1px solid var(--studio-line-2)", boxShadow: "var(--lift-panel)", padding: "var(--space-8)" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--success)", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>
          <Icons.CheckCircle size={16} /> Your retro is live
        </div>

        <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "1.9rem", fontWeight: 600, color: "var(--studio-ink)", margin: "0 0 4px", letterSpacing: "-0.01em" }}>{boardName}</h2>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--studio-ink-2)", margin: "0 0 22px" }}>
          {template ? template.name : "Start · Stop · Continue"} · share the link, no signup needed to join.
        </p>

        {/* Link field */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 6px 6px 14px", borderRadius: "var(--r-control)", background: "var(--studio-surface)", border: "1px solid var(--studio-line-2)", marginBottom: 12 }}>
          <Icons.Link size={16} style={{ color: "var(--studio-ink-3)", flex: "0 0 auto" }} />
          <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 13.5, color: "var(--studio-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{display}</span>
          <Button variant={copied ? "secondary" : "primary"} size="sm" onClick={copy} iconLeft={copied ? <Icons.Check size={15} /> : null}>
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: "var(--r-control)", background: "var(--studio-surface)", border: "1px solid var(--studio-line)", marginBottom: 24 }}>
          <PresenceStack people={people.slice(0, 4)} size={28} showCount={false} />
          <span style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--studio-ink-2)" }}>People are starting to join…</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--studio-ink-3)" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--success)" }} /> {people.length} here
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Button variant="primary" size="lg" onClick={onStart} iconRight={<Icons.ArrowRight size={18} />}>Start the retro</Button>
          <button type="button" onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--studio-ink-3)" }}>Later</button>
        </div>
      </div>
    </div>
  );
}
