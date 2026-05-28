import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export type OutboxEmail = {
  to: string | string[];
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
};

export const OUTBOX_PATH =
  process.env.MINUTIA_TEST_EMAIL_OUTBOX ??
  path.join(process.cwd(), "test-results", "meeting-notes-email-outbox.jsonl");

const LOCK_PATH = `${OUTBOX_PATH}.lock`;
const LOCK_TIMEOUT_MS = 30_000;
const STALE_LOCK_MS = 60_000;

async function acquireOutboxLock() {
  const startedAt = Date.now();

  while (true) {
    try {
      await mkdir(LOCK_PATH, { recursive: false });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

      const lockStats = await stat(LOCK_PATH).catch(() => null);
      if (lockStats && Date.now() - lockStats.mtimeMs > STALE_LOCK_MS) {
        await rm(LOCK_PATH, { recursive: true, force: true });
        continue;
      }

      if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
        throw new Error("Timed out waiting for test email outbox lock");
      }

      await delay(100);
    }
  }
}

export async function withOutbox<T>(fn: () => Promise<T>): Promise<T> {
  await acquireOutboxLock();

  try {
    await rm(OUTBOX_PATH, { force: true });
    return await fn();
  } finally {
    await rm(LOCK_PATH, { recursive: true, force: true });
  }
}

export async function readOutbox(): Promise<OutboxEmail[]> {
  const content = await readFile(OUTBOX_PATH, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });

  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OutboxEmail);
}
