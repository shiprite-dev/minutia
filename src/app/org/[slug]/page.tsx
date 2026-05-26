import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export default async function OrganizationEntryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/org/${encodeURIComponent(slug)}`);
  }

  const admin = createServiceRoleClient();
  const { data: organization } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (!organization) notFound();

  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("organization_id", organization.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) notFound();

  await admin
    .from("profiles")
    .update({ current_organization_id: organization.id })
    .eq("id", user.id);

  redirect("/");
}
