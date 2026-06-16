"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CreateRetro } from "@/components/retro/CreateRetro";
import { Button } from "@/components/retro/Button";
import { TEMPLATES, type RetroTemplate } from "@/lib/retro/templates";
import {
  newKey,
  setParticipantKey,
  saveFacilitatorToken,
} from "@/lib/retro/local-identity";

export function CreateClient() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function create({ name, template }: { name: string; template: RetroTemplate }) {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const pk = newKey();
      const { data, error: rpcError } = await supabase.rpc("retro_create", {
        p_name: name,
        p_template: template.id,
        p_columns: template.columns,
        p_facilitator_name: "",
        p_facilitator_color: "sky",
        p_participant_key: pk,
      });
      if (rpcError) throw rpcError;
      const result = data as { token: string; facilitator_token: string };
      setParticipantKey(result.token, pk);
      saveFacilitatorToken(result.token, result.facilitator_token);
      router.push(`/retro/${result.token}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the board.");
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-8)",
        padding: "var(--space-6)",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 560 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 9,
            marginBottom: 20,
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: "var(--accent)",
              boxShadow: "var(--glow-accent)",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 18,
              fontWeight: 600,
              color: "var(--studio-ink)",
            }}
          >
            Minutia Retro
          </span>
        </div>
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(2rem, 5vw, 3.25rem)",
            fontWeight: 600,
            lineHeight: 1.1,
            color: "var(--studio-ink)",
            margin: "0 0 16px",
          }}
        >
          The retro where the action items don&apos;t die
        </h1>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "1.0625rem",
            lineHeight: 1.55,
            color: "var(--studio-ink-2)",
            margin: "0 0 8px",
          }}
        >
          Free, instant, multiplayer. Run it, export it, no signup. When you
          finish, your decisions can graduate into a living issue log.
        </p>
      </div>
      <Button size="lg" onClick={() => setOpen(true)} disabled={busy}>
        {busy ? "Creating…" : "Start a retro"}
      </Button>
      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--danger)" }}>
          {error}
        </p>
      )}
      <CreateRetro
        open={open}
        initialName=""
        templates={TEMPLATES}
        onClose={() => setOpen(false)}
        onCreate={create}
      />
    </main>
  );
}
