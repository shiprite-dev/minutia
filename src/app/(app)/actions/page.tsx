import { EmptyState } from "@/components/minutia/empty-state";

export default function MyActionsPage() {
  return (
    <div className="flex flex-1 flex-col p-4 lg:p-6">
      <EmptyState variant="no-actions" />
    </div>
  );
}
