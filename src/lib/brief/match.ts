export type BriefOwner = {
  ownerName: string | null;
  ownerEmail?: string | null;
};

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function localPart(email: string): string {
  return email.split("@")[0] ?? "";
}

// Matches an issue owner to a brief recipient. On the server the owner's email
// is resolved from their profile; on the guest share page no emails are exposed,
// so the match falls back to comparing the owner's name tokens against the
// recipient email's local-part tokens (case-insensitive, exact token equality
// to avoid "Al" matching "alice").
export function ownerMatchesRecipient(
  recipientEmail: string,
  owner: BriefOwner
): boolean {
  const recipient = recipientEmail.trim().toLowerCase();
  if (!recipient.includes("@")) return false;

  if (owner.ownerEmail && owner.ownerEmail.trim().toLowerCase() === recipient) {
    return true;
  }

  if (!owner.ownerName) return false;

  const recipientTokens = new Set(tokenize(localPart(recipient)));
  if (recipientTokens.size === 0) return false;

  return tokenize(owner.ownerName).some((token) => recipientTokens.has(token));
}
