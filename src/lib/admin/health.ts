export type ServiceStatus = "ok" | "degraded" | "unconfigured" | "down";

export type ServiceProbe = {
  service: string;
  status: ServiceStatus;
  detail?: string;
};

export function configStatus(
  value: string | null | undefined
): "ok" | "unconfigured" {
  return typeof value === "string" && value.length > 0 ? "ok" : "unconfigured";
}

// Transcription is "ok" with diarization, "degraded" (not down) when it runs but
// cannot label speakers, and "unconfigured" when no provider is set up. Degraded
// keeps overall health amber rather than red: transcripts still work.
export function transcriptionProbe(
  configured: boolean,
  diarizing: boolean
): ServiceProbe {
  if (!configured) return { service: "transcription", status: "unconfigured" };
  return diarizing
    ? { service: "transcription", status: "ok", detail: "diarization on" }
    : {
        service: "transcription",
        status: "degraded",
        detail: "transcription only",
      };
}

export function overallHealth(
  probes: ServiceProbe[]
): "ok" | "degraded" | "down" {
  if (probes.some((probe) => probe.status === "down")) return "down";
  if (
    probes.some(
      (probe) =>
        probe.status === "degraded" || probe.status === "unconfigured"
    )
  ) {
    return "degraded";
  }
  return "ok";
}
