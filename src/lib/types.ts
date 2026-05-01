export type IssueCategory = "action" | "decision" | "info" | "risk" | "blocker";
export type IssueStatus = "open" | "in_progress" | "pending" | "resolved" | "dropped";
export type Priority = "low" | "medium" | "high" | "critical";
export type MeetingStatus = "upcoming" | "live" | "completed";
export type Cadence = "weekly" | "biweekly" | "monthly" | "adhoc";
export type ItemSource = "manual" | "transcript" | "email" | "api" | "ai_suggested";
export type AuthorType = "human" | "ai" | "system";
export type SharePermission = "view" | "comment";
export type ShareResourceType = "meeting" | "series" | "issue";
export type Theme = "light" | "dark" | "system";

export interface Profile {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  has_completed_onboarding: boolean;
  created_at: Date;
  updated_at: Date;
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
  owner_id: string;
  name: string;
  description: string | null;
  cadence: Cadence;
  default_attendees: string[];
  gcal_calendar_id: string | null;
  gcal_sync_enabled: boolean;
  created_at: Date;
  updated_at: Date;
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

export interface GoogleCalendarStatus {
  connected: boolean;
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
  transcript_raw: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface Issue {
  id: string;
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

export interface IssueUpdate {
  id: string;
  issue_id: string;
  meeting_id: string;
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
