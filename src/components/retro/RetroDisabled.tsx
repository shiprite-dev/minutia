import Link from "next/link";

/** Shown when an instance has not opted into public retro boards. */
export function RetroDisabled() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-6)",
        background: "var(--studio-void)",
      }}
    >
      <div style={{ maxWidth: 440, textAlign: "center" }}>
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "2rem",
            fontWeight: 600,
            color: "var(--studio-ink)",
            margin: "0 0 12px",
          }}
        >
          Retro boards aren&apos;t enabled here
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
          This Minutia instance hasn&apos;t turned on free retro boards. An admin
          can enable them in workspace settings.
        </p>
        <Link
          href="/"
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "0.9375rem",
            fontWeight: 600,
            color: "var(--accent)",
          }}
        >
          Back to Minutia →
        </Link>
      </div>
    </div>
  );
}
