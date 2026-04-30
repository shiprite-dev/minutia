import type { Page } from "@playwright/test";

export const SERIES = {
  platformStandup: "10000000-0000-0000-0000-000000000001",
  productReview: "10000000-0000-0000-0000-000000000002",
  incidentRetro: "10000000-0000-0000-0000-000000000003",
};

export const MEETINGS = {
  standup1: "20000000-0000-0000-0000-000000000001",
  standup2: "20000000-0000-0000-0000-000000000002",
  standup3: "20000000-0000-0000-0000-000000000003",
  standup4: "20000000-0000-0000-0000-000000000004",
  productKickoff: "20000000-0000-0000-0000-000000000010",
  productSprint1: "20000000-0000-0000-0000-000000000011",
  retro: "20000000-0000-0000-0000-000000000020",
};

export const ISSUES = {
  migrateCI: "30000000-0000-0000-0000-000000000001",
  stagingMonitoring: "30000000-0000-0000-0000-000000000002",
  userResearch: "30000000-0000-0000-0000-000000000003",
  evalK8s: "30000000-0000-0000-0000-000000000004",
  flakyTests: "30000000-0000-0000-0000-000000000005",
  rateLimiting: "30000000-0000-0000-0000-000000000006",
  dbPool: "30000000-0000-0000-0000-000000000007",
  sslCert: "30000000-0000-0000-0000-000000000008",
  headcount: "30000000-0000-0000-0000-000000000009",
  graphql: "30000000-0000-0000-0000-000000000010",
};

export const SHARE_TOKENS = {
  meeting: "test-share-meeting-abc123",
  series: "test-share-series-def456",
  issue: "test-share-issue-ghi789",
  expired: "test-share-expired-xyz000",
};

export async function waitForApp(page: Page) {
  await page.waitForLoadState("networkidle");
}
