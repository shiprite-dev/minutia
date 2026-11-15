import { Check } from "lucide-react";
import type { RecapStep } from "@/lib/summary/recap";

const STEPS: { id: RecapStep; label: string }[] = [
  { id: "transcribe", label: "Transcribing" },
  { id: "extract", label: "Finding action items" },
  { id: "recap", label: "Writing recap" },
];

export function RecapProgress({ active, detail }: { active: RecapStep | null; detail?: string }) {
  if (active === null) return null;
  const activeIndex = STEPS.findIndex((step) => step.id === active);
  return (
    <div role="status" aria-live="polite" aria-label="Recap progress" className="mb-8 font-mono text-xs">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {STEPS.map((step, i) => (
          <li
            key={step.id}
            className={
              i < activeIndex
                ? "inline-flex items-center gap-1 text-ink-4"
                : i === activeIndex
                  ? "recap-shimmer text-ink"
                  : "text-ink-4"
            }
          >
            {i > 0 && (
              <span aria-hidden="true" className="mr-2 text-ink-4">
                ·
              </span>
            )}
            {i < activeIndex && <Check className="size-3" aria-hidden="true" />}
            {step.label}
          </li>
        ))}
      </ol>
      {detail && <p className="mt-1 text-ink-4">{detail}</p>}
    </div>
  );
}
