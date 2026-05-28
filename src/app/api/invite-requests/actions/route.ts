import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { absoluteAppUrl } from "@/lib/app-url";
import { sendMail } from "@/lib/email";
import {
  loadInviteRequestFromToken,
  resolveInviteRequestAdminContext,
} from "@/lib/invite-request-actions";
import { buildExistingUserOrganizationInviteEmail } from "@/lib/organization-invite-email";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const actionSchema = z.object({
  token: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
});

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const loaded = await loadInviteRequestFromToken(parsed.data.token);
  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: 400 });
  }

  const inviteRequest = loaded.request;
  if (inviteRequest.status !== "pending") {
    return NextResponse.json(
      { error: `Request already ${inviteRequest.status}`, status: inviteRequest.status },
      { status: 409 }
    );
  }

  const admin = await resolveInviteRequestAdminContext(
    user.id,
    inviteRequest.organization_id
  );
  if (!admin.authorized) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const supabase = createServiceRoleClient();
  const decidedAt = new Date().toISOString();

  if (parsed.data.decision === "reject") {
    const { error } = await supabase
      .from("invite_requests")
      .update({
        status: "rejected",
        organization_id: admin.organizationId,
        decided_by: user.id,
        decided_at: decidedAt,
      })
      .eq("id", inviteRequest.id)
      .eq("status", "pending");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      status: "rejected",
      email: inviteRequest.email,
      organizationId: admin.organizationId,
      organizationName: admin.organizationName,
    });
  }

  const email = inviteRequest.email.toLowerCase();
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
          organization_id: admin.organizationId,
          user_id: existingProfile.id,
          role: "member",
          invited_by: user.id,
        },
        { onConflict: "organization_id,user_id" }
      );

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }

    const { error: invitationError } = await supabase
      .from("organization_invitations")
      .upsert(
        {
          organization_id: admin.organizationId,
          email,
          role: "member",
          status: "accepted",
          invited_by: user.id,
          accepted_by: existingProfile.id,
          accepted_at: decidedAt,
        },
        { onConflict: "organization_id,email" }
      );

    if (invitationError) {
      return NextResponse.json({ error: invitationError.message }, { status: 500 });
    }

    const appUrl = absoluteAppUrl(request.url, "/");
    const emailMessage = buildExistingUserOrganizationInviteEmail({
      organizationName: admin.organizationName,
      role: "member",
      appUrl,
    });

    await sendMail({
      to: email,
      ...emailMessage,
    });
  } else {
    const { error: invitationError } = await supabase
      .from("organization_invitations")
      .upsert(
        {
          organization_id: admin.organizationId,
          email,
          role: "member",
          status: "pending",
          invited_by: user.id,
          accepted_by: null,
          accepted_at: null,
        },
        { onConflict: "organization_id,email" }
      );

    if (invitationError) {
      return NextResponse.json({ error: invitationError.message }, { status: 500 });
    }

    const redirectTo = absoluteAppUrl(request.url, "/auth/callback?next=/settings");
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: {
        organization_id: admin.organizationId,
        organization_role: "member",
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
            organization_id: admin.organizationId,
            user_id: data.user.id,
            role: "member",
            invited_by: user.id,
          },
          { onConflict: "organization_id,user_id" }
        );
    }
  }

  const { error: requestUpdateError } = await supabase
    .from("invite_requests")
    .update({
      status: "approved",
      organization_id: admin.organizationId,
      decided_by: user.id,
      decided_at: decidedAt,
    })
    .eq("id", inviteRequest.id)
    .eq("status", "pending");

  if (requestUpdateError) {
    return NextResponse.json({ error: requestUpdateError.message }, { status: 500 });
  }

  return NextResponse.json({
    status: "approved",
    email,
    organizationId: admin.organizationId,
    organizationName: admin.organizationName,
  });
}
