import fs from "node:fs";
import path from "node:path";

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

const route = read("src/app/api/meetings/[meetingId]/enhance-notes/route.ts");
assert(route.includes("minimax/minimax-m3"), "Enhance route must use minimax/minimax-m3");
assert(route.includes("OPENROUTER_API_KEY"), "Enhance route must read OPENROUTER_API_KEY");
assert(route.includes("AI_API_KEY"), "Enhance route must support AI_API_KEY fallback");
assert(route.includes("https://openrouter.ai/api/v1/chat/completions"), "Enhance route must call OpenRouter chat completions");
assert(route.includes("ai_notes: parsed"), "Enhance route must return structured AI notes JSON");

const suggestionsRoute = read("src/app/api/meetings/[meetingId]/suggestions/route.ts");
assert(suggestionsRoute.includes("minimax/minimax-m3"), "Suggestions route must use minimax/minimax-m3");
assert(suggestionsRoute.includes("OPENROUTER_API_KEY"), "Suggestions route must read OPENROUTER_API_KEY");
assert(suggestionsRoute.includes("AI_API_KEY"), "Suggestions route must support AI_API_KEY fallback");
assert(suggestionsRoute.includes("https://openrouter.ai/api/v1/chat/completions"), "Suggestions route must call OpenRouter chat completions");

const askSeriesRoute = read("src/app/api/series/[seriesId]/ask/route.ts");
assert(askSeriesRoute.includes("minimax/minimax-m3"), "Ask series route must use minimax/minimax-m3");
assert(askSeriesRoute.includes("OPENROUTER_API_KEY"), "Ask series route must read OPENROUTER_API_KEY");
assert(askSeriesRoute.includes("AI_API_KEY"), "Ask series route must support AI_API_KEY fallback");
assert(askSeriesRoute.includes("https://openrouter.ai/api/v1/chat/completions"), "Ask series route must call OpenRouter chat completions");
assert(askSeriesRoute.includes("The source context does not prove the answer."), "Ask series route must include unsupported-answer guard copy");

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
