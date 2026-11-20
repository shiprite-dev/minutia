import { matchSeriesMember } from "@/lib/ai/owner-match";

const QUEUE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MAC_CATEGORIES = new Set(["action", "risk", "blocker"]);

export interface QueueSuggestion {
  id: string;
  type: string;
  category: string;
  title: string;
  owner_name: string;
  due_date: string | null;
  confidence: number;
  related_issue_number: number | null;
  suggested_status: string | null;
}

export interface QueueMeetingInput {
  meeting_id: string;
  series_id: string;
  series_name: string;
  ended_at: string | null;
  transcription_status: string | null;
  suggestions_status: string | null;
  suggestions_reason: string | null;
  status_at: string | null;
  reviewer: boolean;
  suggestions: QueueSuggestion[];
  members: { id: string; name: string }[];
  issueTitles: Record<number, string>;
}

export interface ReviewQueueRow extends QueueSuggestion {
  owner_user_id: string | null;
  related_issue_title: string | null;
}

export interface ReviewQueueMeeting
  extends Omit<QueueMeetingInput, "suggestions" | "issueTitles"> {
  rows: ReviewQueueRow[];
  web_only_count: number;
}

export interface ReviewQueueResponse {
  me: string;
  meetings: ReviewQueueMeeting[];
}

const shownOnMac = (s: QueueSuggestion) =>
  s.type === "status_update" ||
  (s.type === "new_item" && MAC_CATEGORIES.has(s.category));

function shape(m: QueueMeetingInput): ReviewQueueMeeting {
  const { suggestions, issueTitles, ...rest } = m;
  const shown = suggestions.filter(shownOnMac);
  return {
    ...rest,
    rows: shown.map((s) => ({
      id: s.id,
      type: s.type,
      category: s.category,
      title: s.title,
      owner_name: s.owner_name,
      owner_user_id: matchSeriesMember(s.owner_name, m.members),
      due_date: s.due_date,
      confidence: s.confidence,
      related_issue_number: s.related_issue_number,
      related_issue_title:
        s.type === "status_update" && s.related_issue_number !== null
          ? (issueTitles[s.related_issue_number] ?? null)
          : null,
      suggested_status: s.suggested_status,
    })),
    web_only_count: suggestions.length - shown.length,
  };
}

export function buildReviewQueue(input: {
  me: string;
  now: Date;
  meetings: QueueMeetingInput[];
  mode: "list" | "meeting";
}): ReviewQueueResponse {
  const shaped = input.meetings.map(shape);
  if (input.mode === "meeting") return { me: input.me, meetings: shaped };

  const cutoff = input.now.getTime() - QUEUE_WINDOW_MS;
  const meetings = shaped
    .filter(
      (m) =>
        m.reviewer &&
        m.rows.length > 0 &&
        m.ended_at !== null &&
        Date.parse(m.ended_at) >= cutoff,
    )
    .sort((a, b) => Date.parse(b.ended_at!) - Date.parse(a.ended_at!));
  return { me: input.me, meetings };
}
