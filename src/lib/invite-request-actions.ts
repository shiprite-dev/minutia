import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const tokenPayloadSchema = z.object({
  requestId: z.string().uuid(),
  email: z.string().email(),
  organizationId: z.string().uuid().nullable(),
  exp: z.number().int().positive(),
});

export type InviteRequestActionTokenPayload = z.infer<typeof tokenPayloadSchema>;

export type InviteRequestRecord = {
  id: string;
  email: string;
  organization_id: string | null;
  requested_path: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

export type OrganizationAdminContext =
  | {
      authorized: true;
      organizationId: string;
      organizationName: string;
    }
  | { authorized: false; status: number; error: string };

function getActionSecret() {
  const secret =
    process.env.INVITE_REQUEST_ACTION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error(
      "INVITE_REQUEST_ACTION_SECRET or SUPABASE_SERVICE_ROLE_KEY is required"
    );
  }
  return secret;
}

function encodeBase64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function signSegment(segment: string) {
  return createHmac("sha256", getActionSecret())
    .update(segment)
    .digest("base64url");
}

export function createInviteRequestActionToken(
  payload: Omit<InviteRequestActionTokenPayload, "exp">,
  maxAgeMs = 14 * 24 * 60 * 60 * 1000
) {
  const segment = encodeBase64Url(
    JSON.stringify({ ...payload, exp: Date.now() + maxAgeMs })
  );
  return `${segment}.${signSegment(segment)}`;
}

export function verifyInviteRequestActionToken(token: string) {
  const [segment, signature] = token.split(".");
  if (!segment || !signature) return null;

  const expected = Buffer.from(signSegment(segment));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const parsed = tokenPayloadSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.exp < Date.now()) return null;
  return parsed.data;
}

export async function loadInviteRequestFromToken(token: string) {
  const payload = verifyInviteRequestActionToken(token);
  if (!payload) return { error: "Invalid or expired request link" as const };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("invite_requests")
    .select("id, email, organization_id, requested_path, status, created_at")
    .eq("id", payload.requestId)
    .maybeSingle();

  if (error || !data) return { error: "Invite request not found" as const };
  if (data.email.toLowerCase() !== payload.email.toLowerCase()) {
    return { error: "Invite request does not match this link" as const };
  }
  if ((data.organization_id ?? null) !== payload.organizationId) {
    return { error: "Invite request does not match this workspace" as const };
  }

  return { request: data as InviteRequestRecord };
}

export async function resolveInviteRequestAdminContext(
  userId: string,
  requestedOrganizationId: string | null
): Promise<OrganizationAdminContext> {
  const supabase = createServiceRoleClient();
  let organizationId = requestedOrganizationId;

  if (!organizationId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("current_organization_id")
      .eq("id", userId)
      .single();
    organizationId = profile?.current_organization_id ?? null;
  }

  if (!organizationId) {
    return {
      authorized: false,
      status: 403,
      error: "No workspace selected for this request",
    };
  }

  const [membershipResult, organizationResult] = await Promise.all([
    supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .single(),
  ]);

  if (membershipResult.data?.role !== "admin") {
    return {
      authorized: false,
      status: 403,
      error: "Workspace admin access required",
    };
  }

  if (organizationResult.error || !organizationResult.data) {
    return {
      authorized: false,
      status: 404,
      error: "Workspace not found",
    };
  }

  return {
    authorized: true,
    organizationId,
    organizationName: organizationResult.data.name,
  };
}
