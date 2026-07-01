import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

type MemberProfile = {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

type MemberRow = {
  user_id: string;
  profiles: MemberProfile | MemberProfile[] | null;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const serviceClient = createServiceRoleClient();
  const { data: profile } = await serviceClient
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .single();

  const organizationId = profile?.current_organization_id;
  if (!organizationId) {
    return NextResponse.json({ members: [] });
  }

  const { data, error } = await serviceClient
    .from("organization_members")
    .select("user_id, profiles!organization_members_user_id_fkey(id, name, email, avatar_url)")
    .eq("organization_id", organizationId)
    .order("joined_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to load workspace members" }, { status: 500 });
  }

  const members = ((data ?? []) as unknown as MemberRow[]).map((row) => {
    const memberProfile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: memberProfile?.id ?? row.user_id,
      name: memberProfile?.name ?? null,
      email: memberProfile?.email ?? "",
      avatar_url: memberProfile?.avatar_url ?? null,
    };
  });

  return NextResponse.json({ members });
}
