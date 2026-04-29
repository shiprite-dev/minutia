import { MeetingDetailContent } from "./meeting-detail-content";

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string; meetingId: string }>;
}) {
  const { id, meetingId } = await params;
  return <MeetingDetailContent seriesId={id} meetingId={meetingId} />;
}
