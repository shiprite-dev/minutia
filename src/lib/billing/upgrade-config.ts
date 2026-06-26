export function isUpgradeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.UPGRADE_SIGNING_SECRET && env.UPGRADE_CHECKOUT_URL);
}
