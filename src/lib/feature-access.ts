export function isFeatureGatingEnabled(): boolean {
  return process.env.NEXT_PUBLIC_FEATURE_GATING === "true";
}

// Whether an org admin may invite additional members. When feature gating is
// off (the self-host default) inviting is always allowed. When gating is on, a
// workspace stays solo until it has the full-access entitlement; only a strict
// boolean `true` grants access. This is a neutral entitlement gate; the server
// route is the enforcement boundary and the UI mirrors it.
export function isMemberInviteAllowed(hasFullAccess: boolean): boolean {
  return !isFeatureGatingEnabled() || hasFullAccess === true;
}
