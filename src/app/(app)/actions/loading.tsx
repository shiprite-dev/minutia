import { Skeleton } from "@/components/ui/skeleton";

export default function ActionsLoading() {
  return (
    <div className="min-h-full bg-paper">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <Skeleton className="h-7 w-28 mb-8" />
        {Array.from({ length: 3 }).map((_, section) => (
          <div key={section} className="mb-8">
            <Skeleton className="h-4 w-32 mb-4" />
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg border border-rule bg-card px-4 py-3"
                >
                  <Skeleton className="size-5 rounded" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-3 w-20" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
