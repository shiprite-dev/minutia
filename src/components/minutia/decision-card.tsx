import { cn } from "@/lib/utils";
import type { Decision } from "@/lib/types";

// The decision "mark": a small accent diamond. This is the single, consistent
// signal for a decision across the app (card headers, timeline rows), replacing
// the colored left-border card that read as generic.
export function DecisionMark({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 rotate-45 rounded-[1px] bg-accent", className)} />;
}

interface DecisionCardProps {
  decision: Pick<Decision, "title" | "rationale" | "made_by">;
  compact?: boolean;
  className?: string;
}

// Shared decision renderer. `compact` is the inline timeline row; the default is
// the full card used on meeting and series detail. No colored border by design.
export function DecisionCard({ decision, compact, className }: DecisionCardProps) {
  if (compact) {
    return (
      <div className={cn("flex items-start gap-2.5 py-1.5", className)}>
        <DecisionMark className="mt-[6px] shrink-0" />
        <span className="text-sm leading-snug text-ink">{decision.title}</span>
      </div>
    );
  }

  return (
    <article className={cn("rounded-lg border border-rule bg-card px-4 py-3.5 shadow-[var(--shadow-raised)]", className)}>
      <div className="flex items-center gap-2">
        <DecisionMark />
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-ink-3">Decision</span>
      </div>
      <p className="mt-2 text-sm font-medium leading-snug text-ink">{decision.title}</p>
      {decision.rationale && (
        <p className="mt-1 text-xs leading-relaxed text-ink-2">{decision.rationale}</p>
      )}
      {decision.made_by && (
        <p className="mt-2.5 border-t border-rule/60 pt-2 font-mono text-[11px] text-ink-4">
          Decided by {decision.made_by}
        </p>
      )}
    </article>
  );
}
