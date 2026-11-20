import { test, expect } from "@playwright/test";

test.describe("Self-host front page", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("aSignedOutVisitorOnAnInviteOnlyInstance_seesTheOpenSourcePage_andGetStartedOpensSignIn", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Stop losing track of meeting outcomes.",
      }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Get started free", exact: true }).first().click();
    await page.waitForURL(/\/login(\?.*)?$/);
    expect(new URL(page.url()).search).toBe("");
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Create an account", exact: true }),
    ).toHaveCount(0);
  });
});
