"use client";

import { Sparkles } from "lucide-react";
import { AI_UNAVAILABLE_MESSAGE, useAiNoticeUrl } from "@/lib/hooks/use-ai-access";
import { resolveAiNoticeCta } from "@/lib/ai/notice";

// Neutral upsell seam: shows why AI is unavailable and, when the instance has
// configured a destination (instance_config.ai_notice_url), a neutral CTA so the
// surface never dead-ends. The OSS build carries no plan or price language.
export function AiUnavailableNotice({ className }: { className?: string }) {
  const { data } = useAiNoticeUrl();
  const cta = resolveAiNoticeCta(data?.ctaUrl);
  return (
    <div
      role="status"
      data-testid="ai-unavailable-notice"
      className={`flex items-center gap-2 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-ink ${className ?? ""}`}
    >
      <Sparkles className="size-4 shrink-0 text-accent" />
      <span>{AI_UNAVAILABLE_MESSAGE}</span>
      {cta && (
        <a
          href={cta.href}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto shrink-0 font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
        >
          {cta.label}
        </a>
      )}
    </div>
  );
}
