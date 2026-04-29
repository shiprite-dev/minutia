import { Inbox } from "lucide-react";

export default function InboxPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-4 lg:p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-paper-2">
          <Inbox className="size-5 text-ink-3" />
        </div>
        <p className="text-sm text-ink-2">Inbox coming soon.</p>
        <p className="max-w-xs text-xs text-ink-3">
          Notifications, mentions, and updates from your meetings will appear here.
        </p>
      </div>
    </div>
  );
}
