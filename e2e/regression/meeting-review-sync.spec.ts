import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
} from "@playwright/test";
import { waitForApp } from "./seed-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const PASSWORD = "password123";

type Member = { userId: string; email: string; cookieValue: string };

function serviceHeaders(prefer = "return=representation") {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function rest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...serviceHeaders(), ...init.headers },
  });
  expect(response.ok, `${init.method ?? "GET"} ${path}`).toBeTruthy();
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function createMember(name: string): Promise<Member> {
  const userId = randomUUID();
  const email = `review-${userId.slice(0, 8)}@example.com`;
  const [owner] = await rest(
    `profiles?id=eq.${TEST_USER_ID}&select=current_organization_id`,
  );
  await rest("organization_invitations", {
    method: "POST",
    body: JSON.stringify({
      organization_id: owner.current_organization_id,
      email,
      role: "member",
      status: "pending",
      invited_by: TEST_USER_ID,
    }),
  });
  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders("return=minimal"),
    body: JSON.stringify({
      id: userId,
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name },
    }),
  });
  expect(created.ok).toBeTruthy();
  await rest(`profiles?id=eq.${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });

  const token = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: SERVICE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    },
  );
  expect(token.ok).toBeTruthy();
  const session = await token.json();
  return {
    userId,
    email,
    cookieValue: `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`,
  };
}

async function deleteMember(member: Member) {
  await rest(`organization_invitations?email=eq.${member.email}`, {
    method: "DELETE",
  });
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${member.userId}`, {
    method: "DELETE",
    headers: serviceHeaders("return=minimal"),
  });
}

async function createMeeting() {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 6)}`;
  const seriesId = randomUUID();
  const meetingId = randomUUID();
  await rest("meeting_series", {
    method: "POST",
    body: JSON.stringify({
      id: seriesId,
      name: `Review sync ${stamp}`,
      description: "",
      cadence: "weekly",
      default_attendees: [],
      owner_id: TEST_USER_ID,
    }),
  });
  await rest("meetings", {
    method: "POST",
    body: JSON.stringify({
      id: meetingId,
      series_id: seriesId,
      sequence_number: 1,
      title: `Review sync session ${stamp}`,
      date: "2026-11-20",
      attendees: [],
      status: "completed",
      completed_at: new Date().toISOString(),
    }),
  });
  return { seriesId, meetingId, stamp };
}

async function addParticipant(
  seriesId: string,
  userId: string,
  role: "participant" | "facilitator",
) {
  await rest("series_participants", {
    method: "POST",
    body: JSON.stringify({
      series_id: seriesId,
      user_id: userId,
      role,
      invited_by: TEST_USER_ID,
    }),
  });
}

async function seedSuggestion(
  seriesId: string,
  meetingId: string,
  fields: Record<string, unknown>,
): Promise<string> {
  const [row] = await rest("meeting_ai_suggestions", {
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
  return row.id;
}

async function suggestionStatus(id: string): Promise<string> {
  const [row] = await rest(`meeting_ai_suggestions?id=eq.${id}&select=status`);
  return row.status;
}

async function seriesIssues(
  seriesId: string,
): Promise<{ title: string; owner_user_id: string | null; status: string }[]> {
  return rest(
    `issues?series_id=eq.${seriesId}&select=title,owner_user_id,status&order=created_at`,
  );
}

async function issueOwners(
  seriesId: string,
): Promise<{ owner_name: string; owner_user_id: string | null }[]> {
  return rest(
    `issues?series_id=eq.${seriesId}&select=owner_name,owner_user_id&order=created_at`,
  );
}

async function queuedSuggestionIds(meetingId: string): Promise<string[]> {
  const response = await fetch(
    `${process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"}/api/companion/review-queue?meeting=${meetingId}`,
    {
      headers: {
        Authorization: `Bearer ${await signInToken("test@example.com")}`,
      },
    },
  );
  expect(response.status).toBe(200);
  return (await response.json()).meetings[0].rows.map(
    (r: { id: string }) => r.id,
  );
}

const DB_CONTAINER = "supabase_db_minutia";

function sql(statement: string): string {
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      DB_CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-tAq",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: statement, encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

async function holdSuggestionRow(suggestionId: string) {
  const session = spawn("docker", [
    "exec",
    "-i",
    DB_CONTAINER,
    "psql",
    "-U",
    "postgres",
    "-tAq",
    "-v",
    "ON_ERROR_STOP=1",
  ]);
  let output = "";
  session.stdout.on("data", (chunk) => (output += chunk));
  session.stderr.on("data", (chunk) => (output += chunk));
  session.on("error", (error) => (output += `spawn failed: ${error.message}`));
  const printed = (marker: string) =>
    expect
      .poll(() => output, { timeout: 10_000 })
      .toMatch(new RegExp(`(^|\\n)${marker}`));
  const release = () => {
    session.kill();
    const pid = output.match(/^PID (\d+)$/m)?.[1];
    if (pid)
      spawnSync(
        "docker",
        ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-tAq"],
        { input: `select pg_terminate_backend(${pid});`, encoding: "utf8" },
      );
  };
  try {
    session.stdin.write(
      `select 'PID ' || pg_backend_pid();\nbegin;\nselect id from public.meeting_ai_suggestions where id = '${suggestionId}' for update;\n\\echo HELD\n`,
    );
    await printed("HELD");
  } catch (error) {
    release();
    throw error;
  }
  return {
    release,
    async commit(statement: string) {
      session.stdin.write(`${statement}\ncommit;\n\\echo DONE\n`);
      await printed("DONE");
      session.stdin.end();
    },
  };
}

async function signInToken(email: string): Promise<string> {
  const token = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: SERVICE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    },
  );
  expect(token.ok).toBeTruthy();
  return (await token.json()).access_token;
}

async function keepAs(
  accessToken: string | null,
  meetingId: string,
  suggestionId: string,
  overrides: Record<string, unknown> = {},
) {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/keep_ai_suggestion`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken ?? anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_suggestion_id: suggestionId,
      p_meeting_id: meetingId,
      p_title: "Kept directly",
      p_details: "",
      p_category: "action",
      p_owner_name: "",
      p_issue_owner_name: "",
      p_owner_user_id: null,
      p_due_date: null,
      p_target_status: null,
      ...overrides,
    }),
  });
}

const reviewUrl = (meetingId: string, suggestionId: string) =>
  `/api/meetings/${meetingId}/suggestions/${suggestionId}`;

async function requestAs(baseURL: string | undefined, member: Member) {
  const origin = new URL(baseURL ?? "http://localhost:3000").origin;
  return playwrightRequest.newContext({
    baseURL: origin,
    storageState: {
      cookies: [
        {
          name: "sb-127-auth-token",
          value: member.cookieValue,
          domain: new URL(origin).hostname,
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 3600,
          httpOnly: false,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
  });
}

test.describe("Keeping AI action items from more than one place", () => {
  test.skip(!SERVICE_KEY, "Requires the service role to seed suggestions");

  const seriesToDelete: string[] = [];
  const membersToDelete: Member[] = [];

  test.afterEach(async () => {
    for (const id of seriesToDelete.splice(0)) {
      await rest(`meeting_series?id=eq.${id}`, { method: "DELETE" });
    }
    for (const member of membersToDelete.splice(0)) await deleteMember(member);
  });

  test("aKeepThatLosesTheRaceWhileWaiting_saysAlreadyReviewedAndAddsNothing", async ({
    request,
  }) => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const title = `Send the vendor contract ${stamp}`;
    const suggestionId = await seedSuggestion(seriesId, meetingId, { title });

    const lock = await holdSuggestionRow(suggestionId);
    let keep: ReturnType<typeof request.patch> | undefined;
    try {
      keep = request.patch(reviewUrl(meetingId, suggestionId), {
        data: { action: "accept" },
      });
      await expect
        .poll(
          () =>
            sql(
              "select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%keep_ai_suggestion%';",
            ),
          { timeout: 10_000 },
        )
        .toBe("1");
      await lock.commit(
        `update public.meeting_ai_suggestions set status = 'accepted', reviewed_at = now() where id = '${suggestionId}';`,
      );
    } finally {
      lock.release();
    }

    const response = await keep;
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "already_reviewed",
      error: "AI suggestion has already been reviewed.",
    });
    expect(await seriesIssues(seriesId)).toEqual([]);
    expect(await suggestionStatus(suggestionId)).toBe("accepted");
  });

  test("keepingWithADueDateFromTheMac_showsThatDateOnTheItem", async ({
    page,
  }) => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const title = `File the expense report ${stamp}`;
    const suggestionId = await seedSuggestion(seriesId, meetingId, {
      title,
      due_date: "2026-11-25",
    });

    const response = await page.request.patch(
      reviewUrl(meetingId, suggestionId),
      {
        data: {
          action: "accept",
          owner_user_id: TEST_USER_ID,
          due_date: "2026-11-27",
        },
      },
    );
    expect(response.status()).toBe(200);
    expect(
      await rest(`issues?series_id=eq.${seriesId}&select=title,due_date`),
    ).toEqual([{ title, due_date: "2026-11-27" }]);

    await page.goto("/actions");
    await waitForApp(page);
    const row = page
      .getByRole("link", { name: title, exact: true })
      .locator("xpath=..");
    await expect(row.getByText("Nov 27", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await page.reload();
    await waitForApp(page);
    await expect(row.getByText("Nov 27", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("choosingNoDate_clearsTheAIsGuess", async ({ request }) => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const title = `Call the printer ${stamp}`;
    const suggestionId = await seedSuggestion(seriesId, meetingId, {
      title,
      due_date: "2026-11-25",
    });

    const response = await request.patch(reviewUrl(meetingId, suggestionId), {
      data: { action: "accept", due_date: null },
    });

    expect(response.status()).toBe(200);
    expect(
      await rest(`issues?series_id=eq.${seriesId}&select=title,due_date`),
    ).toEqual([{ title, due_date: null }]);
  });

  test("skippingAnItem_neverPutsItOnTheBoardAndItLeavesTheMacQueue", async ({
    request,
  }) => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const skipped = await seedSuggestion(seriesId, meetingId, {
      title: `Repaint the lobby ${stamp}`,
    });
    const kept = await seedSuggestion(seriesId, meetingId, {
      title: `Fix the door ${stamp}`,
    });
    expect((await queuedSuggestionIds(meetingId)).sort()).toEqual(
      [skipped, kept].sort(),
    );

    const response = await request.patch(reviewUrl(meetingId, skipped), {
      data: { action: "reject" },
    });

    expect(response.status()).toBe(200);
    expect((await response.json()).code).toBe("saved");
    expect(await suggestionStatus(skipped)).toBe("rejected");
    expect(await seriesIssues(seriesId)).toEqual([]);
    expect(await queuedSuggestionIds(meetingId)).toEqual([kept]);
  });

  test("skippingAfterAKeepOnTheWeb_saysAlreadyReviewedAndTheItemStays", async ({
    request,
  }) => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const title = `Renew the parking permit ${stamp}`;
    const suggestionId = await seedSuggestion(seriesId, meetingId, { title });
    expect(
      (
        await request.patch(reviewUrl(meetingId, suggestionId), {
          data: { action: "accept" },
        })
      ).status(),
    ).toBe(200);

    const response = await request.patch(reviewUrl(meetingId, suggestionId), {
      data: { action: "reject" },
    });

    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "already_reviewed",
      error: "AI suggestion has already been reviewed.",
    });
    expect((await seriesIssues(seriesId)).map((i) => i.title)).toEqual([title]);
    expect(await suggestionStatus(suggestionId)).toBe("accepted");
  });

  test("keepingAfterASkip_saysAlreadyReviewedAndAddsNothing", async ({
    request,
  }) => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const suggestionId = await seedSuggestion(seriesId, meetingId, {
      title: `Cancel the old plan ${stamp}`,
    });
    expect(
      (
        await request.patch(reviewUrl(meetingId, suggestionId), {
          data: { action: "reject" },
        })
      ).status(),
    ).toBe(200);

    const response = await request.patch(reviewUrl(meetingId, suggestionId), {
      data: { action: "accept" },
    });

    expect(response.status()).toBe(409);
    expect((await response.json()).code).toBe("already_reviewed");
    expect(await seriesIssues(seriesId)).toEqual([]);
    expect(await suggestionStatus(suggestionId)).toBe("rejected");
  });

  test("aSaveForAMeetingDeletedOnTheWeb_saysTheListWasUpdated", async ({
    request,
  }) => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const title = `Book the room ${stamp}`;
    const suggestionId = await seedSuggestion(seriesId, meetingId, { title });

    await rest(`meetings?id=eq.${meetingId}`, { method: "DELETE" });
    const afterMeeting = await request.patch(
      reviewUrl(meetingId, suggestionId),
      { data: { action: "accept" } },
    );
    expect(afterMeeting.status()).toBe(404);
    expect(await afterMeeting.json()).toMatchObject({
      code: "suggestion_gone",
      error: "AI suggestion not found",
    });
    expect(await seriesIssues(seriesId)).toEqual([]);

    await rest(`meeting_series?id=eq.${seriesId}`, { method: "DELETE" });
    const afterSeries = await request.patch(
      reviewUrl(meetingId, suggestionId),
      { data: { action: "accept" } },
    );
    expect(afterSeries.status()).toBe(404);
    expect((await afterSeries.json()).code).toBe("suggestion_gone");
    expect(
      await rest(`issues?title=eq.${encodeURIComponent(title)}&select=id`),
    ).toEqual([]);
  });

  test("everyRefusalTheMacReadsCarriesItsCode", async ({
    request,
    baseURL,
  }) => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const plain = await seedSuggestion(seriesId, meetingId, {
      title: `Plain item ${stamp}`,
    });
    const unlinked = await seedSuggestion(seriesId, meetingId, {
      type: "status_update",
      title: `Unlinked update ${stamp}`,
      suggested_status: "resolved",
    });
    const [issue] = await rest("issues", {
      method: "POST",
      body: JSON.stringify({
        series_id: seriesId,
        raised_in_meeting_id: meetingId,
        title: `Linked item ${stamp}`,
        category: "action",
      }),
    });
    const noTarget = await seedSuggestion(seriesId, meetingId, {
      type: "status_update",
      title: `No target ${stamp}`,
      related_issue_number: issue.issue_number,
      suggested_status: null,
    });

    const invalid = await request.patch(reviewUrl(meetingId, plain), {
      data: { action: "maybe" },
    });
    expect([invalid.status(), (await invalid.json()).code]).toEqual([
      400,
      "invalid_request",
    ]);

    const signedOut = await playwrightRequest.newContext({
      baseURL: new URL(baseURL ?? "http://localhost:3000").origin,
      storageState: { cookies: [], origins: [] },
    });
    try {
      const response = await signedOut.patch(reviewUrl(meetingId, plain), {
        data: { action: "accept" },
      });
      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual({ error: "Not authenticated" });
    } finally {
      await signedOut.dispose();
    }

    const notLinked = await request.patch(reviewUrl(meetingId, unlinked), {
      data: { action: "accept" },
    });
    expect(await notLinked.json()).toMatchObject({
      code: "not_linked",
      error: "This suggestion is not linked to an existing item.",
    });
    expect(notLinked.status()).toBe(400);

    const missingTarget = await request.patch(reviewUrl(meetingId, noTarget), {
      data: { action: "accept" },
    });
    expect(await missingTarget.json()).toMatchObject({
      code: "no_target_status",
      error: "This suggestion has no target status to apply.",
    });
    expect(missingTarget.status()).toBe(400);

    expect(
      (await seriesIssues(seriesId)).map((i) => [i.title, i.status]),
    ).toEqual([[`Linked item ${stamp}`, "open"]]);
    for (const id of [plain, unlinked, noTarget])
      expect(await suggestionStatus(id)).toBe("pending");
  });

  test("keepingAnItemNamedForASeriesMember_showsTheirFullNameOnTheBoard", async ({
    request,
  }) => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const priya = await createMember("Priya Shah");
    membersToDelete.push(priya);
    const sam = await createMember("Sam Lee");
    membersToDelete.push(sam);
    await addParticipant(seriesId, priya.userId, "participant");
    await addParticipant(seriesId, sam.userId, "participant");
    const title = `Book the launch venue ${stamp}`;
    const suggestionId = await seedSuggestion(seriesId, meetingId, {
      title,
      owner_name: "Priya",
    });

    const response = await request.patch(reviewUrl(meetingId, suggestionId), {
      data: { action: "accept" },
    });

    expect(response.status()).toBe(200);
    expect((await response.json()).code).toBe("saved");
    expect(await seriesIssues(seriesId)).toEqual([
      { title, owner_user_id: priya.userId, status: "open" },
    ]);
    expect(await issueOwners(seriesId)).toEqual([
      { owner_name: "Priya Shah", owner_user_id: priya.userId },
    ]);
  });

  test("aFirstNameSharedByTwoMembers_keepsTheItemUnassigned", async ({
    request,
  }) => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    for (const name of ["Alex Kim", "Alex Roe"]) {
      const member = await createMember(name);
      membersToDelete.push(member);
      await addParticipant(seriesId, member.userId, "participant");
    }
    const suggestionId = await seedSuggestion(seriesId, meetingId, {
      title: `Update the roadmap ${stamp}`,
      owner_name: "Alex",
    });

    const response = await request.patch(reviewUrl(meetingId, suggestionId), {
      data: { action: "accept" },
    });

    expect(response.status()).toBe(200);
    expect(await issueOwners(seriesId)).toEqual([
      { owner_name: "Alex", owner_user_id: null },
    ]);
  });

  test("keepingAnItemNamedForNobodyInTheSeries_leavesItUnassigned", async ({
    request,
  }) => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const title = `Draft the press note ${stamp}`;
    const suggestionId = await seedSuggestion(seriesId, meetingId, {
      title,
      owner_name: "Jordan",
    });

    const response = await request.patch(reviewUrl(meetingId, suggestionId), {
      data: { action: "accept" },
    });

    expect(response.status()).toBe(200);
    expect(await seriesIssues(seriesId)).toEqual([
      { title, owner_user_id: null, status: "open" },
    ]);
  });

  test("keepingWithOwnerMe_putsTheItemInMyActions", async ({ page }) => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const title = `Renew the domain ${stamp}`;
    const suggestionId = await seedSuggestion(seriesId, meetingId, { title });

    const response = await page.request.patch(
      reviewUrl(meetingId, suggestionId),
      {
        data: { action: "accept", owner_user_id: TEST_USER_ID },
      },
    );
    expect(response.status()).toBe(200);
    expect((await response.json()).code).toBe("saved");

    expect((await seriesIssues(seriesId)).map((i) => i.owner_user_id)).toEqual([
      TEST_USER_ID,
    ]);

    await page.goto("/actions");
    await waitForApp(page);
    await expect(page.getByText(title, { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await page.reload();
    await waitForApp(page);
    await expect(page.getByText(title, { exact: true })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("aFacilitatorWithNoNameSet_canStillTakeAnItemThemselves", async ({
    baseURL,
  }) => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const facilitator = await createMember("");
    membersToDelete.push(facilitator);
    await addParticipant(seriesId, facilitator.userId, "facilitator");
    const title = `Collect the badges ${stamp}`;
    const suggestionId = await seedSuggestion(seriesId, meetingId, { title });

    const asFacilitator = await requestAs(baseURL, facilitator);
    try {
      const response = await asFacilitator.patch(
        reviewUrl(meetingId, suggestionId),
        { data: { action: "accept", owner_user_id: facilitator.userId } },
      );
      expect(response.status()).toBe(200);
      expect((await response.json()).code).toBe("saved");
    } finally {
      await asFacilitator.dispose();
    }
    expect(await seriesIssues(seriesId)).toEqual([
      { title, owner_user_id: facilitator.userId, status: "open" },
    ]);
  });

  test("keepingWithSomeoneOutsideTheSeries_isRefusedAndNothingIsAdded", async ({
    request,
  }) => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const outsider = await createMember("Casey Out");
    membersToDelete.push(outsider);
    const suggestionId = await seedSuggestion(seriesId, meetingId, {
      title: `Order badges ${stamp}`,
    });

    const response = await request.patch(reviewUrl(meetingId, suggestionId), {
      data: { action: "accept", owner_user_id: outsider.userId },
    });

    expect(response.status()).toBe(400);
    expect((await response.json()).code).toBe("not_a_member");
    expect(await seriesIssues(seriesId)).toEqual([]);
    expect(await suggestionStatus(suggestionId)).toBe("pending");
  });

  test("statusChangeOnAnItemAlreadyThere_saysAlreadyDone", async ({
    request,
  }) => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const [issue] = await rest("issues", {
      method: "POST",
      body: JSON.stringify({
        series_id: seriesId,
        raised_in_meeting_id: meetingId,
        title: `Hire a contractor ${stamp}`,
        category: "action",
        status: "resolved",
      }),
    });
    const suggestionId = await seedSuggestion(seriesId, meetingId, {
      type: "status_update",
      title: `Contractor hired ${stamp}`,
      related_issue_number: issue.issue_number,
      suggested_status: "resolved",
    });

    const response = await request.patch(reviewUrl(meetingId, suggestionId), {
      data: { action: "accept" },
    });

    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "already_in_state",
      error: "The referenced item is already in that status.",
    });
    expect(await suggestionStatus(suggestionId)).toBe("pending");
  });

  test("onADeletedItem_saysItWasRemoved", async ({ request }) => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const suggestionId = await seedSuggestion(seriesId, meetingId, {
      type: "status_update",
      title: `Removed item moved ${stamp}`,
      related_issue_number: 987654,
      suggested_status: "resolved",
    });

    const response = await request.patch(reviewUrl(meetingId, suggestionId), {
      data: { action: "accept" },
    });

    expect(response.status()).toBe(404);
    expect(await response.json()).toMatchObject({
      code: "item_gone",
      error: "The referenced item no longer exists.",
    });
    expect(await suggestionStatus(suggestionId)).toBe("pending");
  });

  test("aSuggestionThatNoLongerExists_saysItIsGone", async ({ request }) => {
    const { seriesId, meetingId } = await createMeeting();
    seriesToDelete.push(seriesId);

    const response = await request.patch(reviewUrl(meetingId, randomUUID()), {
      data: { action: "accept" },
    });

    expect(response.status()).toBe(404);
    expect(await response.json()).toMatchObject({
      code: "suggestion_gone",
      error: "AI suggestion not found",
    });
  });

  test("keepingADecision_recordsItWithTheMeetingAndNotOnTheBoard", async ({
    request,
  }) => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const title = `Move launch to March ${stamp}`;
    const suggestionId = await seedSuggestion(seriesId, meetingId, {
      title,
      category: "decision",
      owner_name: "Alice",
      details: "Vendor cannot ship before then.",
    });

    const response = await request.patch(reviewUrl(meetingId, suggestionId), {
      data: { action: "accept" },
    });

    expect(response.status()).toBe(200);
    expect((await response.json()).code).toBe("saved");
    expect(
      await rest(
        `decisions?meeting_id=eq.${meetingId}&select=title,rationale,made_by,source,created_by`,
      ),
    ).toEqual([
      {
        title,
        rationale: "Vendor cannot ship before then.",
        made_by: "Alice",
        source: "ai_suggested",
        created_by: TEST_USER_ID,
      },
    ]);
    expect(await seriesIssues(seriesId)).toEqual([]);
    expect(await suggestionStatus(suggestionId)).toBe("accepted");
  });

  test("someoneSignedOut_cannotKeepAnItem", async () => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const suggestionId = await seedSuggestion(seriesId, meetingId, {
      title: `Water the plants ${stamp}`,
    });

    const response = await keepAs(null, meetingId, suggestionId);

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("42501");
    expect(await seriesIssues(seriesId)).toEqual([]);
    expect(await suggestionStatus(suggestionId)).toBe("pending");
  });

  test("aKeepThatFailsHalfway_addsNothingToTheBoard", async () => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const suggestionId = await seedSuggestion(seriesId, meetingId, {
      title: `Book the train ${stamp}`,
    });

    const response = await keepAs(
      await signInToken("test@example.com"),
      meetingId,
      suggestionId,
      { p_title: `Book the train ${stamp}`, p_details: null },
    );

    expect(response.ok).toBe(false);
    expect(await seriesIssues(seriesId)).toEqual([]);
    expect(await suggestionStatus(suggestionId)).toBe("pending");
  });

  test("keepingDirectly_anItemThatIsGoneOrAlreadyReviewed_saysWhich", async () => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const suggestionId = await seedSuggestion(seriesId, meetingId, {
      title: `Sweep the floor ${stamp}`,
      status: "rejected",
    });
    const token = await signInToken("test@example.com");

    const gone = await keepAs(token, meetingId, randomUUID());
    expect(await gone.json()).toEqual({ code: "suggestion_gone" });
    const reviewed = await keepAs(token, meetingId, suggestionId);
    expect(await reviewed.json()).toEqual({ code: "already_reviewed" });
    expect(await seriesIssues(seriesId)).toEqual([]);
  });

  test("aTeammateWhoDoesNotRunTheSeries_cannotKeep", async ({ baseURL }) => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const teammate = await createMember("Tara Team");
    membersToDelete.push(teammate);
    await addParticipant(seriesId, teammate.userId, "participant");
    const suggestionId = await seedSuggestion(seriesId, meetingId, {
      title: `Plan the offsite ${stamp}`,
    });

    const origin = new URL(baseURL ?? "http://localhost:3000").origin;
    const teammateRequest = await playwrightRequest.newContext({
      baseURL: origin,
      storageState: {
        cookies: [
          {
            name: "sb-127-auth-token",
            value: teammate.cookieValue,
            domain: new URL(origin).hostname,
            path: "/",
            expires: Math.floor(Date.now() / 1000) + 3600,
            httpOnly: false,
            secure: false,
            sameSite: "Lax",
          },
        ],
        origins: [],
      },
    });
    try {
      const response = await teammateRequest.patch(
        reviewUrl(meetingId, suggestionId),
        {
          data: { action: "accept" },
        },
      );
      expect(response.status()).toBe(403);
      expect(await response.json()).toMatchObject({
        code: "not_reviewer",
        error: "Only series owners and facilitators can review AI suggestions.",
      });
    } finally {
      await teammateRequest.dispose();
    }
    const teammateKeep = await keepAs(
      await signInToken(teammate.email),
      meetingId,
      suggestionId,
    );
    expect(await teammateKeep.json()).toEqual({ code: "not_reviewer" });
    expect(await seriesIssues(seriesId)).toEqual([]);
    expect(await suggestionStatus(suggestionId)).toBe("pending");
  });

  test.describe("with the meeting page open", () => {
    type Frame = { topic: string; event: string; text: string };

    function watchRealtime(page: Page, meetingId: string) {
      const frames: Frame[] = [];
      const topic = `realtime:meeting:${meetingId}:ai-suggestions`;
      let markJoined: () => void = () => {};
      const joined = new Promise<void>((resolve) => (markJoined = resolve));
      page.on("websocket", (socket) => {
        socket.on("framereceived", ({ payload }) => {
          const text =
            typeof payload === "string" ? payload : payload.toString();
          let message: unknown;
          try {
            message = JSON.parse(text);
          } catch {
            return;
          }
          const [frameTopic, event, body] = Array.isArray(message)
            ? [message[2], message[3], message[4]]
            : [
                (message as { topic: string }).topic,
                (message as { event: string }).event,
                (message as { payload: unknown }).payload,
              ];
          frames.push({ topic: frameTopic, event, text });
          if (
            frameTopic === topic &&
            event === "phx_reply" &&
            (body as { status?: string })?.status === "ok"
          )
            markJoined();
        });
      });
      const sentTopics: string[] = [];
      page.on("websocket", (socket) => {
        socket.on("framesent", ({ payload }) => {
          const text =
            typeof payload === "string" ? payload : payload.toString();
          try {
            const message = JSON.parse(text);
            sentTopics.push(
              Array.isArray(message) ? message[2] : message.topic,
            );
          } catch {
            return;
          }
        });
      });
      return { frames, joined, sentTopics };
    }

    async function openMeetingWithNotes(
      page: Page,
      seriesId: string,
      meetingId: string,
    ) {
      await rest(`meetings?id=eq.${meetingId}`, {
        method: "PATCH",
        body: JSON.stringify({ notes_markdown: "Notes from the call" }),
      });
      const realtime = watchRealtime(page, meetingId);
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await waitForApp(page);
      await realtime.joined;
      await page.evaluate(() => {
        (
          window as unknown as { openedBeforeReview: boolean }
        ).openedBeforeReview = true;
      });
      return realtime;
    }

    const stillSamePage = (page: Page) =>
      page.evaluate(
        () =>
          (window as unknown as { openedBeforeReview?: boolean })
            .openedBeforeReview,
      );

    test("aReviewDoneOnTheMac_appearsOnTheMeetingPageWithoutReload", async ({
      page,
      baseURL,
    }) => {
      const { seriesId, meetingId, stamp } = await createMeeting();
      seriesToDelete.push(seriesId);
      const title = `Confirm the catering order ${stamp}`;
      const suggestionId = await seedSuggestion(seriesId, meetingId, { title });
      await openMeetingWithNotes(page, seriesId, meetingId);
      const suggestions = page.getByRole("region", { name: "AI suggestions" });
      await expect(suggestions.locator(`input[value="${title}"]`)).toBeVisible({
        timeout: 5_000,
      });

      const response = await fetch(
        `${baseURL}${reviewUrl(meetingId, suggestionId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${await signInToken("test@example.com")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "accept" }),
        },
      );
      expect(response.status).toBe(200);

      await expect(suggestions.locator(`input[value="${title}"]`)).toHaveCount(
        0,
        {
          timeout: 5_000,
        },
      );
      await expect(
        page
          .getByRole("region", { name: "Items raised" })
          .getByText(title, { exact: true }),
      ).toBeVisible({ timeout: 5_000 });
      expect(await stillSamePage(page)).toBe(true);
    });

    test("aSlowOlderListResponse_neverBringsBackAnItemAlreadyKept", async ({
      page,
      baseURL,
    }) => {
      const { seriesId, meetingId, stamp } = await createMeeting();
      seriesToDelete.push(seriesId);
      const title = `Order the banners ${stamp}`;
      const suggestionId = await seedSuggestion(seriesId, meetingId, { title });
      await openMeetingWithNotes(page, seriesId, meetingId);
      const suggestions = page.getByRole("region", { name: "AI suggestions" });
      const row = suggestions.locator(`input[value="${title}"]`);
      await expect(row).toBeVisible({ timeout: 5_000 });

      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      let markStale: () => void = () => {};
      const staleFetched = new Promise<void>(
        (resolve) => (markStale = resolve),
      );
      await page.route(
        `**/api/meetings/${meetingId}/suggestions`,
        async (route) => {
          const stale = await route.fetch();
          markStale();
          await held;
          await route.fulfill({ response: stale });
        },
        { times: 1 },
      );
      await rest(`meeting_ai_suggestions?id=eq.${suggestionId}`, {
        method: "PATCH",
        body: JSON.stringify({ confidence: 0.8 }),
      });
      await staleFetched;

      const kept = await fetch(
        `${baseURL}${reviewUrl(meetingId, suggestionId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${await signInToken("test@example.com")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "accept" }),
        },
      );
      expect(kept.status).toBe(200);
      await expect(row).toHaveCount(0, { timeout: 5_000 });

      const staleResponse = page.waitForResponse((r) =>
        r.url().endsWith(`/api/meetings/${meetingId}/suggestions`),
      );
      release();
      await (await staleResponse).finished();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await expect(row).toHaveCount(0);
    });

    test("savingNotesOnTheMeeting_doesNotReloadTheActionItemsList", async ({
      page,
    }) => {
      const { seriesId, meetingId, stamp } = await createMeeting();
      seriesToDelete.push(seriesId);
      await rest(`meetings?id=eq.${meetingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          suggestions_status: "ready",
          suggestions_status_at: "2026-11-20T09:00:00.000Z",
        }),
      });
      const title = `Keep the list steady ${stamp}`;
      await seedSuggestion(seriesId, meetingId, { title });
      const realtime = await openMeetingWithNotes(page, seriesId, meetingId);
      const suggestions = page.getByRole("region", { name: "AI suggestions" });
      await expect(suggestions.locator(`input[value="${title}"]`)).toBeVisible({
        timeout: 5_000,
      });

      const reloads: Promise<string>[] = [];
      page.on("request", (request) => {
        if (
          request.method() === "GET" &&
          new URL(request.url()).pathname ===
            `/api/meetings/${meetingId}/suggestions`
        )
          reloads.push(
            request.response().then(async (r) => (r ? await r.text() : "")),
          );
      });
      const sentinel = `Sentinel ${randomUUID()}`;
      for (const notes of [`First save ${stamp}`, sentinel]) {
        await rest(`meetings?id=eq.${meetingId}`, {
          method: "PATCH",
          body: JSON.stringify({ notes_markdown: notes }),
        });
      }
      await expect
        .poll(() => realtime.frames.some((f) => f.text.includes(sentinel)), {
          timeout: 10_000,
        })
        .toBe(true);

      const follower = `Arrives after the notes ${stamp}`;
      await seedSuggestion(seriesId, meetingId, { title: follower });
      await expect(
        suggestions.locator(`input[value="${follower}"]`),
      ).toBeVisible({ timeout: 5_000 });

      const bodies = await Promise.all(reloads);
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toContain(follower);
      await expect(
        suggestions.locator(`input[value="${title}"]`),
      ).toBeVisible();
      expect(await stillSamePage(page)).toBe(true);
    });

    test("aParticipantWhoDoesNotRunTheSeries_isNotSubscribedToReviewUpdates", async ({
      browser,
      baseURL,
    }) => {
      const { seriesId, meetingId, stamp } = await createMeeting();
      seriesToDelete.push(seriesId);
      const participant = await createMember("Pat Participant");
      membersToDelete.push(participant);
      await addParticipant(seriesId, participant.userId, "participant");
      await rest(`profiles?id=eq.${participant.userId}`, {
        method: "PATCH",
        body: JSON.stringify({ has_completed_onboarding: true }),
      });
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${participant.userId}`, {
        method: "PUT",
        headers: serviceHeaders(),
        body: JSON.stringify({
          user_metadata: { name: "Pat Participant", setup_completed: true },
        }),
      });
      await seedSuggestion(seriesId, meetingId, { title: `Hidden ${stamp}` });
      const origin = new URL(baseURL ?? "http://localhost:3000").origin;
      const context = await browser.newContext({
        baseURL: origin,
        storageState: {
          cookies: [
            {
              name: "sb-127-auth-token",
              value: participant.cookieValue,
              domain: new URL(origin).hostname,
              path: "/",
              expires: Math.floor(Date.now() / 1000) + 3600,
              httpOnly: false,
              secure: false,
              sameSite: "Lax",
            },
          ],
          origins: [],
        },
      });
      try {
        const participantPage = await context.newPage();
        const realtime = watchRealtime(participantPage, meetingId);
        await participantPage.goto(`/series/${seriesId}/meetings/${meetingId}`);
        await waitForApp(participantPage);
        await expect(
          participantPage.getByRole("heading", {
            level: 1,
            name: `Review sync session ${stamp}`,
            exact: true,
          }),
        ).toBeVisible({ timeout: 20_000 });
        await expect
          .poll(
            () =>
              realtime.frames.some(
                (f) =>
                  f.topic === `realtime:meeting:${meetingId}:changes` &&
                  f.event === "system",
              ),
            { timeout: 10_000 },
          )
          .toBe(true);

        expect(
          realtime.sentTopics.filter(
            (t) => t === `realtime:meeting:${meetingId}:ai-suggestions`,
          ),
        ).toEqual([]);
        expect(
          realtime.frames.filter(
            (f) => f.topic === `realtime:meeting:${meetingId}:ai-suggestions`,
          ),
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });

    test("aReRunOfTheList_updatesThePageWithoutReload", async ({ page }) => {
      const { seriesId, meetingId, stamp } = await createMeeting();
      seriesToDelete.push(seriesId);
      const oldTitle = `Old list item ${stamp}`;
      const newTitle = `New list item ${stamp}`;
      await seedSuggestion(seriesId, meetingId, { title: oldTitle });
      await openMeetingWithNotes(page, seriesId, meetingId);
      const suggestions = page.getByRole("region", { name: "AI suggestions" });
      await expect(
        suggestions.locator(`input[value="${oldTitle}"]`),
      ).toBeVisible({
        timeout: 5_000,
      });

      await rest(`meeting_ai_suggestions?meeting_id=eq.${meetingId}`, {
        method: "DELETE",
      });
      await seedSuggestion(seriesId, meetingId, { title: newTitle });

      await expect(
        suggestions.locator(`input[value="${newTitle}"]`),
      ).toBeVisible({
        timeout: 5_000,
      });
      await expect(
        suggestions.locator(`input[value="${oldTitle}"]`),
      ).toHaveCount(0);
      expect(await stillSamePage(page)).toBe(true);
    });

    test("aReRunThatFindsNothing_clearsTheListWithoutReload", async ({
      page,
    }) => {
      const { seriesId, meetingId, stamp } = await createMeeting();
      seriesToDelete.push(seriesId);
      const title = `Soon to vanish ${stamp}`;
      await seedSuggestion(seriesId, meetingId, { title });
      await openMeetingWithNotes(page, seriesId, meetingId);
      const suggestions = page.getByRole("region", { name: "AI suggestions" });
      await expect(suggestions.locator(`input[value="${title}"]`)).toBeVisible({
        timeout: 5_000,
      });

      await rest(`meeting_ai_suggestions?meeting_id=eq.${meetingId}`, {
        method: "DELETE",
      });
      await rest(`meetings?id=eq.${meetingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          suggestions_status: "ready",
          suggestions_status_at: new Date().toISOString(),
        }),
      });

      await expect(suggestions.locator(`input[value="${title}"]`)).toHaveCount(
        0,
        {
          timeout: 5_000,
        },
      );
      expect(await stillSamePage(page)).toBe(true);
    });

    test("aDeleteInAnotherMeeting_neverReachesThisPage", async ({ page }) => {
      const mine = await createMeeting();
      const other = await createMeeting();
      seriesToDelete.push(mine.seriesId, other.seriesId);
      await seedSuggestion(mine.seriesId, mine.meetingId, {
        title: `Mine ${mine.stamp}`,
      });
      const otherSuggestionId = await seedSuggestion(
        other.seriesId,
        other.meetingId,
        { title: `Other ${other.stamp}` },
      );
      const realtime = await openMeetingWithNotes(
        page,
        mine.seriesId,
        mine.meetingId,
      );
      const suggestions = page.getByRole("region", { name: "AI suggestions" });
      await expect(
        suggestions.locator(`input[value="Mine ${mine.stamp}"]`),
      ).toBeVisible({ timeout: 5_000 });

      await rest(`meeting_ai_suggestions?meeting_id=eq.${other.meetingId}`, {
        method: "DELETE",
      });
      const sentinel = `Sentinel ${randomUUID()}`;
      await rest(`meetings?id=eq.${mine.meetingId}`, {
        method: "PATCH",
        body: JSON.stringify({ notes_markdown: sentinel }),
      });

      await expect
        .poll(() => realtime.frames.some((f) => f.text.includes(sentinel)), {
          timeout: 10_000,
        })
        .toBe(true);
      const beforeSentinel = realtime.frames.slice(
        0,
        realtime.frames.findIndex((f) => f.text.includes(sentinel)),
      );
      expect(
        beforeSentinel.filter(
          (f) =>
            f.text.includes(other.meetingId) ||
            f.text.includes(otherSuggestionId),
        ),
      ).toEqual([]);
      await expect(
        suggestions.locator(`input[value="Mine ${mine.stamp}"]`),
      ).toBeVisible();
      expect(await stillSamePage(page)).toBe(true);
    });
  });
});
