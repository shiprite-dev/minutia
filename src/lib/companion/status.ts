import type { Meeting } from "@/lib/types";

export const COMPANION_ONLINE_MS = 90_000;
const REQUEST_PICKUP_MS = 10_000;
const CLAIM_START_MS = 20_000;

export type CompanionRecordStatus =
  | { kind: "none" }
  | { kind: "recording"; deviceName: string; mine: boolean }
  | { kind: "lost" }
  | { kind: "starting" }
  | { kind: "failed" }
  | { kind: "offer_online" }
  | { kind: "offer_open" }
  | { kind: "install" };

type StatusMeeting = Pick<
  Meeting,
  | "status"
  | "record_requested_at"
  | "record_requested_by"
  | "recording_user_id"
  | "recording_device_name"
  | "record_claimed_at"
  | "recording_started_at"
  | "recording_failed_reason"
>;

const age = (value: string | Date, now: number) =>
  now - new Date(value).getTime();

export function companionRecordStatus({
  meeting,
  userId,
  lastSeenAt,
  isMac,
  now,
}: {
  meeting: StatusMeeting;
  userId: string | null | undefined;
  lastSeenAt: string | null | undefined;
  isMac: boolean;
  now: number;
}): CompanionRecordStatus {
  if (meeting.status !== "live") return { kind: "none" };

  const online = !!lastSeenAt && age(lastSeenAt, now) <= COMPANION_ONLINE_MS;

  if (meeting.recording_started_at && meeting.recording_user_id) {
    const mine = meeting.recording_user_id === userId;
    if (mine && !online) return { kind: "lost" };
    return {
      kind: "recording",
      deviceName: meeting.recording_device_name ?? "a Mac",
      mine,
    };
  }

  if (meeting.record_claimed_at && meeting.recording_user_id) {
    return age(meeting.record_claimed_at, now) <= CLAIM_START_MS
      ? { kind: "starting" }
      : { kind: "lost" };
  }

  if (meeting.recording_failed_reason) return { kind: "failed" };

  if (
    online &&
    meeting.record_requested_at &&
    meeting.record_requested_by === userId &&
    age(meeting.record_requested_at, now) <= REQUEST_PICKUP_MS
  ) {
    return { kind: "starting" };
  }

  if (online) return { kind: "offer_online" };
  if (lastSeenAt) return isMac ? { kind: "offer_open" } : { kind: "none" };
  return isMac ? { kind: "install" } : { kind: "none" };
}
