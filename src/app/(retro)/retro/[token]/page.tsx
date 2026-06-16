import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { RetroSnapshot } from "@/lib/retro/types";
import { RetroClient } from "./RetroClient";

export const dynamic = "force-dynamic";

export default async function RetroBoardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("retro_snapshot", { p_token: token });

  if (error || !data) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-6)",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "1.75rem",
              fontWeight: 600,
              color: "var(--studio-ink)",
              margin: "0 0 12px",
            }}
          >
            This board has expired
          </h1>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "1rem",
              lineHeight: 1.5,
              color: "var(--studio-ink-3)",
              margin: "0 0 24px",
            }}
          >
            Free retro boards are kept for 30 days. Start a fresh one, or save your
            retros into Minutia to keep them.
          </p>
          <Link
            href="/retro"
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: "var(--accent)",
            }}
          >
            Start a new retro →
          </Link>
        </div>
      </div>
    );
  }

  return <RetroClient token={token} initialSnapshot={data as RetroSnapshot} />;
}
