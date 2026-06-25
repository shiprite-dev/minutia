export type ReminderChannel = "email" | "slack" | "webhook" | "clipboard";

export type ReminderChannelConfig = {
  smtpConfigured?: boolean;
  resendConfigured?: boolean;
  slackWebhookUrl?: string | null;
  reminderWebhookUrl?: string | null;
};

export function resolveReminderChannel(config: ReminderChannelConfig): ReminderChannel {
  if (config.smtpConfigured || config.resendConfigured) return "email";
  if (config.slackWebhookUrl) return "slack";
  if (config.reminderWebhookUrl) return "webhook";
  return "clipboard";
}
