import { splitWords, type FlowWord } from "./flow";

export type RecapBlock =
  | { kind: "lead"; key: number; words: FlowWord[] }
  | { kind: "heading"; key: number; words: FlowWord[] }
  | { kind: "list"; key: number; items: { key: number; words: FlowWord[] }[] };

type Raw = { kind: "lead" | "heading"; text: string } | { kind: "list"; items: string[] };

const inline = (s: string) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/`/g, "");

export function parseRecap(text: string, opts?: { streaming?: boolean }): RecapBlock[] {
  const raws: Raw[] = [];
  let open: Raw | null = null;
  for (let line of text.replace(/\r\n?/g, "\n").split("\n")) {
    line = line.trimEnd();
    while (/^\s*>\s?/.test(line)) line = line.replace(/^\s*>\s?/, "");
    if (/^\s*```/.test(line) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) continue;
    if (!line.trim()) { open = null; continue; }
    const h = /^\s*#{1,6}(?:\s+(.*))?$/.exec(line);
    if (h) {
      const t = (h[1] ?? "").replace(/\*\*/g, "").replace(/\s*#+\s*$/, "").replace(/:\s*$/, "").trim();
      open = null;
      if (t) raws.push({ kind: "heading", text: inline(t) });
      continue;
    }
    const b = /^\s*(?:[-*•]|\d+[.)])(?:\s+(.*)|$)/.exec(line);
    if (b) {
      const t = inline(b[1] ?? "").trim();
      if (!t || !splitWords(t).length) continue;
      if (open?.kind === "list") open.items.push(t);
      else { open = { kind: "list", items: [t] }; raws.push(open); }
      continue;
    }
    if (open?.kind === "lead") open.text += " " + inline(line.trim());
    else { open = { kind: "lead", text: inline(line.trim()) }; raws.push(open); }
  }
  const kept = opts?.streaming ? raws : raws.filter((r, i) => r.kind !== "heading" || (raws[i + 1] && raws[i + 1].kind !== "heading"));
  const out: RecapBlock[] = [];
  for (const r of kept) {
    const key = out.length;
    if (r.kind === "list") out.push({ kind: "list", key, items: r.items.map((t, i) => ({ key: i, words: splitWords(t) })) });
    else { const words = splitWords(r.text); if (words.length) out.push({ kind: r.kind, key, words }); }
  }
  return out;
}

function serialize(words: FlowWord[]): string {
  let s = "";
  words.forEach((w, i) => {
    const prev = words[i - 1]?.bold, next = words[i + 1]?.bold;
    const core = w.text.trimEnd(), ws = w.text.slice(core.length);
    s += (w.bold && !prev ? "**" : "") + core + (w.bold && !next ? "**" : "") + ws;
  });
  return s.trimEnd();
}

export function sanitizeRecap(text: string): string {
  const blocks = parseRecap(text);
  let s = "";
  blocks.forEach((b, i) => {
    if (i > 0) s += blocks[i - 1].kind === "heading" && b.kind === "list" ? "\n" : "\n\n";
    s += b.kind === "heading" ? `## ${serialize(b.words)}` : b.kind === "list" ? b.items.map((it) => `- ${serialize(it.words)}`).join("\n") : serialize(b.words);
  });
  return s;
}
