export function isFeatureGatingEnabled(): boolean {
  return process.env.NEXT_PUBLIC_FEATURE_GATING === "true";
}
