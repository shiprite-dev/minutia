import { redirect } from "next/navigation";
import { resolveAdminAccess } from "@/lib/supabase/admin-access";

export default async function AdminInstanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await resolveAdminAccess();
  if (!access?.instanceAdmin) {
    redirect(access?.orgAdmin ? "/admin/users" : "/");
  }
  return <>{children}</>;
}
