import type { RetroColumn, RetroCard, RetroAction } from "./types";

interface MdInput {
  name: string;
  columns: RetroColumn[];
  cards: Pick<RetroCard, "column_id" | "text" | "author_name">[];
  actions: Pick<RetroAction, "text" | "owner_name" | "due">[];
}

const esc = (s: string) => s.replace(/\|/g, "\\|");

/** Pure board -> Markdown export. No network, no auth. The free escape hatch. */
export function boardToMarkdown({ name, columns, cards, actions }: MdInput): string {
  const lines = [`# ${name}`, ""];
  for (const col of columns) {
    lines.push(`## ${col.title}`);
    for (const c of cards.filter((x) => x.column_id === col.id)) {
      lines.push(`- ${esc(c.text)}${c.author_name ? ` — ${esc(c.author_name)}` : ""}`);
    }
    lines.push("");
  }
  if (actions.length) {
    lines.push("## Action items", "");
    for (const a of actions) {
      lines.push(
        `- [ ] ${esc(a.text)}${a.owner_name ? ` (@${esc(a.owner_name)})` : ""}${a.due ? ` — due ${esc(a.due)}` : ""}`
      );
    }
  }
  return lines.join("\n");
}
