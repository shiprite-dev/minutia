export const COMPANION_NOTES_HEADING = "## From the desktop notepad";
export const COMPANION_NOTES_MAX_LENGTH = 100_000;

/** The notes an AI reader or a human should see: the web notes, plus the
 * companion's own notes under a heading. Idempotent, so a composed value fed
 * back in unchanged. */
export function composeMeetingNotes(meeting: {
  raw_notes_markdown?: string | null;
  notes_markdown?: string | null;
  companion_notes_markdown?: string | null;
}): string {
  const base = meeting.raw_notes_markdown || meeting.notes_markdown || "";
  const companion = (meeting.companion_notes_markdown ?? "").trim();
  if (!companion) return base;
  if (!base.trim()) return companion;
  if (base.includes(companion)) return base;
  return `${base.trimEnd()}\n\n${COMPANION_NOTES_HEADING}\n\n${companion}`;
}
