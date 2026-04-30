import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
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
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    profile = data;
  }

  return <AppShell profile={profile}>{children}</AppShell>;
}
