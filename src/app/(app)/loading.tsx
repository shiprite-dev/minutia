import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Hero card */}
          <div className="col-span-1 lg:col-span-2 rounded-xl border border-rule bg-card p-6">
            <Skeleton className="h-3 w-24 mb-3" />
            <div className="flex items-baseline gap-4 mb-2">
              <Skeleton className="h-12 w-16" />
              <Skeleton className="h-5 w-48" />
            </div>
            <Skeleton className="h-4 w-56 mt-2" />
            <div className="mt-6 pt-5 border-t border-rule">
              <Skeleton className="h-3 w-40 mb-4" />
              <div className="flex items-end gap-2 h-24">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton
                    key={i}
                    className="flex-1 rounded-sm"
                    style={{ height: `${30 + Math.random() * 60}%` }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Next meeting card */}
          <div className="rounded-xl border border-rule bg-card p-6">
            <Skeleton className="h-3 w-20 mb-4" />
            <Skeleton className="h-5 w-3/4 mb-1" />
            <Skeleton className="h-4 w-1/3 mb-4" />
            <Skeleton className="h-4 w-2/3 mb-5" />
            <Skeleton className="h-10 w-28 rounded-md" />
          </div>

          {/* Outstanding items */}
          <div className="col-span-1 lg:col-span-2 rounded-xl border border-rule bg-card p-6">
            <div className="flex items-center justify-between mb-5">
              <Skeleton className="h-5 w-40" />
              <div className="flex gap-1">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-16 rounded-full" />
                ))}
              </div>
            </div>
            <div className="space-y-4">
              {Array.from({ length: 2 }).map((_, g) => (
                <div key={g}>
                  <div className="flex items-center gap-3 mb-3">
                    <Skeleton className="size-2 rounded-full" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <div className="space-y-1">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5"
                      >
                        <Skeleton className="size-5 rounded" />
                        <Skeleton className="h-4 flex-1" />
                        <Skeleton className="h-5 w-16 rounded-full" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sidebar cards */}
          <div className="space-y-5">
            <div className="rounded-xl border border-rule bg-card p-6">
              <Skeleton className="h-5 w-24 mb-4" />
              <div className="space-y-1">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                    <Skeleton className="size-4 rounded" />
                    <Skeleton className="h-4 flex-1" />
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-rule bg-card p-6">
              <Skeleton className="h-5 w-36 mb-4" />
              <div className="space-y-2.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Skeleton className="size-2 rounded-full" />
                      <Skeleton className="h-4 w-12" />
                    </div>
                    <Skeleton className="h-5 w-8" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
