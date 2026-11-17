import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { absoluteAppUrl, toPublicActionLink } from "@/lib/app-url";
import { isEmailConfigured, sendMail } from "@/lib/email";
import {
  buildExistingUserOrganizationInviteEmail,
  buildNewUserOrganizationInviteEmail,
} from "@/lib/organization-invite-email";
import { rejectCrossOrigin } from "@/lib/request-origin";
import { requireCurrentOrgAdmin, requireSeriesInviter } from "@/lib/supabase/org-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isMemberInviteAllowed } from "@/lib/feature-access";
import { inviteDelivery } from "@/lib/invitations";
import type { MailMessage } from "@/lib/email";

const INVITE_UPGRADE_REQUIRED =
  "Inviting teammates requires an upgraded workspace.";

const EMAIL_UNAVAILABLE = {
  error: "Email is not set up on this workspace.",
  code: "INVITE_EMAIL_UNAVAILABLE",
};

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]).default("member"),
  series_id: z.guid().optional(),
});

const revokeInvitationSchema = z.object({
  id: z.string().uuid(),
});

function requireJsonBody(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.toLowerCase().includes("application/json")
    ? null
    : NextResponse.json({ error: "JSON body required" }, { status: 415 });
}

export async function GET() {
  const auth = await requireCurrentOrgAdmin();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = createServiceRoleClient();
  const [orgResult, memberResult, invitationResult] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, name, slug")
      .eq("id", auth.organizationId)
      .single(),
    supabase
      .from("organization_members")
      .select("user_id, role, joined_at, profiles!organization_members_user_id_fkey(email, name)")
      .eq("organization_id", auth.organizationId)
      .order("joined_at", { ascending: true }),
    supabase
      .from("organization_invitations")
      .select("id, email, role, status, created_at, accepted_at")
      .eq("organization_id", auth.organizationId)
      .order("created_at", { ascending: false }),
  ]);

  if (orgResult.error || memberResult.error || invitationResult.error) {
    return NextResponse.json({ error: "Failed to load organization" }, { status: 500 });
  }

  return NextResponse.json({
    organization: orgResult.data,
    members: memberResult.data ?? [],
    invitations: invitationResult.data ?? [],
  });
}

export async function POST(request: NextRequest) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const jsonBody = requireJsonBody(request);
  if (jsonBody) return jsonBody;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const seriesId = parsed.data.series_id;
  const auth = seriesId ? await requireSeriesInviter(seriesId) : await requireCurrentOrgAdmin();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = createServiceRoleClient();
  const email = parsed.data.email.toLowerCase();
  const role = parsed.data.role;
  if (role === "admin" && "isOrgAdmin" in auth && !auth.isOrgAdmin) {
    return NextResponse.json({ error: "Only workspace admins can invite admins." }, { status: 403 });
  }

  // Free workspaces are solo: adding a member requires the full-access
  // entitlement. No-op when feature gating is off (the self-host default).
  const { data: inviter } = await supabase
    .from("profiles")
    .select("has_full_access")
    .eq("id", auth.userId)
    .single();
  if (!isMemberInviteAllowed(inviter?.has_full_access === true)) {
    return NextResponse.json(
      { error: INVITE_UPGRADE_REQUIRED, code: "INVITE_UPGRADE_REQUIRED" },
      { status: 403 }
    );
  }

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
    .maybeSingle();

  // A series inviter who is not an org admin may only add members: existing
  // memberships and invitations are never changed, people outside the
  // workspace only get a pending invitation, and the accept link stays private.
  const restricted = "isOrgAdmin" in auth && !auth.isOrgAdmin;
  const writeMode = restricted ? { ignoreDuplicates: true } : {};

  if (restricted && existingProfile?.id) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", auth.organizationId)
      .eq("user_id", existingProfile.id)
      .maybeSingle();
    if (membership) {
      const participantError = await addSeriesParticipant(supabase, seriesId!, existingProfile.id, auth.userId);
      if (participantError) return NextResponse.json({ error: participantError }, { status: 500 });
      return NextResponse.json({ invited: true, delivery: "added" });
    }
  }

  // Nothing is provisioned for a series inviter unless the invite can be emailed.
  if (restricted && !(await isEmailConfigured())) {
    return NextResponse.json(EMAIL_UNAVAILABLE, { status: 503 });
  }

  const directMember = existingProfile?.id && !restricted;

  if (directMember) {
    const { error: memberError } = await supabase
      .from("organization_members")
      .upsert(
        {
          organization_id: auth.organizationId,
          user_id: existingProfile.id,
          role,
          invited_by: auth.userId,
        },
        { onConflict: "organization_id,user_id" }
      );

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }
  }

  const { error: invitationError } = await supabase
    .from("organization_invitations")
    .upsert(
      {
        organization_id: auth.organizationId,
        email,
        role,
        status: directMember ? "accepted" : "pending",
        invited_by: auth.userId,
        accepted_by: directMember ? existingProfile.id : null,
        accepted_at: directMember ? new Date().toISOString() : null,
      },
      { onConflict: "organization_id,email", ...writeMode }
    );

  if (invitationError) {
    return NextResponse.json({ error: invitationError.message }, { status: 500 });
  }

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", auth.organizationId)
    .single();

  if (organizationError || !organization) {
    return NextResponse.json({ error: "Failed to load organization" }, { status: 500 });
  }

  let acceptUrl: string;
  let emailMessage: Omit<MailMessage, "to">;
  let inviteeId: string | null = null;

  if (existingProfile?.id) {
    if (directMember) inviteeId = existingProfile.id;
    acceptUrl = absoluteAppUrl(request.url, "/settings");
    emailMessage = buildExistingUserOrganizationInviteEmail({
      organizationName: organization.name,
      role,
      appUrl: acceptUrl,
    });
  } else {
    const redirectTo = absoluteAppUrl(request.url, "/accept-invite");
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        data: {
          organization_id: auth.organizationId,
          organization_name: organization.name,
          organization_role: role,
        },
        redirectTo,
      },
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data.user?.id) {
      return NextResponse.json({ error: "Failed to create invite user" }, { status: 500 });
    }
    inviteeId = data.user.id;

    const { error: memberError } = await supabase
      .from("organization_members")
      .upsert(
        {
          organization_id: auth.organizationId,
          user_id: data.user.id,
          role,
          invited_by: auth.userId,
        },
        { onConflict: "organization_id,user_id", ...writeMode }
      );

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }

    const rawInviteLink = data.properties?.action_link;
    if (!rawInviteLink) {
      return NextResponse.json({ error: "Failed to generate invite link" }, { status: 500 });
    }
    acceptUrl = toPublicActionLink(rawInviteLink);

    emailMessage = buildNewUserOrganizationInviteEmail({
      organizationName: organization.name,
      role,
      invitedEmail: email,
      acceptUrl,
    });
  }

  if (seriesId && inviteeId) {
    const participantError = await addSeriesParticipant(supabase, seriesId, inviteeId, auth.userId);
    if (participantError) return NextResponse.json({ error: participantError }, { status: 500 });
  }

  // The invite is already provisioned at this point. Email delivery is best-effort:
  // when it fails (e.g. no SMTP/Resend on a fresh self-host), hand the admin the
  // accept link to share directly rather than 500ing over a half-sent invite.
  // Only an org admin ever sees that link.
  let emailError: unknown = null;
  try {
    await sendMail({ to: email, ...emailMessage });
  } catch (error) {
    emailError = error;
  }

  if (emailError && restricted) {
    return NextResponse.json(EMAIL_UNAVAILABLE, { status: 503 });
  }
  const delivery = inviteDelivery({ emailError, acceptUrl });
  if (!delivery.invited) {
    return NextResponse.json({ error: delivery.error }, { status: 500 });
  }
  return NextResponse.json(delivery);
}

async function addSeriesParticipant(
  supabase: ReturnType<typeof createServiceRoleClient>,
  seriesId: string,
  userId: string,
  invitedBy: string
): Promise<string | null> {
  const { error } = await supabase.from("series_participants").upsert(
    { series_id: seriesId, user_id: userId, role: "participant", invited_by: invitedBy },
    { onConflict: "series_id,user_id", ignoreDuplicates: true }
  );
  return error?.message ?? null;
}

export async function DELETE(request: NextRequest) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const jsonBody = requireJsonBody(request);
  if (jsonBody) return jsonBody;

  const auth = await requireCurrentOrgAdmin();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = revokeInvitationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("organization_invitations")
    .update({ status: "revoked" })
    .eq("id", parsed.data.id)
    .eq("organization_id", auth.organizationId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }

  return NextResponse.json({ revoked: true });
}
