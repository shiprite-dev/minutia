// Live-provider eval for the structured recap prompt. Not a CI gate: it needs
// OPENROUTER_API_KEY and skips without it. Deterministic checks per output,
// N-of-M pass threshold across fixtures.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.log("eval:recap-structure skipped: OPENROUTER_API_KEY is not set.");
  process.exit(0);
}
const model =
  process.env.RECAP_EVAL_MODEL ??
  process.env.OPENROUTER_MODEL ??
  "google/gemini-3.1-flash-lite";
const PASS_AT_LEAST = 5;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-recap-eval-"));
async function bundle(entry, name) {
  const outfile = path.join(tempDir, `${name}.mjs`);
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    absWorkingDir: process.cwd(),
  });
  return import(pathToFileURL(outfile).href);
}
const { SUMMARY_SYSTEM_PROMPT, buildSummaryPrompt } = await bundle(
  "src/lib/summary/prompt.ts",
  "prompt",
);
const { parseRecap, sanitizeRecap } = await bundle(
  "src/lib/summary/structure.ts",
  "structure",
);

const FIXTURES = [
  {
    name: "stand-up",
    attendees: ["Sarah Lee", "Mike Ross", "Priya Nair"],
    transcript:
      "Sarah Lee: Yesterday I finished the billing export. Today I start on the retry queue.\nMike Ross: I am blocked on the staging database credentials.\nPriya Nair: I can get you those by noon.\nSarah Lee: We agreed to freeze the API contract until Friday.\nMike Ross: Is the load test still happening this week? Nobody owns it yet.",
  },
  {
    name: "incident retro",
    attendees: ["Dana Cho", "Leo Park"],
    transcript:
      "Dana Cho: The outage lasted forty minutes after the cache config change.\nLeo Park: The alert fired but went to the old channel.\nDana Cho: Decision: every config change needs a second reviewer from now on.\nLeo Park: I will move the alert routing to the on-call channel by Wednesday.\nDana Cho: We still do not know why the rollback took so long.",
  },
  {
    name: "1:1",
    attendees: ["Ana Ruiz", "Tom Hale"],
    transcript:
      "Ana Ruiz: How is the mentoring going?\nTom Hale: Good, but I want more ownership of the search project.\nAna Ruiz: Let's make you the lead for search starting next sprint.\nTom Hale: I will write a one-page plan for it.\nAna Ruiz: We should revisit your promotion timeline next quarter.",
  },
  {
    name: "English-taught Japanese class",
    attendees: ["Ken Sato"],
    transcript:
      "Ken Sato: Today we compare めったに and 全然. めったに means rarely and takes a negative verb. 全然 means not at all. For example, めったに映画を見ません means I rarely watch movies. Homework: write five sentences with each word before next class.",
  },
  {
    name: "Japanese stand-up",
    attendees: ["田中", "鈴木"],
    transcript:
      "田中: 昨日はログイン画面を直しました。今日はテストを書きます。\n鈴木: 決済のバグがまだ残っています。\n田中: 金曜日にリリースすることに決めましょう。\n鈴木: 了解です。私がリリースノートを木曜日までに書きます。",
  },
  {
    name: "thin transcript",
    attendees: ["Sarah Lee"],
    thin: true,
    transcript: "Sarah Lee: Quick check, nothing new today. Thanks all.",
  },
];

async function complete(fixture) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildSummaryPrompt({
            title: fixture.name,
            seriesName: "Recap eval",
            attendees: fixture.attendees,
            transcript: fixture.transcript,
          }),
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`provider ${res.status}`);
  const body = await res.json();
  return String(body.choices?.[0]?.message?.content ?? "");
}

function check(fixture, out) {
  const failures = [];
  const blocks = parseRecap(out);
  const headings = blocks.filter((b) => b.kind === "heading");
  const lists = blocks.filter((b) => b.kind === "list");
  if (sanitizeRecap(out) !== out.trim())
    failures.push("output is not already in the sanitized subset");
  if (blocks[0]?.kind !== "lead") failures.push("no lead paragraph first");
  if (headings.length > 4) failures.push(`${headings.length} headings`);
  if (lists.some((l) => l.items.length > 6))
    failures.push("a section has more than 6 bullets");
  if (fixture.thin && headings.length > 0)
    failures.push("thin transcript produced headings");
  const known = `${fixture.attendees.join(" ")} ${fixture.transcript}`;
  // Next steps is always the last section, so its bold prefixes are owners.
  for (const item of lists.at(-1)?.items ?? []) {
    const owner = item.words
      .filter((w) => w.bold)
      .map((w) => w.text)
      .join("")
      .trim()
      .replace(/[:：]$/, "");
    if (!owner) continue;
    if (
      /speaker|^me$|^them$|someone|the team/i.test(owner) ||
      !known.includes(owner)
    ) {
      failures.push(`owner "${owner}" is not in the attendees or transcript`);
    }
  }
  return failures;
}

let passed = 0;
for (const fixture of FIXTURES) {
  try {
    const out = await complete(fixture);
    const failures = check(fixture, out);
    if (failures.length === 0) passed += 1;
    console.log(
      `${failures.length === 0 ? "PASS" : "FAIL"} ${fixture.name}${failures.length ? `: ${failures.join("; ")}` : ""}`,
    );
    if (failures.length)
      console.log(
        out
          .split("\n")
          .map((l) => `    | ${l}`)
          .join("\n"),
      );
  } catch (error) {
    console.log(`FAIL ${fixture.name}: ${error.message}`);
  }
}
console.log(
  `${passed}/${FIXTURES.length} fixtures passed (need ${PASS_AT_LEAST}) with ${model}`,
);
process.exit(passed >= PASS_AT_LEAST ? 0 : 1);
