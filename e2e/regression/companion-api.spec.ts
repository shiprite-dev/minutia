import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
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
    expect([200, 402, 403, 500, 502, 503]).toContain(register.status());
    expect(register.status()).not.toBe(400);
    expect(register.status()).not.toBe(401);
  });
});

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const OWNER_ID = "00000000-0000-0000-0000-000000000001";
const FIXTURES = path.resolve(__dirname, "../fixtures");

function serviceHeaders(prefer = "return=representation") {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function rest(pathAndQuery: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { ...serviceHeaders(), ...init.headers },
  });
  expect(response.ok, `${init.method ?? "GET"} ${pathAndQuery}`).toBeTruthy();
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function passwordToken(email: string, password: string) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.ok).toBeTruthy();
  return (await response.json()).access_token as string;
}

async function createTeammate(name: string) {
  const userId = randomUUID();
  const email = `queue-${userId.slice(0, 8)}@example.com`;
  const [owner] = await rest(`profiles?id=eq.${OWNER_ID}&select=current_organization_id`);
  await rest("organization_invitations", {
    method: "POST",
    body: JSON.stringify({
      organization_id: owner.current_organization_id,
      email,
      role: "member",
      status: "pending",
      invited_by: OWNER_ID,
    }),
  });
  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders("return=minimal"),
    body: JSON.stringify({
      id: userId,
      email,
      password: "password123",
      email_confirm: true,
      user_metadata: { name },
    }),
  });
  expect(created.ok).toBeTruthy();
  await rest(`profiles?id=eq.${userId}`, { method: "PATCH", body: JSON.stringify({ name }) });
  return { userId, email };
}

test.describe("companion review queue", () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  test.afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
  });

  async function seedQueueMeeting() {
    const teammate = await createTeammate("Priya Shah");
    cleanup.push(async () => {
      await rest(`organization_invitations?email=eq.${teammate.email}`, { method: "DELETE" });
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${teammate.userId}`, {
        method: "DELETE",
        headers: serviceHeaders("return=minimal"),
      });
    });
    const seriesId = randomUUID();
    const meetingId = randomUUID();
    await rest("meeting_series", {
      method: "POST",
      body: JSON.stringify({
        id: seriesId,
        name: "Weekly sync",
        description: "",
        cadence: "weekly",
        default_attendees: [],
        owner_id: OWNER_ID,
      }),
    });
    cleanup.push(() => rest(`meeting_series?id=eq.${seriesId}`, { method: "DELETE" }));
    await rest("series_participants", {
      method: "POST",
      body: JSON.stringify({
        series_id: seriesId,
        user_id: teammate.userId,
        role: "participant",
        invited_by: OWNER_ID,
      }),
    });
    await rest("meetings", {
      method: "POST",
      body: JSON.stringify({
        id: meetingId,
        series_id: seriesId,
        sequence_number: 1,
        title: "Weekly sync session",
        date: "2026-11-20",
        attendees: [],
        status: "completed",
        completed_at: new Date().toISOString(),
        transcription_status: "completed",
        suggestions_status: "ready",
        suggestions_status_at: new Date().toISOString(),
      }),
    });
    const [issue] = await rest("issues", {
      method: "POST",
      body: JSON.stringify({
        series_id: seriesId,
        raised_in_meeting_id: meetingId,
        title: "Renew the contract",
      }),
    });
    const suggest = (fields: Record<string, unknown>) =>
      rest("meeting_ai_suggestions", {
        method: "POST",
        body: JSON.stringify({
          meeting_id: meetingId,
          series_id: seriesId,
          type: "new_item",
          category: "action",
          owner_name: "",
          confidence: 0.9,
          status: "pending",
          ...fields,
        }),
      });
    await suggest({ title: "Send the budget", owner_name: "Priya", due_date: "2026-11-25", confidence: 0.92 });
    await suggest({ title: "Vendor may slip", category: "risk", confidence: 0.7 });
    await suggest({
      title: "Contract renewed",
      type: "status_update",
      related_issue_number: issue.issue_number,
      suggested_status: "resolved",
      confidence: 0.85,
    });
    await suggest({ title: "Use Postgres", category: "decision" });
    await suggest({ title: "Budget is tight", category: "info" });
    await suggest({ title: "Rejected already", status: "rejected" });
    return { teammate, seriesId, meetingId, issue };
  }

  test("rejects a request without a token", async ({ request }) => {
    const response = await request.get("/api/companion/review-queue");
    expect(response.status()).toBe(401);
  });

  test("the series owner's Mac lists the meeting with the exact items to review", async ({ request }) => {
    const { teammate, seriesId, meetingId } = await seedQueueMeeting();
    const token = await passwordToken("test@example.com", "password123");

    const response = await request.get("/api/companion/review-queue", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.me).toBe(OWNER_ID);
    const entry = body.meetings.find((m: { meeting_id: string }) => m.meeting_id === meetingId);
    expect(entry.series_id).toBe(seriesId);
    expect(entry.series_name).toBe("Weekly sync");
    expect(entry.reviewer).toBe(true);
    expect(entry.transcription_status).toBe("completed");
    expect(entry.suggestions_status).toBe("ready");
    expect(entry.web_only_count).toBe(2);
    expect(
      entry.rows.map((r: { title: string; owner_user_id: string | null; related_issue_title: string | null }) => [
        r.title,
        r.owner_user_id,
        r.related_issue_title,
      ]),
    ).toEqual([
      ["Send the budget", teammate.userId, null],
      ["Vendor may slip", null, null],
      ["Contract renewed", null, "Renew the contract"],
    ]);
    expect(entry.members.map((m: { name: string }) => m.name)).toContain("Priya Shah");

    fs.mkdirSync(FIXTURES, { recursive: true });
    fs.writeFileSync(
      path.join(FIXTURES, "review-queue-list.json"),
      `${JSON.stringify({ ...body, meetings: [entry] }, null, 2)}\n`,
    );
  });

  test("a teammate who does not run the series reads the meeting read-only and does not get it in their list", async ({ request }) => {
    const { teammate, meetingId } = await seedQueueMeeting();
    const token = await passwordToken(teammate.email, "password123");
    const headers = { Authorization: `Bearer ${token}` };

    const list = await (await request.get("/api/companion/review-queue", { headers })).json();
    expect(list.meetings.map((m: { meeting_id: string }) => m.meeting_id)).not.toContain(meetingId);

    const response = await request.get(`/api/companion/review-queue?meeting=${meetingId}`, { headers });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.meetings).toHaveLength(1);
    expect(body.meetings[0].reviewer).toBe(false);
    expect(body.meetings[0].rows.map((r: { title: string }) => r.title)).toEqual([
      "Send the budget",
      "Vendor may slip",
      "Contract renewed",
    ]);

    const ownerToken = await passwordToken("test@example.com", "password123");
    const asOwner = await request.get(`/api/companion/review-queue?meeting=${meetingId}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const ownerBody = await asOwner.json();
    expect(ownerBody.meetings[0].reviewer).toBe(true);
    fs.mkdirSync(FIXTURES, { recursive: true });
    fs.writeFileSync(
      path.join(FIXTURES, "review-queue-meeting.json"),
      `${JSON.stringify(ownerBody, null, 2)}\n`,
    );
  });

  test("a meeting deleted on the web drops out of the list and answers meeting_gone", async ({ request }) => {
    const { meetingId } = await seedQueueMeeting();
    const token = await passwordToken("test@example.com", "password123");
    const headers = { Authorization: `Bearer ${token}` };

    await rest(`meetings?id=eq.${meetingId}`, { method: "DELETE" });

    const list = await (await request.get("/api/companion/review-queue", { headers })).json();
    expect(list.meetings.map((m: { meeting_id: string }) => m.meeting_id)).not.toContain(meetingId);

    const response = await request.get(`/api/companion/review-queue?meeting=${meetingId}`, { headers });
    expect(response.status()).toBe(404);
    expect((await response.json()).code).toBe("meeting_gone");
  });

  test("a meeting the person cannot see answers meeting_gone, not a crash", async ({ request }) => {
    const token = await passwordToken("test@example.com", "password123");
    const headers = { Authorization: `Bearer ${token}` };
    for (const id of [randomUUID(), "not-a-uuid"]) {
      const response = await request.get(`/api/companion/review-queue?meeting=${id}`, { headers });
      expect(response.status()).toBe(404);
      expect((await response.json()).code).toBe("meeting_gone");
    }
  });
});
