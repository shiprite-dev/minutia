import { test, expect } from "@playwright/test";
import {
  GoogleDirectoryPermissionError,
  normalizeWorkspaceDirectoryPeople,
  searchWorkspaceDirectory,
} from "../../src/lib/google-workspace-directory";

test.describe("Google Workspace Directory", () => {
  test("normalizes People API profiles into assignee options", () => {
    expect(
      normalizeWorkspaceDirectoryPeople([
        {
          resourceName: "people/c123",
          names: [{ displayName: "Mina Director" }],
          emailAddresses: [{ value: "mina@example.com" }],
          photos: [{ url: "https://example.com/mina.png" }],
          organizations: [{ name: "Product" }],
        },
        {
          resourceName: "people/no-email",
          names: [{ displayName: "No Email" }],
        },
      ])
    ).toEqual([
      {
        resourceName: "people/c123",
        name: "Mina Director",
        email: "mina@example.com",
        photoUrl: "https://example.com/mina.png",
        organization: "Product",
      },
    ]);
  });

  test("searches directory people with domain profile and contact sources", async () => {
    const originalFetch = global.fetch;
    const calls: string[] = [];

    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return new Response(
        JSON.stringify({
          people: [
            {
              resourceName: "people/c123",
              names: [{ displayName: "Mina Director" }],
              emailAddresses: [{ value: "mina@example.com" }],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      const results = await searchWorkspaceDirectory("token", "mina", 7);
      const url = new URL(calls[0]);

      expect(url.origin + url.pathname).toBe(
        "https://people.googleapis.com/v1/people:searchDirectoryPeople"
      );
      expect(url.searchParams.get("query")).toBe("mina");
      expect(url.searchParams.get("pageSize")).toBe("7");
      expect(url.searchParams.get("readMask")).toBe(
        "names,emailAddresses,photos,organizations"
      );
      expect(url.searchParams.getAll("sources")).toEqual([
        "DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE",
        "DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT",
      ]);
      expect(results).toEqual([
        {
          resourceName: "people/c123",
          name: "Mina Director",
          email: "mina@example.com",
          photoUrl: undefined,
          organization: undefined,
        },
      ]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("turns Google permission failures into a typed directory error", async () => {
    const originalFetch = global.fetch;

    global.fetch = (async () => new Response("forbidden", { status: 403 })) as typeof fetch;

    try {
      await expect(searchWorkspaceDirectory("token", "mina")).rejects.toBeInstanceOf(
        GoogleDirectoryPermissionError
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});
