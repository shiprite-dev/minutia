import { test, expect } from "@playwright/test";
import { publicAuthCallbackOrigin, safeAuthNextPath } from "../../src/lib/auth-callback-url";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test("auth callback uses forwarded public origin behind a reverse proxy", () => {
  const previousSiteUrl = process.env.SITE_URL;
  const previousNextPublicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.SITE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;

  try {
    const request = new Request("https://0.0.0.0:3000/auth/callback?next=/reset-password", {
      headers: {
        "x-forwarded-host": "app.example.com",
        "x-forwarded-proto": "https",
      },
    });

    expect(publicAuthCallbackOrigin(request)).toBe("https://app.example.com");
    expect(`${publicAuthCallbackOrigin(request)}${safeAuthNextPath("/reset-password")}`).toBe(
      "https://app.example.com/reset-password"
    );
    expect(safeAuthNextPath("https://evil.example/reset-password")).toBe("/");
  } finally {
    restoreEnv("SITE_URL", previousSiteUrl);
    restoreEnv("NEXT_PUBLIC_SITE_URL", previousNextPublicSiteUrl);
  }
});
