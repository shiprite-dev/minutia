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
