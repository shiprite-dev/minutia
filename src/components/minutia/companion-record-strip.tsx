"use client";

import * as React from "react";
import { useReducedMotion } from "motion/react";
import { buildCompanionOpenUrl, buildCompanionRecordUrl } from "@/lib/companion-links";
import type { CompanionRecordStatus } from "@/lib/companion/status";
import { cn } from "@/lib/utils";

const actionClass =
  "inline-flex h-8 items-center rounded-lg border border-rule px-2.5 text-xs font-medium text-ink-2 hover:bg-paper-2 hover:text-ink";

function Dot({ pulse }: { pulse?: boolean }) {
  const reduced = useReducedMotion();
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 rounded-full bg-accent",
        pulse && !reduced && "animate-pulse [animation-duration:2s]",
      )}
    />
  );
}

export function CompanionRecordStrip({
  status,
  meetingId,
  canAct,
  onRecordOnMac,
  onOpenMac,
  onRecordHere,
}: {
  status: CompanionRecordStatus;
  meetingId: string;
  canAct: boolean;
  onRecordOnMac: () => void;
  onOpenMac: () => void;
  onRecordHere: () => void;
}) {
  if (status.kind === "recording") {
    return (
      <p role="status" className="flex items-center gap-2 text-xs text-ink-2">
        <Dot />
        Recording on {status.deviceName}
      </p>
    );
  }
  if (!canAct) return null;

  switch (status.kind) {
    case "starting":
      return (
        <p role="status" className="flex items-center gap-2 text-xs text-ink-2">
          <Dot pulse />
          Starting on your Mac…
        </p>
      );
    case "failed":
    case "lost":
      return (
        <div role="status" className="flex items-center gap-2 text-xs text-ink-2">
          {status.kind === "failed"
            ? "Couldn't start on your Mac."
            : "Lost touch with your Mac."}
          <button type="button" onClick={onRecordHere} className={actionClass}>
            Record here instead
          </button>
        </div>
      );
    case "offer_online":
      return (
        <button type="button" onClick={onRecordOnMac} className={actionClass}>
          Record on your Mac
        </button>
      );
    case "offer_open":
      return (
        <a href={buildCompanionOpenUrl()} onClick={onOpenMac} className={actionClass}>
          Open Minutia on your Mac
        </a>
      );
    case "offer_legacy":
      return (
        <a href={buildCompanionRecordUrl(meetingId)} className={actionClass}>
          Record on your Mac
        </a>
      );
    default:
      return null;
  }
}
