import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { absoluteAppUrl } from "@/lib/app-url";
import { sendMail } from "@/lib/email";
import { buildExistingUserOrganizationInviteEmail } from "@/lib/organization-invite-email";
import { requireCurrentOrgAdmin } from "@/lib/supabase/org-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]).default("member"),
});

const revokeInvitationSchema = z.object({
  id: z.string().uuid(),
});

function rejectCrossOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  return origin === new URL(request.url).origin
    ? null
    : NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
}

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

  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const supabase = createServiceRoleClient();
  const email = parsed.data.email.toLowerCase();
  const role = parsed.data.role;

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  if (existingProfile?.id) {
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
        status: existingProfile ? "accepted" : "pending",
        invited_by: auth.userId,
        accepted_by: existingProfile?.id ?? null,
        accepted_at: existingProfile ? new Date().toISOString() : null,
      },
      { onConflict: "organization_id,email" }
    );

  if (invitationError) {
    return NextResponse.json({ error: invitationError.message }, { status: 500 });
  }

  if (existingProfile?.id) {
    const { data: organization, error: organizationError } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", auth.organizationId)
      .single();

    if (organizationError || !organization) {
      return NextResponse.json({ error: "Failed to load organization" }, { status: 500 });
    }

    const appUrl = absoluteAppUrl(request.url, "/");
    const emailMessage = buildExistingUserOrganizationInviteEmail({
      organizationName: organization.name,
      role,
      appUrl,
    });

    await sendMail({
      to: email,
      ...emailMessage,
    });
  } else {
    const redirectTo = absoluteAppUrl(request.url, "/auth/callback?next=/settings");
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: {
        organization_id: auth.organizationId,
        organization_role: role,
      },
      redirectTo,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (data.user?.id) {
      await supabase
        .from("organization_members")
        .upsert(
          {
            organization_id: auth.organizationId,
            user_id: data.user.id,
            role,
            invited_by: auth.userId,
          },
          { onConflict: "organization_id,user_id" }
        );
    }
  }

  return NextResponse.json({ invited: true });
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
