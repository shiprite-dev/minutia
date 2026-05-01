export interface WidgetMeta {
  type: string;
  name: string;
  description: string;
  span: 1 | 2;
  group: "pulse" | "agenda" | "workload";
}

export const WIDGET_REGISTRY: WidgetMeta[] = [
  {
    type: "hero",
    name: "Summary",
    description: "Open items count, resolution chart, avg lifespan",
    span: 2,
    group: "pulse",
  },
  {
    type: "next-meeting",
    name: "Next Meeting",
    description: "Quick link to your upcoming meeting series",
    span: 1,
    group: "pulse",
  },
  {
    type: "outstanding",
    name: "Outstanding Items",
    description: "All open items grouped by series with filters",
    span: 2,
    group: "pulse",
  },
  {
    type: "series",
    name: "Your Series",
    description: "Series list with open issue counts",
    span: 1,
    group: "pulse",
  },
  {
    type: "decisions",
    name: "Recent Decisions",
    description: "Last 5 decisions across all series",
    span: 1,
    group: "pulse",
  },
  {
    type: "age",
    name: "Age of Open Items",
    description: "Issue age distribution bucketed by time range",
    span: 1,
    group: "pulse",
  },
  {
    type: "stale-items",
    name: "Stale Items",
    description: "Items with no updates for 14+ days",
    span: 1,
    group: "pulse",
  },
  {
    type: "series-health",
    name: "Series Health",
    description: "Status distribution bars per series with resolution rates",
    span: 2,
    group: "pulse",
  },
  {
    type: "meeting-triage",
    name: "Meeting Triage",
    description: "Carried / New / Stuck breakdown for next meeting prep",
    span: 2,
    group: "agenda",
  },
  {
    type: "workload",
    name: "Workload",
    description: "Open items grouped by owner with balance bars",
    span: 2,
    group: "workload",
  },
];

export function getWidgetMeta(type: string): WidgetMeta | undefined {
  return WIDGET_REGISTRY.find((w) => w.type === type);
}
