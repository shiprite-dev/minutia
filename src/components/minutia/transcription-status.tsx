"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

export type TranscriptionUiState =
  | "recording"
  | "paused"
  | "mic_denied"
  | "saving"
  | "saved_pending"
  | "transcribing"
  | "transcribing_stale"
  | "processing_return"
  | "transcript_ready"
  | "extraction_failed"
  | "no_speech"
  | "empty_unknown"
  | "no_recording"
  | "failed"
  | "failed_unknown"
  | "needs_admin"
  | "needs_signin"
  | "already_running"
  | "input_mismatch"
  | "buffered_local"
  | "buffered_failed"
  | "deleted";

export interface TranscriptionStatusProps {
  state: TranscriptionUiState;
  /** Parts transcribed so far, for the "N of M parts transcribed" copy. */
  partsDone?: number;
  /** Total parts for the selected work. Only counted when it is known. */
  partsTotal?: number;
  /** Seconds elapsed in the current transcription run. */
  elapsedSeconds?: number;
  /** Minutes since the run started, or null when the start time is unknown. */
  startedMinutesAgo?: number | null;
  /** Humanized failure reason, already safe to show. */
  reason?: string | null;
  /** True when a retrievable recording still exists. */
  canDownloadAudio?: boolean;
  /** Focus target for the "View status" action. */
  regionRef?: React.Ref<HTMLDivElement>;
  onStop?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRetryMicrophone?: () => void;
  onRetryTranscription?: () => void;
  onDownloadAudio?: () => void;
  onRetryActionItems?: () => void;
  onAddNotes?: () => void;
  onEditTranscript?: () => void;
  onReviewActionItems?: () => void;
  onViewStatus?: () => void;
  onRefreshStatus?: () => void;
  onRetryUpload?: () => void;
  onBackToSeries?: () => void;
  onContactAdmin?: () => void;
  onSignIn?: () => void;
}

interface StatusAction {
  label: string;
  onClick?: () => void;
}

interface StatusView {
  title: string;
  details: string[];
  primary?: StatusAction;
  secondary?: StatusAction;
  alert: boolean;
}

// Progress states carry no action and say so, so a waiting user is never left
// wondering whether they should do something.
const PASSIVE_STATES: TranscriptionUiState[] = [
  "saving",
  "saved_pending",
  "transcribing",
  "processing_return",
];

const ADMIN_HELP =
  "This workspace has not been set up for transcription yet. Ask your administrator.";
const SIGNIN_HELP = "Your session expired. Please sign in again.";

/** Pure state to copy/action mapping, exported so the copy contract can be
 * asserted without a browser. */
export function resolveTranscriptionView(props: TranscriptionStatusProps): StatusView {
  const {
    state,
    partsDone,
    partsTotal,
    elapsedSeconds,
    startedMinutesAgo,
    reason,
    canDownloadAudio,
  } = props;

  switch (state) {
    case "recording": {
      const details: string[] = [];
      if (partsDone && partsDone > 0) details.push(`${partsDone} parts transcribed`);
      return {
        title: "Recording…",
        details,
        primary: { label: "Stop", onClick: props.onStop },
        secondary: { label: "Pause", onClick: props.onPause },
        alert: false,
      };
    }
    case "paused":
      return {
        title: "Recording paused.",
        details: [],
        primary: { label: "Resume", onClick: props.onResume },
        secondary: { label: "Stop", onClick: props.onStop },
        alert: false,
      };
    case "mic_denied":
      return {
        title: reason ?? "Could not start the microphone.",
        details: [],
        primary: { label: "Try microphone again", onClick: props.onRetryMicrophone },
        alert: true,
      };
    case "saving":
      return {
        title: "Saving your recording… Keep this page open until it is saved.",
        details: [],
        alert: false,
      };
    case "saved_pending":
      return {
        title: "Recording saved. Preparing transcription…",
        details: [],
        alert: false,
      };
    case "transcribing": {
      const details: string[] = [];
      if (partsTotal && partsTotal > 0 && typeof partsDone === "number") {
        details.push(`${partsDone} of ${partsTotal} parts transcribed`);
      }
      if (typeof elapsedSeconds === "number" && elapsedSeconds >= 60) {
        details.push("Long recordings can take a few minutes.");
      }
      return { title: "Transcribing…", details, alert: false };
    }
    case "transcribing_stale":
      return {
        title: "Transcription is taking longer than expected.",
        details: [],
        primary: { label: "Retry transcription", onClick: props.onRetryTranscription },
        alert: false,
      };
    case "processing_return":
      return {
        title: "Still transcribing this recording…",
        details:
          typeof startedMinutesAgo === "number"
            ? [`Started ${startedMinutesAgo} minutes ago`]
            : [],
        alert: false,
      };
    case "transcript_ready":
      return {
        title: "Transcript ready. Check action items below.",
        details: [],
        primary: { label: "Review action items", onClick: props.onReviewActionItems },
        secondary: { label: "Edit transcript", onClick: props.onEditTranscript },
        alert: false,
      };
    case "extraction_failed":
      return {
        title: "Your transcript is ready, but action items could not be created.",
        details: [],
        primary: { label: "Retry action items", onClick: props.onRetryActionItems },
        alert: true,
      };
    case "no_speech":
      return {
        title: "No speech detected in this recording.",
        details: ["You can still write notes and get action items."],
        primary: { label: "Add notes", onClick: props.onAddNotes },
        alert: false,
      };
    case "empty_unknown":
      return {
        title: "No transcript is available for this recording.",
        details: [],
        primary: { label: "Add notes", onClick: props.onAddNotes },
        alert: false,
      };
    case "no_recording":
      return {
        title: "No recording or transcript is available for this meeting.",
        details: [],
        primary: { label: "Add notes", onClick: props.onAddNotes },
        alert: false,
      };
    case "failed":
      return {
        title: reason ?? "Transcription did not finish.",
        details: [],
        primary: { label: "Retry transcription", onClick: props.onRetryTranscription },
        secondary: canDownloadAudio
          ? { label: "Download audio", onClick: props.onDownloadAudio }
          : undefined,
        alert: true,
      };
    case "failed_unknown":
      return {
        title: "Transcription did not finish.",
        details: [],
        primary: { label: "Retry transcription", onClick: props.onRetryTranscription },
        alert: true,
      };
    case "needs_admin":
      return {
        title: ADMIN_HELP,
        details: [],
        primary: { label: "Contact administrator", onClick: props.onContactAdmin },
        alert: true,
      };
    case "needs_signin":
      return {
        title: SIGNIN_HELP,
        details: [],
        primary: { label: "Sign in", onClick: props.onSignIn },
        alert: true,
      };
    case "already_running":
      return {
        title: "This recording is already being transcribed.",
        details: [],
        primary: { label: "View status", onClick: props.onViewStatus },
        alert: false,
      };
    case "input_mismatch":
      return {
        title: "This recording changed. Refresh to see its current status.",
        details: [],
        primary: { label: "Refresh status", onClick: props.onRefreshStatus },
        alert: true,
      };
    case "buffered_local":
      return {
        title:
          "Recording saved on this device. Reopen this meeting on this device to upload it.",
        details: [],
        primary: { label: "Retry upload", onClick: props.onRetryUpload },
        alert: true,
      };
    case "buffered_failed":
      return {
        title:
          "Your recording could not be saved on this device. Keep this page open and retry saving.",
        details: [],
        primary: { label: "Retry saving", onClick: props.onRetryUpload },
        alert: true,
      };
    case "deleted":
      return {
        title: "This meeting was deleted or is no longer available.",
        details: [],
        primary: { label: "Back to series", onClick: props.onBackToSeries },
        alert: true,
      };
  }
}

export function TranscriptionStatus(props: TranscriptionStatusProps) {
  const { regionRef, ...viewProps } = props;
  const view = resolveTranscriptionView(viewProps);
  const passive = PASSIVE_STATES.includes(viewProps.state);

  return (
    <section aria-label="Transcription status" className="mb-6">
      <div
        ref={regionRef}
        role={view.alert ? "alert" : "status"}
        aria-live={view.alert ? "assertive" : "polite"}
        tabIndex={-1}
        className="rounded-lg border border-rule bg-card px-4 py-3 shadow-[var(--shadow-raised)] focus:outline-none"
      >
        <p className="text-sm font-medium text-ink">{view.title}</p>
        {view.details.map((detail) => (
          <p key={detail} className="mt-1 text-xs text-ink-3">
            {detail}
          </p>
        ))}
        {passive && (
          <p className="mt-1 text-xs text-ink-4">No action needed.</p>
        )}
        {(view.primary || view.secondary) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {view.primary && (
              <Button type="button" variant="accent" size="sm" onClick={view.primary.onClick}>
                {view.primary.label}
              </Button>
            )}
            {view.secondary && (
              <Button type="button" variant="outline" size="sm" onClick={view.secondary.onClick}>
                {view.secondary.label}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
