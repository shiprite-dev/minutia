// Pure client helpers. splitWords produces stable index keys so React
// reconciliation appends only newly arrived spans (earlier words keep their
// DOM node and do not re-animate). materializeClassName gates the enter
// animation on the reduced-motion preference; content still renders.

export interface FlowWord {
  key: number;
  text: string;
}

export function splitWords(text: string): FlowWord[] {
  if (!text) return [];
  const parts = text.match(/\S+\s*/g);
  if (!parts) return [];
  return parts.map((part, index) => ({ key: index, text: part }));
}

export function materializeClassName(reducedMotion: boolean): string {
  return reducedMotion ? "" : "materialize";
}
