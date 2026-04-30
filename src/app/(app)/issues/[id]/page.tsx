import { use } from "react";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { IssueDetailContent } from "./issue-detail-content";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("issues")
    .select("title")
    .eq("id", id)
    .single();
  return { title: data?.title ?? "Issue" };
}

export default function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <IssueDetailContent issueId={id} />;
}
