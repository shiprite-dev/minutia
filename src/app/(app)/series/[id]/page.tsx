import { SeriesDetailContent } from "./series-detail-content";

export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SeriesDetailContent seriesId={id} />;
}
