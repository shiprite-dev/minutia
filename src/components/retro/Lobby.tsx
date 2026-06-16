"use client";

import React from "react";
import type { RetroParticipant } from "@/lib/retro/types";
import { Button } from "./Button";
import { Input } from "./Input";
import { PresenceStack } from "./PresenceStack";
import { Icons } from "./icons";

export interface LobbyProps {
  boardName: string;
  template: string;
  people: RetroParticipant[];
  facilitatorName?: string;
  onEnter: (name: string, mood: string | null) => void;
  theme?: string;
}

const moods = [
  { k: "spent", label: "Spent", c: "var(--c-rose)" },
  { k: "ok", label: "Steady", c: "var(--c-sand)" },
  { k: "good", label: "Good", c: "var(--c-sage)" },
  { k: "fired", label: "Fired up", c: "var(--c-amber)" },
] as const;

const NAME_KEY = "retro:lobby-name";

export function Lobby({ boardName, template, people, facilitatorName, onEnter }: LobbyProps) {
  // Persist the typed name across remounts (e.g. React dev StrictMode double-mount)
  // so a half-typed name is never silently lost.
  const [name, setName] = React.useState(() =>
    typeof window === "undefined" ? "" : sessionStorage.getItem(NAME_KEY) ?? ""
  );
  const [mood, setMood] = React.useState<string | null>(null);
  const updateName = (v: string) => {
    setName(v);
    if (typeof window !== "undefined") sessionStorage.setItem(NAME_KEY, v);
  };

  return (
    <div style={{ minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-12) var(--space-6)" }}>
      <div style={{ width: "100%", maxWidth: 520, textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--accent-bright)", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", boxShadow: "var(--glow-accent)" }} />
          Minutia Retro
        </div>

        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(2.2rem,5vw,3.2rem)", fontWeight: 600, lineHeight: 1.08, letterSpacing: "-0.015em", color: "var(--studio-ink)", margin: "16px 0 10px" }}>
          {boardName}
        </h1>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 16, lineHeight: 1.5, color: "var(--studio-ink-2)", margin: "0 auto 28px", maxWidth: 380 }}>
          A {template} retro. Join with a name, nobody sees your cards until everyone reveals.
        </p>

        <div style={{ display: "flex", gap: 10, maxWidth: 420, margin: "0 auto 28px" }}>
          <Input value={name} onChange={(e) => updateName(e.target.value)} placeholder="Your name" size="lg" style={{ flex: 1 }} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onEnter(name.trim(), mood); }} />
          <Button variant="primary" size="lg" disabled={!name.trim()} onClick={() => onEnter(name.trim(), mood)} iconRight={<Icons.ArrowRight size={18} />}>Join</Button>
        </div>

        <div style={{ marginBottom: 30 }}>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--studio-ink-3)", marginBottom: 12 }}>
            How&apos;d this sprint feel?  <span style={{ textTransform: "none", letterSpacing: 0, opacity: 0.7 }}>· optional, tints the room</span>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            {moods.map((m) => (
              <button key={m.k} type="button" onClick={() => setMood(m.k)}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "12px 16px", borderRadius: "var(--r-card)", cursor: "pointer",
                  background: mood === m.k ? "var(--studio-raised)" : "transparent",
                  border: "1px solid " + (mood === m.k ? "var(--studio-line-2)" : "var(--studio-line)"),
                  transition: "all var(--dur-fast) var(--ease-out)" }}>
                <span style={{ width: 26, height: 26, borderRadius: "50%", background: m.c, boxShadow: mood === m.k ? "0 0 0 3px var(--studio-void), 0 0 0 5px " + m.c : "none" }} />
                <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: mood === m.k ? "var(--studio-ink)" : "var(--studio-ink-3)", fontWeight: mood === m.k ? 600 : 400 }}>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, paddingTop: 22, borderTop: "1px solid var(--studio-line)" }}>
          <PresenceStack people={people.slice(0, 5)} size={36} showCount={false} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--studio-ink-3)" }}>
            {people.length} already here{facilitatorName ? ` · ${facilitatorName} is facilitating` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
