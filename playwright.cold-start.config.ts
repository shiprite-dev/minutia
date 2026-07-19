import { defineConfig, devices } from "@playwright/test";

// Cold-start gate config. Unlike playwright.config.ts this has NO webServer block:
// it drives a genuinely cold self-host stack that is already running (public
// docker-compose.yml), so it must never spawn `pnpm dev` or seed anything. The
// wizard walk is not idempotent, so retries are off and the suite runs serially.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e/cold-start",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report-cold-start" }],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
