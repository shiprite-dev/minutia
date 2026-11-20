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

  test("twoKeepsAtTheSameMoment_createOneBoardItem", async ({ request }) => {
    const { seriesId, meetingId, stamp } = await createMeeting();
    seriesToDelete.push(seriesId);
    const title = `Send the vendor contract ${stamp}`;
    const suggestionId = await seedSuggestion(seriesId, meetingId, { title });

    const responses = await Promise.all([
      request.patch(reviewUrl(meetingId, suggestionId), {
        data: { action: "accept" },
      }),
      request.patch(reviewUrl(meetingId, suggestionId), {
        data: { action: "accept" },
      }),
    ]);
    const results = await Promise.all(
      responses.map(async (r) => ({
        status: r.status(),
        body: await r.json(),
      })),
    );
    const outcomes = results.map((r) => `${r.status} ${r.body.code}`).sort();

    expect(outcomes).toEqual(["200 saved", "409 already_reviewed"]);
    const refused = results.find((r) => r.status === 409)!;
    expect(refused.body.error).toBe("AI suggestion has already been reviewed.");
    expect((await seriesIssues(seriesId)).map((i) => i.title)).toEqual([title]);
    expect(await suggestionStatus(suggestionId)).toBe("accepted");
  });

  test("keepingAnItemNamedForASeriesMember_assignsThemOnTheBoard", async ({
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

    expect(response.ok).toBe(false);
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
    expect((await response.json()).code).toBe("23502");
    expect(await seriesIssues(seriesId)).toEqual([]);
    expect(await suggestionStatus(suggestionId)).toBe("pending");
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
    async function openMeetingWithNotes(
      page: Page,
      seriesId: string,
      meetingId: string,
    ) {
      await rest(`meetings?id=eq.${meetingId}`, {
        method: "PATCH",
        body: JSON.stringify({ notes_markdown: "Notes from the call" }),
      });
      await page.goto(`/series/${seriesId}/meetings/${meetingId}`);
      await waitForApp(page);
      await page.evaluate(() => {
        (
          window as unknown as { openedBeforeReview: boolean }
        ).openedBeforeReview = true;
      });
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
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible({
        timeout: 5_000,
      });
      expect(await stillSamePage(page)).toBe(true);
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
        body: JSON.stringify({ suggestions_status: "ready" }),
      });

      await expect(suggestions.locator(`input[value="${title}"]`)).toHaveCount(
        0,
        {
          timeout: 5_000,
        },
      );
      expect(await stillSamePage(page)).toBe(true);
    });

    test("aDeleteInAnotherMeeting_doesNotRefreshThisPage", async ({ page }) => {
      const mine = await createMeeting();
      const other = await createMeeting();
      seriesToDelete.push(mine.seriesId, other.seriesId);
      await seedSuggestion(mine.seriesId, mine.meetingId, {
        title: `Mine ${mine.stamp}`,
      });
      await seedSuggestion(other.seriesId, other.meetingId, {
        title: `Other ${other.stamp}`,
      });
      await openMeetingWithNotes(page, mine.seriesId, mine.meetingId);
      const suggestions = page.getByRole("region", { name: "AI suggestions" });
      await expect(
        suggestions.locator(`input[value="Mine ${mine.stamp}"]`),
      ).toBeVisible({ timeout: 5_000 });

      const refetches: string[] = [];
      page.on("request", (request) => {
        if (
          request.method() === "GET" &&
          request.url().includes(`/api/meetings/${mine.meetingId}/suggestions`)
        )
          refetches.push(request.url());
      });
      await expect
        .poll(
          async () => {
            const before = refetches.length;
            await page.waitForTimeout(4_000);
            return refetches.length === before;
          },
          { timeout: 30_000 },
        )
        .toBe(true);
      const settled = refetches.length;

      await rest(`meeting_ai_suggestions?meeting_id=eq.${other.meetingId}`, {
        method: "DELETE",
      });
      await page.waitForTimeout(3_000);

      expect(refetches.length).toBe(settled);
      await expect(
        suggestions.locator(`input[value="Mine ${mine.stamp}"]`),
      ).toBeVisible();
    });
  });
});
