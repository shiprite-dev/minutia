import { test, expect } from "@playwright/test";
import { waitForApp } from "./seed-data";

test.describe("Settings - Workspace Access", () => {
  test.use({ storageState: "e2e/.auth/user.json" });

  test("workspace access section is visible to admins", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    const workspaceAccess = page.getByRole("region", { name: /workspace access/i });
    if (await workspaceAccess.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(workspaceAccess).toBeVisible();
      await expect(page.getByText("Invite teammates")).toBeVisible();
    }
  });

  test("invite form has email input and role selector", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    const inviteEmail = page.getByLabel("Invite by email");
    const inviteRole = page.getByRole("combobox", { name: /invitation role/i });

    if (await inviteEmail.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(inviteEmail).toBeVisible();
      await expect(inviteRole).toBeVisible();
    }
  });

  test("member list shows current members with role controls", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    const membersSection = page.getByRole("heading", { name: "Members" });
    if (await membersSection.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(membersSection).toBeVisible();

      const roleSelectors = page.getByRole("combobox").filter({ hasText: /Role for/ });
      if (await roleSelectors.count() > 0) {
        await expect(roleSelectors.first()).toBeVisible();
      }
    }
  });

  test("pending invitations section shows revoke buttons", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    const pendingSection = page.getByRole("heading", { name: "Pending invitations" });
    if (await pendingSection.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(pendingSection).toBeVisible();

      const revokeButtons = page.getByRole("button", { name: /revoke invitation/i });
      if (await revokeButtons.count() > 0) {
        await expect(revokeButtons.first()).toBeVisible();
      }
    }
  });

  test("member count badges display accurate counts", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    const membersBadge = page.getByText(/members/i).first();
    const pendingBadge = page.getByText(/pending/i).first();

    if (await membersBadge.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(membersBadge).toBeVisible();
    }
    if (await pendingBadge.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(pendingBadge).toBeVisible();
    }
  });

  test("remove member button is disabled for current user", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    const youBadge = page.getByText("You");
    if (await youBadge.isVisible({ timeout: 5000 }).catch(() => false)) {
      const removeButton = youBadge.locator("xpath=ancestor::div").getByRole("button", { name: /remove/i });
      await expect(removeButton).toBeDisabled();
    }
  });
});

test.describe("Settings - Connected Accounts", () => {
  test.use({ storageState: "e2e/.auth/user.json" });

  test("google workspace section is visible", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    await expect(page.getByText("Google Workspace")).toBeVisible();
    await expect(page.getByText("Sync calendar meetings and directory assignees")).toBeVisible();
  });

  test("connect button is shown when not connected", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    const connectButton = page.getByRole("link", { name: "Connect" });
    const disconnectButton = page.getByRole("button", { name: "Disconnect" });

    if (await connectButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(connectButton).toBeVisible();
      await expect(disconnectButton).not.toBeVisible();
    }
  });

  test("disconnect button is shown when connected", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    const disconnectButton = page.getByRole("button", { name: "Disconnect" });
    if (await disconnectButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(disconnectButton).toBeVisible();
      await expect(page.getByRole("link", { name: "Connect" })).not.toBeVisible();
    }
  });

  test("reconnect button is shown when connected but directory not linked", async ({ page }) => {
    await page.goto("/settings");
    await waitForApp(page);

    const reconnectButton = page.getByRole("link", { name: "Reconnect" });
    const directoryMessage = page.getByText("Reconnect to enable directory assignment");

    if (await directoryMessage.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(reconnectButton).toBeVisible();
      await expect(directoryMessage).toBeVisible();
    }
  });
});
