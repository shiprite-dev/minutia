"use client";

import { Sparkles } from "lucide-react";

export function AiUnavailableNotice({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={`flex items-center gap-2 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-ink ${className ?? ""}`}
    >
      <Sparkles className="size-4 shrink-0 text-accent" />
      <span>AI features are not enabled for this account.</span>
    </div>
  );
}