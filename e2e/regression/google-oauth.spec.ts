import { test, expect } from "@playwright/test";
import {
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_DIRECTORY_SCOPE,
  GOOGLE_IDENTITY_SCOPES,
  GOOGLE_WORKSPACE_SCOPES,
} from "../../src/lib/google-oauth-scopes";
import { googleCalendarSettingsRedirectUrl } from "../../src/lib/google-oauth-redirect";

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

test.describe("Google OAuth configuration", () => {
  test("keeps sign-in identity-only and Workspace Connect calendar plus directory scoped", () => {
    expect(GOOGLE_IDENTITY_SCOPES.split(" ").sort()).toEqual(
      ["email", "openid", "profile"]
    );
    expect(GOOGLE_IDENTITY_SCOPES).not.toContain("calendar");
    expect(GOOGLE_IDENTITY_SCOPES).not.toContain("directory");

    expect(GOOGLE_WORKSPACE_SCOPES.split(" ").sort()).toEqual(
      [GOOGLE_CALENDAR_SCOPE, GOOGLE_DIRECTORY_SCOPE, "email"].sort()
    );
  });

  test("redirects Calendar callback to public Google callback origin when site URL is unset", () => {
    const previousSiteUrl = process.env.SITE_URL;
    const previousNextPublicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const previousGoogleRedirectUri = process.env.GOOGLE_REDIRECT_URI;

    delete process.env.SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.GOOGLE_REDIRECT_URI =
      "https://app.minutia.example/api/auth/google/callback";

    try {
      expect(
        googleCalendarSettingsRedirectUrl(
          "http://internal.example.test:3000/api/auth/google/callback",
          "/settings?gcal=connected"
        ).toString()
      ).toBe("https://app.minutia.example/settings?gcal=connected");
    } finally {
      restoreEnv("SITE_URL", previousSiteUrl);
      restoreEnv("NEXT_PUBLIC_SITE_URL", previousNextPublicSiteUrl);
      restoreEnv("GOOGLE_REDIRECT_URI", previousGoogleRedirectUri);
    }
  });
});
