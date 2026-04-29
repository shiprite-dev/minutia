import { use } from "react";
import { IssueDetailContent } from "./issue-detail-content";

export default function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <IssueDetailContent issueId={id} />;
}
