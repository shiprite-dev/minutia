#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const [key, inlineValue] = arg.includes("=") ? arg.slice(2).split("=", 2) : [arg.slice(2), null];
  const nextValue = inlineValue ?? process.argv[i + 1];
  if (nextValue && !nextValue.startsWith("--") && inlineValue === null) i += 1;
  args.set(key, nextValue && !nextValue.startsWith("--") ? nextValue : true);
}

const envFile = String(args.get("env-file") || ".env");

if (!existsSync(envFile)) {
  console.error(`${envFile} does not exist.`);
  process.exit(1);
}

const env = parseEnv(readFileSync(envFile, "utf8"));
const failures = [];

const supabaseUrl = envValue("NEXT_PUBLIC_SUPABASE_URL");
const parsedSupabaseUrl = parseUrl("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
if (parsedSupabaseUrl && !isLocalHost(parsedSupabaseUrl.hostname) && parsedSupabaseUrl.protocol !== "https:") {
  failures.push("NEXT_PUBLIC_SUPABASE_URL must use HTTPS for non-local hosts.");
}

const apiUrlName = envValue("PUBLIC_API_URL")
  ? "PUBLIC_API_URL"
  : envValue("API_EXTERNAL_URL")
    ? "API_EXTERNAL_URL"
    : "";
if (apiUrlName && parsedSupabaseUrl) {
  const apiUrl = parseUrl(apiUrlName, envValue(apiUrlName));
  if (apiUrl && comparableUrl(parsedSupabaseUrl) !== comparableUrl(apiUrl)) {
    failures.push(`NEXT_PUBLIC_SUPABASE_URL must match ${apiUrlName}.`);
  }
}

const calendarWebhookUrl = envValue("GOOGLE_CALENDAR_WEBHOOK_URL");
const calendarCredentialsConfigured =
  Boolean(envValue("GOOGLE_CLIENT_ID")) || Boolean(envValue("GOOGLE_CLIENT_SECRET"));

if (calendarCredentialsConfigured && !calendarWebhookUrl) {
  failures.push("GOOGLE_CALENDAR_WEBHOOK_URL is required when Google Calendar credentials are configured.");
}

if (calendarWebhookUrl) {
  const webhook = parseUrl("GOOGLE_CALENDAR_WEBHOOK_URL", calendarWebhookUrl);
  if (webhook) {
    if (webhook.protocol !== "https:") {
      failures.push("GOOGLE_CALENDAR_WEBHOOK_URL must use HTTPS.");
    }
    if (isLocalHost(webhook.hostname)) {
      failures.push("GOOGLE_CALENDAR_WEBHOOK_URL must use a public HTTPS host.");
    }
    if (webhook.pathname !== "/api/calendar/webhook") {
      failures.push("GOOGLE_CALENDAR_WEBHOOK_URL path must be /api/calendar/webhook.");
    }
  }
}

if (failures.length) {
  console.error("Runtime configuration verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Runtime configuration verification passed.");

function parseEnv(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = unquote(match[2].trim());
  }
  return values;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function envValue(name) {
  return (env[name] ?? "").trim();
}

function parseUrl(name, value) {
  if (!value) {
    failures.push(`${name} is required.`);
    return null;
  }
  try {
    return new URL(value);
  } catch {
    failures.push(`${name} must be a valid URL.`);
    return null;
  }
}

function comparableUrl(url) {
  const comparable = new URL(url.toString());
  comparable.hash = "";
  comparable.search = "";
  return comparable.toString().replace(/\/$/, "");
}

function isLocalHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.endsWith(".localhost")
  );
}
