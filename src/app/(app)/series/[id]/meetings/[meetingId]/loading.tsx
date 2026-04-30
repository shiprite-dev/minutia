import { Skeleton } from "@/components/ui/skeleton";

export default function MeetingDetailLoading() {
  return (
    <div className="min-h-full bg-paper">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <Skeleton className="h-4 w-48 mb-6" />

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Skeleton className="h-7 w-40 mb-2" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>

        {/* Timeline */}
        <div className="rounded-xl border border-rule bg-card p-6 mb-6">
          <Skeleton className="h-5 w-20 mb-4" />
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-3 rounded-full mt-1 shrink-0" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-full mb-1" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Notes / Decisions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-rule bg-card p-6">
            <Skeleton className="h-5 w-16 mb-4" />
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-3/4 mb-2" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <div className="rounded-xl border border-rule bg-card p-6">
            <Skeleton className="h-5 w-24 mb-4" />
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      </div>
    </div>
  );
}
