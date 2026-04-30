import { Skeleton } from "@/components/ui/skeleton";

export default function IssueDetailLoading() {
  return (
    <div className="min-h-full bg-paper">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <Skeleton className="h-4 w-40 mb-6" />

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded" />
          </div>
          <Skeleton className="h-7 w-3/4 mb-2" />
          <Skeleton className="h-4 w-full mb-1" />
          <Skeleton className="h-4 w-2/3" />
        </div>

        {/* Metadata */}
        <div className="rounded-xl border border-rule bg-card p-6 mb-6">
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="h-3 w-16 mb-2" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </div>

        {/* Timeline */}
        <div className="rounded-xl border border-rule bg-card p-6">
          <Skeleton className="h-5 w-20 mb-4" />
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <Skeleton className="size-3 rounded-full" />
                  {i < 2 && <Skeleton className="w-px h-8 mt-1" />}
                </div>
                <div className="flex-1">
                  <Skeleton className="h-4 w-3/4 mb-1" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
