// Custom-scheme deep links handed to the desktop companion app. The scheme and
// query shapes here are a wire contract with the companion's URL router; keep the
// two in sync. Meeting ids are lowercased because the companion's storage RLS
// paths are lowercase and case-sensitive (UUID.uuidString is uppercase in Swift).

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildCompanionAuthCallbackUrl(
  tokenHash: string,
  state?: string | null
): string {
  const token = tokenHash?.trim();
  if (!token) throw new Error("token_hash is required");
  let url = `minutia://auth-callback?token_hash=${encodeURIComponent(token)}`;
  if (state) {
    url += `&state=${encodeURIComponent(state)}`;
  }
  return url;
}

export function buildCompanionRecordUrl(meetingId: string): string {
  const id = meetingId?.trim().toLowerCase();
  if (!id || !UUID_RE.test(id)) {
    throw new Error("meetingId must be a valid uuid");
  }
  return `minutia://record?meeting_id=${id}`;
}

export function isMacPlatform(
  uaData: { platform?: string } | undefined,
  userAgent: string | undefined
): boolean {
  if (uaData?.platform) return uaData.platform === "macOS";
  return /Mac/.test(userAgent ?? "");
}
