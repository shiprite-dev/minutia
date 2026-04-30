import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { MeetingDetailContent } from "./meeting-detail-content";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; meetingId: string }>;
}): Promise<Metadata> {
  const { id, meetingId } = await params;
  const supabase = await createClient();

  const [{ data: series }, { data: meeting }] = await Promise.all([
    supabase.from("meeting_series").select("name").eq("id", id).single(),
    supabase.from("meetings").select("sequence_number").eq("id", meetingId).single(),
  ]);

  const seriesName = series?.name ?? "Series";
  const num = meeting?.sequence_number ?? "";
  return { title: `Meeting ${num} | ${seriesName}` };
}

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string; meetingId: string }>;
}) {
  const { id, meetingId } = await params;
  return <MeetingDetailContent seriesId={id} meetingId={meetingId} />;
}
