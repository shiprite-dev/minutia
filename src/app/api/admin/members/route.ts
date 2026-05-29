import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireCurrentOrgAdmin } from "@/lib/supabase/org-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const updateMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["admin", "member"]),
});

const removeMemberSchema = z.object({
  userId: z.string().uuid(),
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

async function hasAnotherAdmin(
  organizationId: string,
  userId: string
): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("role", "admin")
    .neq("user_id", userId)
    .limit(1);

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function PATCH(request: NextRequest) {
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

  const parsed = updateMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  if (parsed.data.userId === auth.userId) {
    return NextResponse.json(
      { error: "Admins cannot change their own workspace role" },
      { status: 400 }
    );
  }

  const supabase = createServiceRoleClient();
  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", auth.organizationId)
    .eq("user_id", parsed.data.userId)
    .maybeSingle();

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }

  if (!membership) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (membership.role === "admin" && parsed.data.role === "member") {
    try {
      if (!(await hasAnotherAdmin(auth.organizationId, parsed.data.userId))) {
        return NextResponse.json(
          { error: "Workspace must keep at least one admin" },
          { status: 400 }
        );
      }
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to validate admins" },
        { status: 500 }
      );
    }
  }

  const { data, error } = await supabase
    .from("organization_members")
    .update({ role: parsed.data.role })
    .eq("organization_id", auth.organizationId)
    .eq("user_id", parsed.data.userId)
    .select("user_id, role")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ member: data });
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

  const parsed = removeMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  if (parsed.data.userId === auth.userId) {
    return NextResponse.json(
      { error: "Admins cannot remove themselves" },
      { status: 400 }
    );
  }

  const supabase = createServiceRoleClient();
  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", auth.organizationId)
    .eq("user_id", parsed.data.userId)
    .maybeSingle();

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }

  if (!membership) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (membership.role === "admin") {
    try {
      if (!(await hasAnotherAdmin(auth.organizationId, parsed.data.userId))) {
        return NextResponse.json(
          { error: "Workspace must keep at least one admin" },
          { status: 400 }
        );
      }
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to validate admins" },
        { status: 500 }
      );
    }
  }

  const { error } = await supabase
    .from("organization_members")
    .delete()
    .eq("organization_id", auth.organizationId)
    .eq("user_id", parsed.data.userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase
    .from("profiles")
    .update({ current_organization_id: null })
    .eq("id", parsed.data.userId)
    .eq("current_organization_id", auth.organizationId);

  return NextResponse.json({ removed: true });
}
