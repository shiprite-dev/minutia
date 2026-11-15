import { splitWords, type FlowWord } from "./flow";

export type RecapBlock =
  | { kind: "lead"; key: number; words: FlowWord[] }
  | { kind: "heading"; key: number; words: FlowWord[] }
  | { kind: "list"; key: number; items: { key: number; words: FlowWord[] }[] };

type Raw =
  | { kind: "lead" | "heading"; text: string }
  | { kind: "list"; items: string[] };

export function parseRecap(
  text: string,
  opts?: { streaming?: boolean; lines?: boolean },
): RecapBlock[] {
  const raws: Raw[] = [];
  let open: Raw | null = null;
  let blank = false;
  const wordOpts = { openBold: !!opts?.streaming };
  const inline = (s: string) =>
    s.replace(/\[([^\]]*)\]\(([^)]*)\)/g, opts?.lines ? "$1 ($2)" : "$1").replace(/`/g, "");
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trimEnd();
    while (/^\s*>\s?/.test(line)) line = line.replace(/^\s*>\s?/, "");
    if (/^\s*```/.test(line) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line))
      continue;
    if (!line.trim()) {
      if (open?.kind === "list") blank = true;
      else open = null;
      continue;
    }
    const gap = blank;
    blank = false;
    const h = /^\s*#{1,6}(?:\s+(.*))?$/.exec(line);
    if (h) {
      const t = (h[1] ?? "")
        .replace(/\*\*/g, "")
        .replace(/\s*#+\s*$/, "")
        .replace(/:\s*$/, "")
        .trim();
      open = null;
      if (t) raws.push({ kind: "heading", text: inline(t) });
      continue;
    }
    if (
      opts?.streaming &&
      i === lines.length - 1 &&
      /^\s*(\d{1,2}|[-*•]\s+\*{1,2})$/.test(line)
    )
      continue;
    const b = /^\s*(?:[-*•]|\d{1,2}[.)])(?:\s+(.*)|$)/.exec(line);
    if (b) {
      const t = inline(b[1] ?? "").trim();
      if (!t || !splitWords(t).length) continue;
      if (open?.kind === "list") open.items.push(t);
      else {
        open = { kind: "list", items: [t] };
        raws.push(open);
      }
      continue;
    }
    if (gap) open = null;
    if (open?.kind === "list" && /^\s/.test(line)) {
      open.items[open.items.length - 1] += " " + inline(line.trim());
      continue;
    }
    if (open?.kind === "lead" && !opts?.lines) open.text += " " + inline(line.trim());
    else {
      open = { kind: "lead", text: inline(line.trim()) };
      raws.push(open);
    }
  }
  const out: RecapBlock[] = [];
  raws.forEach((r, key) => {
    if (
      !opts?.streaming &&
      !opts?.lines &&
      r.kind === "heading" &&
      !(raws[key + 1] && raws[key + 1].kind !== "heading")
    )
      return;
    if (r.kind === "list")
      out.push({
        kind: "list",
        key,
        items: r.items.map((t, i) => ({
          key: i,
          words: splitWords(t, wordOpts),
        })),
      });
    else {
      const words = splitWords(r.text, wordOpts);
      if (words.length) out.push({ kind: r.kind, key, words });
    }
  });
  return out;
}

function serialize(words: FlowWord[]): string {
  let s = "";
  words.forEach((w, i) => {
    const prev = words[i - 1]?.bold,
      next = words[i + 1]?.bold;
    const core = w.text.trimEnd(),
      ws = w.text.slice(core.length);
    s +=
      (w.bold && !prev ? "**" : "") + core + (w.bold && !next ? "**" : "") + ws;
  });
  return s.trimEnd();
}

export function sanitizeRecap(text: string): string {
  const blocks = parseRecap(text);
  let s = "";
  blocks.forEach((b, i) => {
    if (i > 0)
      s +=
        blocks[i - 1].kind === "heading" && b.kind === "list" ? "\n" : "\n\n";
    s +=
      b.kind === "heading"
        ? `## ${serialize(b.words)}`
        : b.kind === "list"
          ? b.items.map((it) => `- ${serialize(it.words)}`).join("\n")
          : serialize(b.words);
  });
  return s;
}
