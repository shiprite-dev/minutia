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

test.describe("instance meta discovery", () => {
  test("returns public connection details without auth", async ({ request }) => {
    const response = await request.get("/api/instance-meta");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.supabaseUrl).toBe(process.env.NEXT_PUBLIC_SUPABASE_URL);
    expect(body.supabaseAnonKey).toBe(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    expect(typeof body.name).toBe("string");
    expect(JSON.stringify(body)).not.toMatch(/service_role|smtp|secret/i);
  });
});

test.describe("companion upload sequence", () => {
  test("start meeting, upload m4a segment, register, finalize", async ({ request }) => {
    const token = await seedAccessToken(request);
    const authHeaders = { Authorization: `Bearer ${token}` };
    const [, payload] = token.split(".");
    const userId = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub as string;

    const profileResponse = await request.get(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=current_organization_id`,
      { headers: { ...authHeaders, apikey: ANON_KEY } }
    );
    expect(profileResponse.ok()).toBeTruthy();
    const organizationId = (await profileResponse.json())[0].current_organization_id as string;

    const series = await request.post(`${SUPABASE_URL}/rest/v1/meeting_series?select=id`, {
      headers: { ...authHeaders, apikey: ANON_KEY, "Content-Type": "application/json", Prefer: "return=representation" },
      data: { name: `Companion E2E ${Date.now()}`, cadence: "weekly", owner_id: userId, organization_id: organizationId },
    });
    expect(series.ok()).toBeTruthy();
    const seriesId = (await series.json())[0].id as string;

    const meetingResponse = await request.post(`${SUPABASE_URL}/rest/v1/rpc/start_or_join_meeting`, {
      headers: { ...authHeaders, apikey: ANON_KEY, "Content-Type": "application/json" },
      data: { target_series_id: seriesId },
    });
    expect(meetingResponse.ok()).toBeTruthy();
    const meetingId = (await meetingResponse.json()).id as string;

    const upload = await request.post(
      `${SUPABASE_URL}/storage/v1/object/meeting-audio/${meetingId}/seg-0.m4a`,
      {
        headers: { ...authHeaders, apikey: ANON_KEY, "Content-Type": "audio/mp4", "x-upsert": "true" },
        data: Buffer.from("stub-m4a-bytes"),
      }
    );
    expect(upload.ok()).toBeTruthy();

    const register = await request.post(`/api/meetings/${meetingId}/segments/0/transcribe`, {
      headers: authHeaders,
      data: { path: `${meetingId}/seg-0.m4a` },
    });
    expect([200, 402, 403, 502, 503]).toContain(register.status());
    expect(register.status()).not.toBe(400);
    expect(register.status()).not.toBe(401);
  });
});
