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
