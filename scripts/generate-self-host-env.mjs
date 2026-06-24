#!/usr/bin/env node
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith("--")) {
    const [key, value] = arg.includes("=") ? arg.slice(2).split("=", 2) : [arg.slice(2), process.argv[i + 1]];
    args.set(key, value === undefined || value.startsWith?.("--") ? true : value);
    if (value !== undefined && !value.startsWith?.("--") && !arg.includes("=")) i += 1;
  }
}

const out = String(args.get("out") || ".env");
const force = args.has("force");
const siteUrl = normalizeUrl(String(args.get("site-url") || args.get("url") || args.get("host") || "http://localhost:3000"));
const defaultApiUrl = isLocalUrl(siteUrl) ? replacePort(siteUrl, "8000") : siteUrl;
const apiUrl = normalizeUrl(String(args.get("api-url") || defaultApiUrl));
const siteAddress = siteUrl.startsWith("https://") ? new URL(siteUrl).host : siteUrl;
const inviteRedirectUrl = `${siteUrl}/accept-invite`;
const calendarWebhookUrl = siteUrl.startsWith("https://") ? `${siteUrl}/api/calendar/webhook` : "";

if (existsSync(out) && !force) {
  console.error(`${out} already exists. Pass --force to replace it.`);
  process.exit(1);
}

const jwtSecret = randomBase64(48);
const anonKey = signJwt(jwtSecret, "anon");
const serviceRoleKey = signJwt(jwtSecret, "service_role");
const postgresPassword = randomBase64Url(30);
const secretKeyBase = randomBase64(48);
const setupToken = randomBase64Url(32);

const env = `# Generated for Minutia self-hosting.
# Keep this file private.

PUBLIC_URL=${siteUrl}
MINUTIA_APP_SITE_ADDRESS=${siteAddress}

WEB_BIND=127.0.0.1
WEB_PORT=3000
KONG_BIND=127.0.0.1
KONG_HTTP_PORT=8000

JWT_SECRET=${jwtSecret}
ANON_KEY=${anonKey}
SERVICE_ROLE_KEY=${serviceRoleKey}
NEXT_PUBLIC_SUPABASE_URL=${apiUrl}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}
SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}
MINUTIA_SETUP_TOKEN=${setupToken}

SITE_URL=${siteUrl}
API_EXTERNAL_URL=${apiUrl}

POSTGRES_PASSWORD=${postgresPassword}
POSTGRES_DB=minutia
JWT_EXPIRY=3600
SECRET_KEY_BASE=${secretKeyBase}

DISABLE_SIGNUP=false
NEXT_PUBLIC_ENABLE_PUBLIC_SIGNUP=true
NEXT_PUBLIC_ENABLE_MAGIC_LINK=false
NEXT_PUBLIC_ENABLE_GUEST_LOGIN=false
NEXT_PUBLIC_FEATURE_GATING=false
ENABLE_EMAIL_AUTOCONFIRM=false
ENABLE_EMAIL_SIGNUP=true
ENABLE_ANONYMOUS_SIGN_INS=false
ADDITIONAL_REDIRECT_URLS=${inviteRedirectUrl}

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_ADMIN_EMAIL=admin@localhost
SMTP_SENDER_NAME=Minutia
EMAIL_FROM=noreply@localhost

OPENROUTER_API_KEY=
AI_API_KEY=
AI_MODEL=claude-sonnet-4-6
AI_MODEL_FALLBACK=google/gemini-3.1-flash-lite

RESEND_API_KEY=
ENABLE_GOOGLE_AUTH=false
GOOGLE_AUTH_CLIENT_ID=
GOOGLE_AUTH_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=${siteUrl}/api/auth/google/callback
GOOGLE_CALENDAR_WEBHOOK_URL=${calendarWebhookUrl}
GOOGLE_TOKEN_ENCRYPTION_KEY=

`;

writeFileSync(out, env, { mode: 0o600 });
console.log(`Wrote ${out}`);
console.log(`Site URL: ${siteUrl}`);
console.log(`Supabase API URL: ${apiUrl}`);
console.log(`Setup token: ${setupToken}`);

function normalizeUrl(value) {
  if (value.startsWith("http://") || value.startsWith("https://")) return value.replace(/\/$/, "");
  return `http://${value.replace(/\/$/, "")}`;
}

function isLocalUrl(value) {
  const hostname = new URL(value).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function replacePort(value, port) {
  const parsed = new URL(value);
  parsed.port = port;
  return parsed.toString().replace(/\/$/, "");
}

function randomBase64(bytes) {
  return randomBytes(bytes).toString("base64");
}

function randomBase64Url(bytes) {
  return randomBytes(bytes).toString("base64url");
}

function signJwt(secret, role) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: "authenticated",
    exp: now + 60 * 60 * 24 * 365 * 10,
    iat: now,
    iss: "supabase",
    role,
  };
  const header = { alg: "HS256", typ: "JWT" };
  const body = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
