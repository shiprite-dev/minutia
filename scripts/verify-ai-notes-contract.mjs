import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const migrationDir = path.join(root, "supabase", "migrations");
const migrations = fs
  .readdirSync(migrationDir)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => fs.readFileSync(path.join(migrationDir, file), "utf8"))
  .join("\n");

for (const field of [
  "raw_notes_markdown",
  "ai_notes_markdown",
  "ai_notes_generated_at",
  "ai_notes_model",
  "ai_notes_prompt_version",
]) {
  assert(migrations.includes(field), `Missing meeting AI notes field: ${field}`);
}

const types = read("src/lib/types.ts");
for (const field of [
  "raw_notes_markdown",
  "ai_notes_markdown",
  "ai_notes_generated_at",
  "ai_notes_model",
  "ai_notes_prompt_version",
]) {
  assert(types.includes(field), `Meeting type missing ${field}`);
}

assert(
  exists("src/app/api/meetings/[meetingId]/enhance-notes/route.ts"),
  "Missing enhance notes API route"
);
assert(
  migrations.includes("meeting_ai_suggestions"),
  "Missing meeting_ai_suggestions table"
);
for (const field of [
  "category",
  "title",
  "owner_name",
  "due_date",
  "confidence",
  "source_excerpt",
  "status",
  "created_issue_id",
  "created_decision_id",
]) {
  assert(migrations.includes(field), `Missing AI suggestion field: ${field}`);
}
assert(
  exists("src/app/api/meetings/[meetingId]/suggestions/route.ts"),
  "Missing generate suggestions API route"
);
assert(
  exists("src/app/api/meetings/[meetingId]/suggestions/[suggestionId]/route.ts"),
  "Missing review suggestion API route"
);
assert(
  exists("src/app/api/series/[seriesId]/ask/route.ts"),
  "Missing Ask this series API route"
);

const modelConfig = read("src/lib/ai/model.ts");
assert(modelConfig.includes('"google/gemini-3.1-flash-lite"'), "AI model default must be google/gemini-3.1-flash-lite");
assert(modelConfig.includes("AI_MODEL"), "AI model must be configurable via AI_MODEL");

const route = read("src/app/api/meetings/[meetingId]/enhance-notes/route.ts");
assert(route.includes("getAiModel"), "Enhance route must resolve the model from config (getAiModel)");
assert(!route.includes('"minimax/minimax-m3"'), "Enhance route must not hardcode a model");
assert(route.includes("OPENROUTER_API_KEY"), "Enhance route must read OPENROUTER_API_KEY");
assert(route.includes("AI_API_KEY"), "Enhance route must support AI_API_KEY fallback");
assert(route.includes("https://openrouter.ai/api/v1/chat/completions"), "Enhance route must call OpenRouter chat completions");
assert(route.includes("response_format: { type: \"json_object\" }"), "Enhance route must request OpenRouter JSON mode");
assert(route.includes("Return only the JSON object"), "Enhance prompt must forbid non-JSON wrapper text");
assert(route.includes("Do not invent owners, dates, or decisions"), "Enhance prompt must forbid invented accountability details");
assert(route.includes("ai_notes: parsed"), "Enhance route must return structured AI notes JSON");
assert(route.includes("stripJsonFences"), "Enhance route must strip markdown code fences before parsing provider JSON");

const suggestionsRoute = read("src/app/api/meetings/[meetingId]/suggestions/route.ts");
assert(suggestionsRoute.includes("getAiModel"), "Suggestions route must resolve the model from config (getAiModel)");
assert(!suggestionsRoute.includes('"minimax/minimax-m3"'), "Suggestions route must not hardcode a model");
assert(suggestionsRoute.includes("OPENROUTER_API_KEY"), "Suggestions route must read OPENROUTER_API_KEY");
assert(suggestionsRoute.includes("AI_API_KEY"), "Suggestions route must support AI_API_KEY fallback");
assert(suggestionsRoute.includes("https://openrouter.ai/api/v1/chat/completions"), "Suggestions route must call OpenRouter chat completions");

const askSeriesRoute = read("src/app/api/series/[seriesId]/ask/route.ts");
assert(askSeriesRoute.includes("getAiModel"), "Ask series route must resolve the model from config (getAiModel)");
assert(!askSeriesRoute.includes('"minimax/minimax-m3"'), "Ask series route must not hardcode a model");
assert(askSeriesRoute.includes("OPENROUTER_API_KEY"), "Ask series route must read OPENROUTER_API_KEY");
assert(askSeriesRoute.includes("AI_API_KEY"), "Ask series route must support AI_API_KEY fallback");
assert(askSeriesRoute.includes("https://openrouter.ai/api/v1/chat/completions"), "Ask series route must call OpenRouter chat completions");
assert(askSeriesRoute.includes("The source context does not prove the answer."), "Ask series route must include unsupported-answer guard copy");

const askSeriesParserPath = "src/lib/ai/ask-series-answer.ts";
assert(exists(askSeriesParserPath), "Missing Ask this series provider parser module");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutia-ai-contract-"));
const bundledParser = path.join(tempDir, "ask-series-answer.mjs");
await esbuild.build({
  entryPoints: [askSeriesParserPath],
  outfile: bundledParser,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});

const { parseAskSeriesAnswer, stripJsonFences } = await import(pathToFileURL(bundledParser).href);

assert(
  stripJsonFences("```json\n{\"a\":1}\n```") === '{"a":1}',
  "stripJsonFences must unwrap fenced provider JSON"
);
assert(
  stripJsonFences('{"a":1}') === '{"a":1}',
  "stripJsonFences must leave bare JSON untouched"
);
const sparseAnswer = parseAskSeriesAnswer({
  providerData: {
    choices: [
      {
        message: {
          content: JSON.stringify({
            answer: "Use GitHub Actions for CI/CD.",
            citations: [
              {
                source_id: "20000000-0000-0000-0000-000000000002",
                quote: "Use GitHub Actions for CI/CD",
              },
            ],
            unsupported: false,
          }),
        },
      },
    ],
  },
  seriesId: "10000000-0000-0000-0000-000000000001",
  meetings: [
    {
      id: "20000000-0000-0000-0000-000000000002",
      title: "Platform Standup #2",
    },
  ],
  issues: [],
  decisions: [],
});
assert(sparseAnswer.unsupported === false, "Sparse provider citations should stay supported");
assert(sparseAnswer.citations[0]?.type === "notes", "Sparse meeting citations should resolve to notes");
assert(
  sparseAnswer.citations[0]?.href ===
    "/series/10000000-0000-0000-0000-000000000001/meetings/20000000-0000-0000-0000-000000000002",
  "Sparse meeting citations should link to the source meeting"
);

// Model returns markdown-fenced JSON with bare-string citations (observed with minimax-m3).
const fencedAnswer = parseAskSeriesAnswer({
  providerData: {
    choices: [
      {
        message: {
          content:
            "```json\n" +
            JSON.stringify({
              answer: "New tests need to be added; John is running a Claude POC.",
              citations: ["20000000-0000-0000-0000-000000000002"],
              unsupported: false,
            }) +
            "\n```",
        },
      },
    ],
  },
  seriesId: "10000000-0000-0000-0000-000000000001",
  meetings: [{ id: "20000000-0000-0000-0000-000000000002", title: "1:1 with John #7" }],
  issues: [],
  decisions: [],
});
assert(fencedAnswer.unsupported === false, "Fenced JSON should parse and stay supported");
assert(
  fencedAnswer.citations[0]?.source_id === "20000000-0000-0000-0000-000000000002",
  "Bare-string citations should resolve to their source"
);

// A malformed citation must be dropped, not throw the whole answer away.
const mixedAnswer = parseAskSeriesAnswer({
  providerData: {
    choices: [
      {
        message: {
          content: JSON.stringify({
            answer: "Coverage gap remains open.",
            citations: ["not-a-uuid", "20000000-0000-0000-0000-000000000002"],
            unsupported: false,
          }),
        },
      },
    ],
  },
  seriesId: "10000000-0000-0000-0000-000000000001",
  meetings: [{ id: "20000000-0000-0000-0000-000000000002", title: "1:1 with John #7" }],
  issues: [],
  decisions: [],
});
assert(mixedAnswer.citations.length === 1, "Malformed citations should be dropped, not throw");

const meetingDetail = read("src/app/(app)/series/[id]/meetings/[meetingId]/meeting-detail-content.tsx");
for (const copy of [
  "Enhance notes",
  "AI notes preview",
  "Structured record",
  "Structured draft",
  "Apply AI notes",
  "Raw notes",
  "Action items",
  "Open questions",
  "Review AI suggestions",
  "AI suggestions",
  "Accept suggestion",
  "Reject suggestion",
]) {
  assert(meetingDetail.includes(copy), `Meeting detail missing UI copy: ${copy}`);
}
assert(
  meetingDetail.includes("normalizeAiNotesPreview"),
  "Meeting detail must render structured AI notes from JSON"
);

const seriesDetail = read("src/app/(app)/series/[id]/series-detail-content.tsx");
for (const copy of [
  "Ask this series",
  "Ask this series question",
  "Series answer",
  "Sources",
  "The source context does not prove the answer.",
]) {
  assert(seriesDetail.includes(copy), `Series detail missing Ask UI copy: ${copy}`);
}

console.log("AI notes contract verified");
