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
  created_at: Date;
  updated_at: Date;
}

export interface Meeting {
  id: string;
  series_id: string;
  title: string;
  date: Date;
  status: MeetingStatus;
  attendees: string[];
  transcript_url: string | null;
  summary: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Issue {
  id: string;
  meeting_id: string;
  series_id: string;
  title: string;
  description: string | null;
  category: IssueCategory;
  status: IssueStatus;
  priority: Priority;
  owner_id: string | null;
  owner_name: string | null;
  source: ItemSource;
  due_date: Date | null;
  resolved_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface IssueUpdate {
  id: string;
  issue_id: string;
  meeting_id: string | null;
  author_id: string | null;
  author_type: AuthorType;
  old_status: IssueStatus;
  new_status: IssueStatus;
  note: string | null;
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

export type IssueWithUpdates = Issue & {
  updates: IssueUpdate[];
  raised_in_meeting: Meeting;
};

export type SeriesWithMeetings = MeetingSeries & {
  meetings: Meeting[];
  open_issues_count: number;
};
