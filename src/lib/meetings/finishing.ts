export const FINISHING_LIMIT_MS = 90_000;

interface FinishingInput {
  autoRecap: boolean;
  openedAt: number;
  now: number;
  transcriptionStatus: string | null;
}

export function isFinishing({
  autoRecap,
  openedAt,
  now,
  transcriptionStatus,
}: FinishingInput): boolean {
  return (
    autoRecap &&
    transcriptionStatus !== "failed" &&
    transcriptionStatus !== "completed" &&
    now - openedAt < FINISHING_LIMIT_MS
  );
}
