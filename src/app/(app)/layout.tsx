import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import type { OrganizationOption } from "@/lib/types";
import { AppShell } from "./app-shell";

export const metadata: Metadata = {
  title: {
    default: "OIL Board",
    template: "%s | Minutia",
  },
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile = null;
  let organizations: OrganizationOption[] = [];
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    profile = data;

    const { data: memberships } = await supabase
      .from("organization_members")
      .select("role, organizations(id, name, slug)")
      .eq("user_id", user.id)
      .order("joined_at", { ascending: true });

    organizations = (memberships ?? [])
      .flatMap((membership) => {
        const organization = Array.isArray(membership.organizations)
          ? membership.organizations[0]
          : membership.organizations;
        if (!organization) return [];
        return [{
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          role: membership.role as "admin" | "member",
        }];
      });
  }

  return <AppShell profile={profile} organizations={organizations}>{children}</AppShell>;
}
