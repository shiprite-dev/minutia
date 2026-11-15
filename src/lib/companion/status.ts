import type { Meeting } from "@/lib/types";

export const COMPANION_ONLINE_MS = 90_000;
export const REQUEST_WINDOW_MS = 30_000;
export const CLAIM_START_MS = 20_000;

export type CompanionRecordStatus =
  | { kind: "none" }
  | { kind: "recording"; deviceName: string; mine: boolean }
  | { kind: "lost" }
  | { kind: "starting" }
  | { kind: "failed" }
  | { kind: "offer_online" }
  | { kind: "offer_open" }
  | { kind: "offer_legacy" }
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
  | "recording_seen_at"
  | "recording_failed_reason"
>;

const age = (value: string | Date, now: number) =>
  now - new Date(value).getTime();

export function companionRecordStatus({
  meeting,
  userId,
  checkinAt,
  legacySeenAt,
  isMac,
  now,
}: {
  meeting: StatusMeeting;
  userId: string | null | undefined;
  checkinAt: string | null | undefined;
  legacySeenAt: string | null | undefined;
  isMac: boolean;
  now: number;
}): CompanionRecordStatus {
  if (meeting.status !== "live") return { kind: "none" };

  const holder = meeting.recording_user_id;
  const mine = !!holder && holder === userId;

  if (holder && meeting.recording_started_at) {
    const fresh =
      !!meeting.recording_seen_at &&
      age(meeting.recording_seen_at, now) <= COMPANION_ONLINE_MS;
    if (fresh) {
      return {
        kind: "recording",
        deviceName: meeting.recording_device_name ?? "a Mac",
        mine,
      };
    }
    if (mine) return { kind: "lost" };
  } else if (holder && meeting.record_claimed_at) {
    const fresh = age(meeting.record_claimed_at, now) <= CLAIM_START_MS;
    if (mine) return fresh ? { kind: "starting" } : { kind: "lost" };
    if (fresh) return { kind: "none" };
  }

  if (
    meeting.recording_failed_reason &&
    meeting.recording_failed_reason !== "in_browser" &&
    meeting.record_requested_by === userId
  ) {
    return { kind: "failed" };
  }

  if (
    meeting.record_requested_at &&
    meeting.record_requested_by === userId &&
    age(meeting.record_requested_at, now) <= REQUEST_WINDOW_MS
  ) {
    return { kind: "starting" };
  }

  if (checkinAt) {
    if (age(checkinAt, now) <= COMPANION_ONLINE_MS) return { kind: "offer_online" };
    return isMac ? { kind: "offer_open" } : { kind: "none" };
  }
  if (legacySeenAt) return isMac ? { kind: "offer_legacy" } : { kind: "none" };
  return isMac ? { kind: "install" } : { kind: "none" };
}
