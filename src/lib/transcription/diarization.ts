// ---------------------------------------------------------------------------
// Pure diarization helpers: resolve provider speaker labels (A/B/C) to series
// attendees, and flatten labelled segments into attributed transcript text.
// No provider calls, no Supabase; deterministic over inputs so it unit-tests in
// isolation. This is what turns "who said what" into "who owns what".
// ---------------------------------------------------------------------------

import type { TranscriptionSegment } from "./shared";

export interface SpeakerProposal {
  speaker: string;
  attendee: string | null;
  confidence: number;
  reason: "self_intro" | "name_mention" | "roster_single" | "unresolved";
}

export interface SpeakerMapResult {
  map: Record<string, string | null>;
  proposals: SpeakerProposal[];
}

/** First name, lowercased, for loose matching against spoken cues. */
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

/** Detect "this is X" / "I'm X" / "X here" self-introductions in a turn. */
function selfIntroName(text: string, attendees: string[]): string | null {
  const lower = text.toLowerCase();
  for (const attendee of attendees) {
    const fn = firstName(attendee);
    if (!fn) continue;
    if (
      lower.includes(`this is ${fn}`) ||
      lower.includes(`i'm ${fn}`) ||
      lower.includes(`i am ${fn}`) ||
      lower.includes(`${fn} here`)
    ) {
      return attendee;
    }
  }
  return null;
}

/**
 * Propose speaker -> attendee assignments. Never invents an owner: unresolved
 * speakers map to null and are surfaced for a two-click human confirm. Priority:
 * priorMap (cross-meeting stability) > self-introduction > single-attendee
 * fallback. Each attendee is claimed by at most one speaker.
 */
export function resolveSpeakerMap(
  segments: TranscriptionSegment[],
  attendees: string[],
  priorMap?: Record<string, string | null>
): SpeakerMapResult {
  const speakers = [...new Set(segments.map((s) => s.speaker))];
  const map: Record<string, string | null> = {};
  const proposals: SpeakerProposal[] = [];
  const claimed = new Set<string>();

  const claim = (speaker: string, attendee: string | null, reason: SpeakerProposal["reason"], confidence: number) => {
    map[speaker] = attendee;
    if (attendee) claimed.add(attendee);
    proposals.push({ speaker, attendee, confidence, reason });
  };

  // Pass 1: honor a prior map for speakers whose label recurs.
  for (const speaker of speakers) {
    const prior = priorMap?.[speaker];
    if (prior && attendees.includes(prior) && !claimed.has(prior)) {
      claim(speaker, prior, "self_intro", 0.75);
    }
  }

  // Pass 2: self-introductions in this meeting.
  for (const speaker of speakers) {
    if (map[speaker] !== undefined) continue;
    const intro = segments
      .filter((s) => s.speaker === speaker)
      .map((s) => selfIntroName(s.text, attendees))
      .find((name): name is string => name != null && !claimed.has(name));
    if (intro) claim(speaker, intro, "self_intro", 0.95);
  }

  // Pass 3: exactly one speaker and one unclaimed attendee -> the only person.
  const unresolved = speakers.filter((s) => map[s] === undefined);
  const unclaimed = attendees.filter((a) => !claimed.has(a));
  if (unresolved.length === 1 && unclaimed.length === 1) {
    claim(unresolved[0], unclaimed[0], "roster_single", 0.5);
  }

  // Remainder: unresolved, never guessed.
  for (const speaker of speakers) {
    if (map[speaker] === undefined) claim(speaker, null, "unresolved", 0);
  }

  return { map, proposals };
}

/** "Speaker A" label for an unmapped provider speaker. */
function displayLabel(speaker: string): string {
  return /^[A-Za-z]$/.test(speaker) ? `Speaker ${speaker.toUpperCase()}` : `Speaker ${speaker}`;
}

/**
 * Render segments as attributed turns ("Name: text"), merging consecutive
 * segments from the same speaker into one turn. Unmapped speakers render as
 * "Speaker A". This string becomes transcript_raw, so the existing extractor
 * and every text consumer see attribution for free.
 */
export function flattenSegments(
  segments: TranscriptionSegment[],
  speakerMap?: Record<string, string | null>
): string {
  const lines: string[] = [];
  let currentSpeaker: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentSpeaker == null || buffer.length === 0) return;
    const name = speakerMap?.[currentSpeaker]?.trim() || displayLabel(currentSpeaker);
    lines.push(`${name}: ${buffer.join(" ")}`);
    buffer = [];
  };

  for (const s of segments) {
    if (s.speaker !== currentSpeaker) {
      flush();
      currentSpeaker = s.speaker;
    }
    const text = s.text.trim();
    if (text) buffer.push(text);
  }
  flush();
  return lines.join("\n");
}
