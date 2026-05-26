import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { absoluteAppUrl } from "@/lib/app-url";
import { sendMail } from "@/lib/email";
import { buildExistingUserOrganizationInviteEmail } from "@/lib/organization-invite-email";
import { isHostedControlPlaneEnabled, requireAdmin } from "@/lib/supabase/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const createOrganizationSchema = z.object({
  name: z.string().min(1).max(120),
  admin_email: z.string().email(),
});

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!(await isHostedControlPlaneEnabled())) {
    return NextResponse.json({ error: "Hosted control plane required" }, { status: 404 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, slug, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ organizations: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!(await isHostedControlPlaneEnabled())) {
    return NextResponse.json({ error: "Hosted control plane required" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createOrganizationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const supabase = createServiceRoleClient();
  const name = parsed.data.name.trim();
  const adminEmail = parsed.data.admin_email.toLowerCase();
  const slug = `${slugify(name) || "organization"}-${crypto.randomUUID().slice(0, 8)}`;

  const { data: organization, error: orgError } = await supabase
    .from("organizations")
    .insert({ name, slug, created_by: auth.userId })
    .select("id, name, slug")
    .single();

  if (orgError || !organization) {
    return NextResponse.json(
      { error: orgError?.message || "Failed to create organization" },
      { status: 500 }
    );
  }

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .ilike("email", adminEmail)
    .maybeSingle();

  const { error: invitationError } = await supabase
    .from("organization_invitations")
    .upsert(
      {
        organization_id: organization.id,
        email: adminEmail,
        role: "admin",
        status: existingProfile ? "accepted" : "pending",
        invited_by: auth.userId,
        accepted_by: existingProfile?.id ?? null,
        accepted_at: existingProfile ? new Date().toISOString() : null,
      },
      { onConflict: "organization_id,email" }
    );

  if (invitationError) {
    await supabase.from("organizations").delete().eq("id", organization.id);
    return NextResponse.json({ error: invitationError.message }, { status: 500 });
  }

  if (existingProfile?.id) {
    const { error: memberError } = await supabase
      .from("organization_members")
      .upsert(
        {
          organization_id: organization.id,
          user_id: existingProfile.id,
          role: "admin",
          invited_by: auth.userId,
        },
        { onConflict: "organization_id,user_id" }
      );

    if (memberError) {
      await supabase.from("organizations").delete().eq("id", organization.id);
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }

    const appUrl = absoluteAppUrl(request.url, "/");
    const emailMessage = buildExistingUserOrganizationInviteEmail({
      organizationName: organization.name,
      role: "admin",
      appUrl,
    });

    await sendMail({
      to: adminEmail,
      ...emailMessage,
    });
  } else {
    const redirectTo = absoluteAppUrl(request.url, "/auth/callback?next=/settings");
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(adminEmail, {
      data: {
        organization_id: organization.id,
        organization_role: "admin",
      },
      redirectTo,
    });

    if (error) {
      await supabase.from("organizations").delete().eq("id", organization.id);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (data.user?.id) {
      await supabase
        .from("organization_members")
        .upsert(
          {
            organization_id: organization.id,
            user_id: data.user.id,
            role: "admin",
            invited_by: auth.userId,
          },
          { onConflict: "organization_id,user_id" }
        );
    }
  }

  return NextResponse.json({ organization });
}
