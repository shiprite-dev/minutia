"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { AI_UNAVAILABLE_MESSAGE, useAiNoticeUrl } from "@/lib/hooks/use-ai-access";
import { resolveAiNoticeCta, AI_NOTICE_DEFAULT_CTA_LABEL } from "@/lib/ai/notice";
import { startUpgrade } from "@/lib/billing/upgrade-actions";

// Neutral upsell seam: shows why AI is unavailable and, when the instance has
// configured a destination (instance_config.ai_notice_url), a neutral CTA so the
// surface never dead-ends. The OSS build carries no plan or price language.
//
// Finding 4 fix: when upgradeEnabled is true the button always renders, even if
// the operator has not set ai_notice_url, so a correctly-configured hosted
// instance never silently loses the upgrade path.
export function AiUnavailableNotice({ className }: { className?: string }) {
  const { data } = useAiNoticeUrl();
  const cta = resolveAiNoticeCta(data?.ctaUrl);
  const [upgradeError, setUpgradeError] = useState(false);
  const [isPending, setIsPending] = useState(false);

  async function handleUpgrade() {
    if (isPending) return;
    setIsPending(true);
    setUpgradeError(false);
    const ok = await startUpgrade();
    // On success the browser navigates away; only reset on failure.
    if (!ok) {
      setIsPending(false);
      setUpgradeError(true);
    }
  }

  return (
    <div
      role="status"
      data-testid="ai-unavailable-notice"
      className={`flex flex-col rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-ink ${className ?? ""}`}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 shrink-0 text-accent" />
        <span>{AI_UNAVAILABLE_MESSAGE}</span>
        {data?.upgradeEnabled ? (
          <button
            type="button"
            onClick={handleUpgrade}
            disabled={isPending}
            aria-disabled={isPending}
            className="ml-auto shrink-0 font-medium text-accent underline underline-offset-2 hover:text-accent-hover disabled:opacity-60 disabled:cursor-default"
          >
            {isPending ? "Starting…" : (cta?.label ?? AI_NOTICE_DEFAULT_CTA_LABEL)}
          </button>
        ) : cta ? (
          <a
            href={cta.href}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto shrink-0 font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
          >
            {cta.label}
          </a>
        ) : null}
      </div>
      {upgradeError && (
        <p className="mt-1 text-xs text-ink-3">
          Could not start the upgrade. Please try again.
        </p>
      )}
    </div>
  );
}
