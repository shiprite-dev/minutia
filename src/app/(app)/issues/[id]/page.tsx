import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { parseIssueKey } from "@/lib/issue-utils";
import { createClient } from "@/lib/supabase/server";
import { IssueDetailContent } from "./issue-detail-content";

async function findIssueByParam(id: string) {
  const supabase = await createClient();
  const issueNumber = parseIssueKey(id);

  const query = supabase
    .from("issues")
    .select("id,title");

  const { data } = issueNumber
    ? await query.eq("issue_number", issueNumber).single()
    : await query.eq("id", id).single();

  return data;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const data = await findIssueByParam(id);
  return { title: data?.title ?? "Issue" };
}

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await findIssueByParam(id);

  if (data?.id && data.id !== id) {
    redirect(`/issues/${data.id}`);
  }

  return <IssueDetailContent issueId={id} />;
}
