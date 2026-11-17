export type InviteDeliveryInput = {
  emailError: unknown;
  acceptUrl?: string | null;
};

export type InviteDeliveryResult =
  | { invited: true; delivery: "email" }
  | { invited: true; delivery: "link"; acceptUrl: string }
  | { invited: false; error: string };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// Decide what to tell the caller after attempting to deliver an invite email.
// Delivery failure never loses the invite: it is already provisioned, so we hand
// back the accept link for the admin to share. Only when there is no link to fall
// back to do we surface the failure as an error.
export function inviteDelivery({
  emailError,
  acceptUrl,
}: InviteDeliveryInput): InviteDeliveryResult {
  if (!emailError) return { invited: true, delivery: "email" };
  if (acceptUrl) return { invited: true, delivery: "link", acceptUrl };
  return { invited: false, error: errorMessage(emailError) };
}

const EMAIL_PATTERN = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/;

/** Emails typed into the invite field, separated by commas or whitespace. */
export function parseInviteEmails(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

/** Series attendees that are email addresses, ready to prefill the invite field. */
export function seriesInviteEmails(attendees: string[] | null | undefined): string {
  return parseInviteEmails((attendees ?? []).filter((a) => EMAIL_PATTERN.test(a.trim())).join(",")).join(", ");
}
