export const FINISHING_LIMIT_MS = 90_000;

interface FinishingInput {
  autoRecap: boolean;
  openedAt: number;
  now: number;
  transcriptRaw: string | null;
  transcriptionStatus: string | null;
}

const landed = (transcriptRaw: string | null, status: string | null) =>
  status === "completed" && !!transcriptRaw?.trim();

export function isFinishing({
  autoRecap,
  openedAt,
  now,
  transcriptRaw,
  transcriptionStatus,
}: FinishingInput): boolean {
  return (
    autoRecap &&
    transcriptionStatus !== "failed" &&
    transcriptionStatus !== "completed" &&
    !landed(transcriptRaw, transcriptionStatus) &&
    now - openedAt < FINISHING_LIMIT_MS
  );
}

export function shouldAutoStartRecap({
  autoRecap,
  transcriptRaw,
  transcriptionStatus,
  hasRecap,
  alreadyStarted,
}: {
  autoRecap: boolean;
  transcriptRaw: string | null;
  transcriptionStatus: string | null;
  hasRecap: boolean;
  alreadyStarted: boolean;
}): boolean {
  return (
    autoRecap &&
    !hasRecap &&
    !alreadyStarted &&
    landed(transcriptRaw, transcriptionStatus)
  );
}
