import type { ReactNode } from "react";
import { getInstanceConfigMap } from "@/lib/instance-config";
import { RetroDisabled } from "@/components/retro/RetroDisabled";

export const dynamic = "force-dynamic";

// Public, no-auth route group for Minutia Retro. The "Studio" theme is applied
// here so every retro surface inherits the scoped tokens. Availability is gated
// on the instance flag; when off we render the disabled view inline (no redirect,
// so there is no loop) rather than exposing the tool.
export default async function RetroLayout({ children }: { children: ReactNode }) {
  const cfg = await getInstanceConfigMap(["retro_enabled"]);
  const enabled = cfg.retro_enabled === "true";
  return (
    <div data-retro="studio" style={{ minHeight: "100vh", background: "var(--studio-void)" }}>
      {enabled ? children : <RetroDisabled />}
    </div>
  );
}
