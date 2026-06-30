export type IssueCategory = "action" | "decision" | "info" | "risk" | "blocker";
export type IssueStatus = "open" | "in_progress" | "pending" | "resolved" | "dropped";
export type Priority = "low" | "medium" | "high" | "critical";
export type MeetingStatus = "upcoming" | "live" | "completed";
export type Cadence = "daily" | "weekly" | "biweekly" | "monthly" | "adhoc";
export type ItemSource = "manual" | "transcript" | "email" | "api" | "ai_suggested";
export type AuthorType = "human" | "ai" | "system";
export type SharePermission = "view" | "comment";
export type ShareResourceType = "meeting" | "series" | "issue";
export type Theme = "light" | "dark" | "system";
export type UserRole = "user" | "admin";
export type TranscriptionStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";
export type RecordingState = "idle" | "recording" | "paused" | "stopped";
export type OrganizationRole = "admin" | "member";
export type SeriesParticipantRole = "owner" | "facilitator" | "participant";
// MIN-121: how an AI suggestion relates to the existing OIL.
export type SuggestionType = "new_item" | "status_update" | "duplicate_warning";

export interface Profile {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: UserRole;
  has_completed_onboarding: boolean;
  current_organization_id: string | null;
  has_full_access: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrganizationMember {
  organization_id: string;
  user_id: string;
  role: OrganizationRole;
  invited_by: string | null;
  joined_at: Date;
  created_at: Date;
}

export interface OrganizationOption {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
}

export interface OrganizationInvitation {
  id: string;
  organization_id: string;
  email: string;
  role: OrganizationRole;
  status: "pending" | "accepted" | "revoked";
  invited_by: string;
  accepted_by: string | null;
  created_at: Date;
  accepted_at: Date | null;
}

export interface InstanceConfig {
  id: string;
  key: string;
  value: string | null;
  encrypted: boolean;
  updated_at: Date;
  updated_by: string | null;
}

export interface UserSettings {
  id: string;
  user_id: string;
  theme: Theme;
  email_recaps: boolean;
  default_cadence: Cadence;
  created_at: Date;
  updated_at: Date;
}

export interface MeetingSeries {
  id: string;
  organization_id: string;
  owner_id: string;
  name: string;
  description: string | null;
  cadence: Cadence;
  default_attendees: string[];
  gcal_calendar_id: string | null;
  gcal_sync_enabled: boolean;
  gcal_series_key: string | null;
  gcal_series_kind: "recurring" | "adhoc" | null;
  gcal_last_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SeriesParticipant {
  series_id: string;
  user_id: string;
  role: SeriesParticipantRole;
  invited_by: string | null;
  joined_at: Date;
  created_at: Date;
}

export interface GoogleCalendarEntry {
  id: string;
  summary: string;
  primary: boolean;
}

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  htmlLink?: string;
}

export interface GoogleCalendarAgendaItem {
  id: string;
  calendarId: string;
  eventId: string;
  seriesId: string;
  meetingId: string;
  seriesKind: "recurring" | "adhoc";
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  htmlLink: string | null;
  meetingUrl: string | null;
  attendeeEmails: string[];
  organizerEmail: string | null;
  eventType: string;
  eventStatus: string;
  meetingStatus: MeetingStatus;
}

export interface GoogleCalendarStatus {
  connected: boolean;
  directoryConnected: boolean;
  googleEmail: string | null;
}

export interface Meeting {
  id: string;
  series_id: string;
  sequence_number: number;
  title: string;
  date: Date;
  status: MeetingStatus;
  attendees: string[];
  notes_markdown: string;
  raw_notes_markdown: string | null;
  ai_notes_markdown: string | null;
  ai_notes_generated_at: Date | null;
  ai_notes_model: string | null;
  ai_notes_prompt_version: string | null;
  transcript_raw: string | null;
  audio_file_path: string | null;
  audio_duration_seconds: number | null;
  audio_file_size_bytes: number | null;
  transcription_status: TranscriptionStatus | null;
  transcription_model: string | null;
  transcription_provider: string | null;
  transcription_started_at: Date | null;
  transcription_completed_at: Date | null;
  gcal_meeting_key: string | null;
  gcal_calendar_id: string | null;
  gcal_event_id: string | null;
  gcal_original_start_time: string | null;
  gcal_meeting_url: string | null;
  gcal_html_link: string | null;
  gcal_last_synced_at: Date | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface Issue {
  id: string;
  issue_number: number;
  raised_in_meeting_id: string;
  series_id: string;
  title: string;
  description: string | null;
  category: IssueCategory;
  status: IssueStatus;
  priority: Priority;
  owner_user_id: string | null;
  owner_name: string | null;
  source: ItemSource;
  due_date: Date | null;
  resolved_in_meeting_id: string | null;
  created_at: Date;
  updated_at: Date;
  update_count?: number;
}

export interface MeetingAiSuggestion {
  id: string;
  meeting_id: string;
  series_id: string;
  type: SuggestionType;
  category: IssueCategory;
  title: string;
  details: string | null;
  owner_name: string | null;
  due_date: Date | string | null;
  confidence: number;
  source_excerpt: string | null;
  // Cross-meeting context: the OIL item this suggestion references, and the
  // status a status_update would move it to. Null for a plain new_item.
  related_issue_number: number | null;
  suggested_status: IssueStatus | null;
  status: "pending" | "accepted" | "rejected";
  ai_model: string | null;
  ai_prompt_version: string | null;
  created_issue_id: string | null;
  created_decision_id: string | null;
  created_at: Date;
  reviewed_at: Date | null;
}

export interface IssueUpdate {
  id: string;
  issue_id: string;
  meeting_id: string | null;
  previous_status: IssueStatus | null;
  new_status: IssueStatus | null;
  note: string | null;
  author_type: AuthorType;
  updated_by: string;
  created_at: Date;
}

export interface Decision {
  id: string;
  meeting_id: string;
  series_id: string;
  title: string;
  rationale: string | null;
  made_by: string | null;
  source: Extract<ItemSource, "manual" | "transcript" | "ai_suggested">;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface GuestShare {
  id: string;
  token: string;
  resource_type: ShareResourceType;
  resource_id: string;
  created_by: string;
  permissions: SharePermission;
  expires_at: Date | null;
  created_at: Date;
}

export type NotificationType =
  | "issue_assigned"
  | "issue_status_changed"
  | "meeting_starting"
  | "meeting_completed"
  | "brief_ready"
  | "share_received";

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  read: boolean;
  link: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export type IssueWithUpdates = Issue & {
  updates: IssueUpdate[];
  raised_in_meeting: Meeting;
};

export type SeriesWithMeetings = MeetingSeries & {
  meetings: Meeting[];
  open_issues_count: number;
};
