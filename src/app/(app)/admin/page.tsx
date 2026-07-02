"use client";

import { useQuery } from "@tanstack/react-query";
import NumberFlow from "@number-flow/react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Overview = {
  users: number;
  series: number;
  meetings: number;
  openIssues: number;
  instanceName: string;
  version: string;
  deploymentMode: string;
};

async function fetchOverview(): Promise<Overview> {
  const res = await fetch("/api/admin/overview");
  if (!res.ok) throw new Error("Failed to load overview");
  return res.json();
}

const KPIS = [
  { key: "users", label: "Users" },
  { key: "series", label: "Series" },
  { key: "meetings", label: "Meetings" },
  { key: "openIssues", label: "Open issues" },
] as const;

export default function AdminOverviewPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: fetchOverview,
  });

  if (isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        Couldn&apos;t load instance overview. Refresh to retry.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPIS.map((kpi) => (
          <Card key={kpi.key}>
            <CardContent className="flex flex-col gap-1.5 p-4">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-4">
                {kpi.label}
              </span>
              {isLoading || !data ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                <NumberFlow
                  value={data[kpi.key]}
                  className="font-display text-3xl font-semibold tabular-nums text-ink"
                />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-1.5 p-4 text-sm text-ink-2">
          {isLoading || !data ? (
            <Skeleton className="h-5 w-64" />
          ) : (
            <>
              <span>
                Instance <span className="text-ink">{data.instanceName}</span>
              </span>
              <span>
                Version <span className="text-ink tabular-nums">{data.version}</span>
              </span>
              <span>
                Mode <span className="text-ink">{data.deploymentMode}</span>
              </span>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
