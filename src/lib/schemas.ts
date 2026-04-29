import { z } from "zod";

const issueCategoryEnum = z.enum(["action", "decision", "info", "risk", "blocker"]);
const issueStatusEnum = z.enum(["open", "in_progress", "pending", "resolved", "dropped"]);
const priorityEnum = z.enum(["low", "medium", "high", "critical"]);
const cadenceEnum = z.enum(["weekly", "biweekly", "monthly", "adhoc"]);
const sharePermissionEnum = z.enum(["view", "comment"]);
const shareResourceTypeEnum = z.enum(["meeting", "series", "issue"]);
const themeEnum = z.enum(["light", "dark", "system"]);

export const createSeriesSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  cadence: cadenceEnum,
  default_attendees: z.array(z.string()),
});

export const createMeetingSchema = z.object({
  series_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  date: z.iso.datetime(),
  attendees: z.array(z.string()),
});

export const createIssueSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  category: issueCategoryEnum,
  priority: priorityEnum,
  owner_name: z.string().optional(),
  due_date: z.iso.date().nullable().optional(),
});

export const updateIssueStatusSchema = z.object({
  status: issueStatusEnum,
  note: z.string().optional(),
});

export const createDecisionSchema = z.object({
  title: z.string().min(1).max(500),
  rationale: z.string().optional(),
  made_by: z.string().optional(),
});

export const createGuestShareSchema = z.object({
  resource_type: shareResourceTypeEnum,
  resource_id: z.string().uuid(),
  expires_at: z.iso.datetime().optional(),
  permissions: sharePermissionEnum,
});

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(100),
  settings: z
    .object({
      theme: themeEnum,
      email_recaps: z.boolean(),
      default_cadence: cadenceEnum,
    })
    .partial()
    .optional(),
});

export const quickAddIssueSchema = z.object({
  title: z.string().min(1).max(500),
  category: issueCategoryEnum.optional(),
});

export type CreateSeriesInput = z.infer<typeof createSeriesSchema>;
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;
export type CreateIssueInput = z.infer<typeof createIssueSchema>;
export type UpdateIssueStatusInput = z.infer<typeof updateIssueStatusSchema>;
export type CreateDecisionInput = z.infer<typeof createDecisionSchema>;
export type CreateGuestShareInput = z.infer<typeof createGuestShareSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type QuickAddIssueInput = z.infer<typeof quickAddIssueSchema>;
