"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "./Button";
import { Icons } from "./icons";

export interface CommitNudgeProps {
  onExport: () => void;
  onSave: () => void;
  saving: boolean;
  savedSeriesId: string | null;
  error: string | null;
}

// The disguised funnel, framed as a gift not a gate. "Just export markdown"
// always sits beside the save, free and no-auth.
export function CommitNudge({ onExport, onSave, saving, savedSeriesId, error }: CommitNudgeProps) {
  if (savedSeriesId) {
    return (
      <div style={panel}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--success)", marginBottom: 10 }}>
          <Icons.CheckCircle size={18} />
          <span style={{ fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Saved
          </span>
        </div>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 14.5, lineHeight: 1.5, color: "var(--studio-ink-2)", margin: "0 0 16px" }}>
          Your action items are now tracked in Minutia. Next retro starts with whatever&apos;s still open.
        </p>
        <Link href={`/series/${savedSeriesId}`} style={{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 600, color: "var(--accent)" }}>
          Open the series →
        </Link>
      </div>
    );
  }

  return (
    <div style={panel}>
      <h3 style={{ fontFamily: "var(--font-serif)", fontSize: "1.375rem", fontWeight: 600, color: "var(--studio-ink)", margin: "0 0 8px" }}>
        Keep these alive in Minutia
      </h3>
      <p style={{ fontFamily: "var(--font-sans)", fontSize: 14.5, lineHeight: 1.5, color: "var(--studio-ink-2)", margin: "0 0 20px" }}>
        Save these actions so your next retro starts with what&apos;s still open. The retro where the action items don&apos;t die.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button onClick={onSave} disabled={saving} iconLeft={<Icons.ArrowRight size={16} />}>
          {saving ? "Saving…" : "Save to Minutia"}
        </Button>
        <Button variant="ghost" onClick={onExport} iconLeft={<Icons.Download size={16} />}>
          Just export markdown
        </Button>
      </div>
      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--danger)", margin: "12px 0 0" }}>{error}</p>
      )}
    </div>
  );
}

const panel: React.CSSProperties = {
  maxWidth: 460,
  margin: "0 auto",
  padding: "var(--space-6)",
  borderRadius: "var(--r-panel)",
  background: "var(--studio-raised)",
  border: "1px solid var(--studio-line-2)",
  boxShadow: "var(--lift-panel)",
  textAlign: "left",
};
