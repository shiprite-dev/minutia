import type { RetroColumn } from "./types";

export interface RetroTemplate {
  id: "msg" | "ssc" | "4ls" | "fire";
  name: string;
  desc: string;
  columns: RetroColumn[];
  minutia?: boolean;
}

const cols = (...titles: string[]): RetroColumn[] =>
  titles.map((title) => ({ id: title.toLowerCase().replace(/[^a-z]+/g, "-"), title }));

export const TEMPLATES: RetroTemplate[] = [
  { id: "msg", name: "Mad · Sad · Glad", desc: "Surface feelings first", columns: cols("Mad", "Sad", "Glad") },
  { id: "ssc", name: "Start · Stop · Continue", desc: "Concrete behaviour changes", columns: cols("Start", "Stop", "Continue") },
  { id: "4ls", name: "4Ls", desc: "Liked · Learned · Lacked · Longed for", columns: cols("Liked", "Learned", "Lacked", "Longed for") },
  { id: "fire", name: "What's still on fire", desc: "Seeded from your open items", columns: cols("Still open", "New heat", "Cooled off"), minutia: true },
];

export const templateById = (id: string): RetroTemplate | undefined =>
  TEMPLATES.find((t) => t.id === id);
