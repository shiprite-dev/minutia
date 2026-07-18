import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resolveAdminAccess } from "@/lib/supabase/admin-access";
import { AdminNav } from "@/components/minutia/admin-nav";

export const metadata: Metadata = {
  title: "Admin",
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await resolveAdminAccess();
  if (!access) redirect("/");
  if (!access.instanceAdmin && !access.orgAdmin) redirect("/");

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="space-y-4">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Admin
          </h1>
          <AdminNav instanceAdmin={access.instanceAdmin} />
        </div>
        {children}
      </div>
    </div>
  );
}
