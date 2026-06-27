import type { AdminCapabilities } from "./capabilities";

const CONFIG_KEY_CAPABILITY: Record<string, keyof AdminCapabilities> = {
  smtp_host: "email",
  smtp_port: "email",
  smtp_user: "email",
  smtp_pass: "email",
  smtp_from: "email",
  ai_provider: "ai",
  ai_base_url: "ai",
  ai_api_key: "ai",
  ai_model: "ai",
  reminder_webhook_url: "reminderWebhook",
  retro_enabled: "retroToggle",
  ai_notice_url: "promptLinks",
  capacity_notice_url: "promptLinks",
  slack_webhook_url: "slackWebhook",
  instance_name: "instanceIdentity",
};

export function rejectedConfigKeys(
  keys: string[],
  caps: AdminCapabilities
): string[] {
  return keys.filter((key) => {
    const cap = CONFIG_KEY_CAPABILITY[key];
    return cap !== undefined && caps[cap] === false;
  });
}
