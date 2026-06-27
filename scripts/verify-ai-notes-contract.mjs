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

// Config contract: resolveAiConfig in config.ts owns defaults, provider, key precedence.
const aiConfig = read("src/lib/ai/config.ts");
assert(aiConfig.includes('"google/gemini-3.1-flash-lite"'), "AI config default model must be google/gemini-3.1-flash-lite");
assert(aiConfig.includes("AI_MODEL"), "AI config must be configurable via AI_MODEL env var");
assert(aiConfig.includes("resolveAiConfig"), "config.ts must export resolveAiConfig");
assert(
  aiConfig.includes("OPENROUTER_API_KEY") && aiConfig.includes("AI_API_KEY"),
  "AI config must honour AI_API_KEY then OPENROUTER_API_KEY"
);

// Transport contract: shared call.ts dispatches through provider clients, not in each route.
const callClient = read("src/lib/ai/call.ts");
assert(callClient.includes("dispatchAi"), "Shared call client must export dispatchAi");
assert(callClient.includes("callAi"), "Shared call client must export callAi");
assert(callClient.includes("timeoutMs"), "Shared call client must forward timeout to providers");

function assertSharedClient(src, name) {
  assert(!src.includes('"minimax/minimax-m3"'), `${name} route must not hardcode a model`);
  assert(src.includes('from "@/lib/ai/call"'), `${name} route must call the provider through the shared callAi client`);
  assert(src.includes("callAi"), `${name} route must use callAi`);
  assert(src.includes("hasAiConfigured"), `${name} route must gate via hasAiConfigured`);
  assert(!/async function getOpenRouterData/.test(src), `${name} route must not re-implement the OpenRouter fetch`);
}

const route = read("src/app/api/meetings/[meetingId]/enhance-notes/route.ts");
assertSharedClient(route, "Enhance");
assert(route.includes("Return only the JSON object"), "Enhance prompt must forbid non-JSON wrapper text");
assert(route.includes("Do not invent owners, dates, or decisions"), "Enhance prompt must forbid invented accountability details");
assert(route.includes("ai_notes: parsed"), "Enhance route must return structured AI notes JSON");
assert(
  route.includes('from "@/lib/ai/ask-series-answer"') && !/function getTextFromOpenRouter/.test(route),
  "Enhance route must reuse the shared fence-aware getTextFromOpenRouter so markdown-fenced provider JSON still parses"
);

// MIN-121: suggestion generation moved into the shared generator so the
// transcribe pipeline can reuse it. The route resolves the key and delegates;
// the provider call + prompt contract now live in src/lib/ai/suggestions.ts.
const suggestionsRoute = read("src/app/api/meetings/[meetingId]/suggestions/route.ts");
assert(
  suggestionsRoute.includes('from "@/lib/ai/config"') && suggestionsRoute.includes("hasAiConfigured"),
  "Suggestions route must gate via hasAiConfigured from the shared config module"
);
assert(
  suggestionsRoute.includes("generateMeetingSuggestions"),
  "Suggestions route must delegate generation to the shared generateMeetingSuggestions"
);

// The generator lives in src/lib/ai/ and imports its siblings by relative path;
// assert on the shared function usage rather than the import style.
const suggestionsGenerator = read("src/lib/ai/suggestions.ts");
assert(!suggestionsGenerator.includes('"minimax/minimax-m3"'), "Suggestions generator must not hardcode a model");
assert(
  suggestionsGenerator.includes("callAi"),
  "Suggestions generator must call the provider through the shared callAi client"
);
assert(
  !/async function getOpenRouterData/.test(suggestionsGenerator),
  "Suggestions generator must not re-implement the OpenRouter fetch"
);
assert(
  suggestionsGenerator.includes("getTextFromOpenRouter") && !/function getTextFromOpenRouter/.test(suggestionsGenerator),
  "Suggestions generator must reuse the shared fence-aware getTextFromOpenRouter so markdown-fenced provider JSON still parses"
);
assert(
  suggestionsGenerator.includes("Do not wrap it in markdown fences"),
  "Suggestions prompt must forbid markdown-fenced output"
);
assert(
  suggestionsGenerator.includes('{"suggestions": []}') || suggestionsGenerator.includes('{\\"suggestions\\": []}'),
  "Suggestions prompt must instruct an empty array when nothing qualifies"
);
assert(
  suggestionsGenerator.includes("verbatim") && suggestionsGenerator.includes("Never guess"),
  "Suggestions prompt must forbid invented owners and require verbatim evidence"
);

const askSeriesRoute = read("src/app/api/series/[seriesId]/ask/route.ts");
assertSharedClient(askSeriesRoute, "Ask series");
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

const { parseAskSeriesAnswer, stripJsonFences, getTextFromOpenRouter } = await import(pathToFileURL(bundledParser).href);

// The suggestions route shares this extractor; fenced provider JSON must round-trip to parseable text.
assert(
  getTextFromOpenRouter({
    choices: [{ message: { content: "```json\n{\"suggestions\":[]}\n```" } }],
  }) === '{"suggestions":[]}',
  "Shared getTextFromOpenRouter must unwrap fenced suggestions JSON"
);

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

// Carry-over briefing (OIL-native pre-meeting intelligence).
assert(
  exists("src/app/api/meetings/[meetingId]/carryover-briefing/route.ts"),
  "Missing carry-over briefing API route"
);
const carryoverRoute = read("src/app/api/meetings/[meetingId]/carryover-briefing/route.ts");
assertSharedClient(carryoverRoute, "Carryover briefing");
assert(carryoverRoute.includes("carryover-briefing-v1"), "Carryover briefing route must declare a prompt version");
assert(
  carryoverRoute.includes("Do not invent owners, dates, or resolutions"),
  "Carryover briefing prompt must forbid invented content"
);
assert(
  carryoverRoute.includes("Do not wrap it in markdown fences"),
  "Carryover briefing prompt must forbid fenced output"
);
assert(
  carryoverRoute.includes("summarizeCarryover"),
  "Carryover briefing must derive counts from the deterministic summary, not the model"
);

assert(
  meetingDetail.includes("CarryoverBriefingPanel"),
  "Upcoming meeting view must mount the carry-over briefing panel"
);
const carryoverPanel = read("src/components/minutia/carryover-briefing-panel.tsx");
for (const copy of ["Carry-over briefing", "Generate briefing"]) {
  assert(carryoverPanel.includes(copy), `Carry-over panel missing UI copy: ${copy}`);
}

// Transcript paste entry (unblocks augmented notes).
assert(migrations.includes("transcript_raw"), "Schema must include transcript_raw column");
assert(types.includes("transcript_raw"), "Meeting type must include transcript_raw");
assert(
  meetingDetail.includes("useUpdateMeetingTranscript"),
  "Meeting detail must persist pasted transcripts via useUpdateMeetingTranscript"
);
assert(meetingDetail.includes(">Transcript<"), "Meeting detail must render a Transcript section");
assert(
  meetingDetail.includes("Paste transcript..."),
  "Meeting detail must offer a transcript paste field"
);
const meetingsHook = read("src/lib/hooks/use-meetings.ts");
assert(
  meetingsHook.includes("transcript_raw: transcript"),
  "useUpdateMeetingTranscript must write transcript_raw"
);

console.log("AI notes contract verified");
