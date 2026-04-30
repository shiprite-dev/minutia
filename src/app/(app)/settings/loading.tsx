import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="min-h-full bg-paper">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        <Skeleton className="h-7 w-24 mb-8" />
        <div className="space-y-6">
          {/* Profile card */}
          <div className="rounded-xl border border-rule bg-card p-6">
            <Skeleton className="h-5 w-16 mb-4" />
            <div className="space-y-4">
              <div>
                <Skeleton className="h-3 w-12 mb-2" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
              <div>
                <Skeleton className="h-3 w-12 mb-2" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
            </div>
          </div>

          {/* Theme card */}
          <div className="rounded-xl border border-rule bg-card p-6">
            <Skeleton className="h-5 w-20 mb-4" />
            <div className="flex gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-24 rounded-md" />
              ))}
            </div>
          </div>

          {/* Export card */}
          <div className="rounded-xl border border-rule bg-card p-6">
            <Skeleton className="h-5 w-28 mb-4" />
            <div className="flex gap-3">
              <Skeleton className="h-9 w-28 rounded-md" />
              <Skeleton className="h-9 w-28 rounded-md" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
