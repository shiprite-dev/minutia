import { test, expect } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function seedAccessToken(request: import("@playwright/test").APIRequestContext) {
  const response = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    data: { email: "test@example.com", password: "password123" },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).access_token as string;
}

test.describe("companion Bearer auth", () => {
  test("api rejects cookie-less requests without a token", async ({ request }) => {
    const response = await request.get("/api/calendar/agenda");
    expect(response.status()).toBe(401);
  });

  test("api rejects a garbage bearer token", async ({ request }) => {
    const response = await request.get("/api/calendar/agenda", {
      headers: { Authorization: "Bearer not-a-jwt" },
    });
    expect(response.status()).toBe(401);
  });

  test("api accepts a valid bearer token end to end", async ({ request }) => {
    const token = await seedAccessToken(request);
    const response = await request.get("/api/calendar/agenda", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("connected");
  });

  test("api rejects a forged token that is structurally a valid JWT", async ({ request }) => {
    const token = await seedAccessToken(request);
    const [header, payload] = token.split(".");
    const forgedSignature = Buffer.from("forged-signature").toString("base64url");
    const forged = `${header}.${payload}.${forgedSignature}`;
    const response = await request.get("/api/calendar/agenda", {
      headers: { Authorization: `Bearer ${forged}` },
    });
    expect(response.status()).toBe(401);
  });

  test("api rejects a valid token with a tampered payload", async ({ request }) => {
    const token = await seedAccessToken(request);
    const [header, payload, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    decoded.sub = "00000000-0000-0000-0000-000000000000";
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    const tampered = `${header}.${tamperedPayload}.${signature}`;
    const response = await request.get("/api/calendar/agenda", {
      headers: { Authorization: `Bearer ${tampered}` },
    });
    expect(response.status()).toBe(401);
  });
});
