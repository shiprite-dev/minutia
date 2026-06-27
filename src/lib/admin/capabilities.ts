export type AdminCapabilities = {
  instanceIdentity: boolean;
  email: boolean;
  ai: boolean;
  slackWebhook: boolean;
  reminderWebhook: boolean;
  retroToggle: boolean;
  promptLinks: boolean;
  users: boolean;
  upgradePrompt: boolean;
};

export function isManagedCloud(): boolean {
  return process.env.NEXT_PUBLIC_MANAGED_CLOUD === "true";
}

export function getAdminCapabilities(): AdminCapabilities {
  if (!isManagedCloud()) {
    return {
      instanceIdentity: true,
      email: true,
      ai: true,
      slackWebhook: true,
      reminderWebhook: true,
      retroToggle: true,
      promptLinks: true,
      users: true,
      upgradePrompt: true,
    };
  }
  return {
    instanceIdentity: true,
    email: false,
    ai: false,
    slackWebhook: true,
    reminderWebhook: false,
    retroToggle: false,
    promptLinks: false,
    users: true,
    upgradePrompt: true,
  };
}
