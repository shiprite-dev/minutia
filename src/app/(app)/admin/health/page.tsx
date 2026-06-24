"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ServiceProbe, ServiceStatus } from "@/lib/admin/health";

type HealthReport = {
  overall: "ok" | "degraded" | "down";
  services: ServiceProbe[];
};

async function fetchHealth(): Promise<HealthReport> {
  const res = await fetch("/api/admin/health");
  if (!res.ok) throw new Error("Failed to load health");
  return res.json();
}

const DOT: Record<ServiceStatus, string> = {
  ok: "bg-accent",
  degraded: "bg-amber-500",
  unconfigured: "bg-amber-500",
  down: "bg-danger",
};

const OVERALL: Record<HealthReport["overall"], { dot: string; label: string }> = {
  ok: { dot: "bg-accent", label: "All systems operational" },
  degraded: { dot: "bg-amber-500", label: "Degraded: some services need attention" },
  down: { dot: "bg-danger", label: "Down: a critical service is failing" },
};

export default function AdminHealthPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "health"],
    queryFn: fetchHealth,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const overall = OVERALL[data.overall];

  return (
    <div className="space-y-5">
      <Card role="status" aria-live="polite">
        <CardContent className="flex items-center gap-2.5 p-4">
          <span className={cn("size-2.5 rounded-full", overall.dot)} />
          <span className="text-sm font-medium text-ink">{overall.label}</span>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-rule">
            {data.services.map((probe) => (
              <li
                key={probe.service}
                className="flex items-center gap-3 px-4 py-3"
              >
                <span
                  className={cn("size-2 shrink-0 rounded-full", DOT[probe.status])}
                  aria-hidden="true"
                />
                <span className="text-sm font-medium capitalize text-ink">
                  {probe.service}
                </span>
                {probe.detail && (
                  <span className="truncate text-xs text-ink-3">{probe.detail}</span>
                )}
                <span className="ml-auto text-xs font-medium uppercase tracking-wide text-ink-3">
                  {probe.status}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
