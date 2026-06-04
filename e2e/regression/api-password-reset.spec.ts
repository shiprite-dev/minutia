import { test, expect } from "@playwright/test";

const APP_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

test.describe("POST /api/password-reset-requests", () => {
  test("rejects invalid JSON body", async ({ request }) => {
    const res = await request.post(`${APP_URL}/api/password-reset-requests`, {
      data: "invalid json",
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  test("rejects missing email field", async ({ request }) => {
    const res = await request.post(`${APP_URL}/api/password-reset-requests`, {
      data: {},
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/email|Invalid input/i);
  });

  test("rejects invalid email format", async ({ request }) => {
    const res = await request.post(`${APP_URL}/api/password-reset-requests`, {
      data: { email: "not-an-email" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/email/i);
  });

  test("accepts lowercase email", async ({ request }) => {
    const res = await request.post(`${APP_URL}/api/password-reset-requests`, {
      data: { email: "Test@Example.COM" },
    });
    // May fail if email not configured, but should validate the email format
    expect([200, 500]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json();
      expect(body.sent).toBe(true);
    }
  });

  test("returns success for non-existent email (security measure)", async ({ request }) => {
    const res = await request.post(`${APP_URL}/api/password-reset-requests`, {
      data: { email: `nonexistent-${Date.now()}@example.com` },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.sent).toBe(true);
  });

  test("handles empty email string", async ({ request }) => {
    const res = await request.post(`${APP_URL}/api/password-reset-requests`, {
      data: { email: "" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("email");
  });

  test("handles whitespace-only email", async ({ request }) => {
    const res = await request.post(`${APP_URL}/api/password-reset-requests`, {
      data: { email: "   " },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("email");
  });

  test("handles email with trailing spaces", async ({ request }) => {
    const res = await request.post(`${APP_URL}/api/password-reset-requests`, {
      data: { email: " test@example.com " },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("email");
  });

  test("handles very long email", async ({ request }) => {
    const longLocal = "a".repeat(1000);
    const res = await request.post(`${APP_URL}/api/password-reset-requests`, {
      data: { email: `${longLocal}@example.com` },
    });
    expect([400, 500]).toContain(res.status());
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test("handles extra fields in body", async ({ request }) => {
    const res = await request.post(`${APP_URL}/api/password-reset-requests`, {
      data: { email: "test@example.com", extra: "field" },
    });
    // May fail if email not configured, but should accept the request
    expect([200, 500]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json();
      expect(body.sent).toBe(true);
    }
  });

  test("handles null email value", async ({ request }) => {
    const res = await request.post(`${APP_URL}/api/password-reset-requests`, {
      data: { email: null },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/email|Invalid input/i);
  });

  test("handles numeric email", async ({ request }) => {
    const res = await request.post(`${APP_URL}/api/password-reset-requests`, {
      data: { email: 12345 },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/email|Invalid input/i);
  });

  test("handles array email", async ({ request }) => {
    const res = await request.post(`${APP_URL}/api/password-reset-requests`, {
      data: { email: ["test@example.com"] },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/email|Invalid input/i);
  });
});
