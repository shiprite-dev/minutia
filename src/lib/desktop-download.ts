const DESKTOP_REPO = "shiprite-dev/minutia-desktop";

export const DESKTOP_REPO_URL = `https://github.com/${DESKTOP_REPO}`;
export const DESKTOP_RELEASES_URL = `${DESKTOP_REPO_URL}/releases`;

export const DESKTOP_REQUIREMENTS =
  "Requires macOS 14.4 or later. Apple silicon and Intel.";

export type DesktopRelease =
  | { available: true; version: string; downloadUrl: string; releaseUrl: string }
  | { available: false };

type GithubRelease = {
  tag_name?: string;
  name?: string;
  html_url?: string;
  draft?: boolean;
  assets?: { name?: string; browser_download_url?: string }[];
};

// Resolves the newest published DMG from GitHub Releases at request time. The
// /releases/latest API returns 404 until the first non-draft release ships, so
// 404 is the one expected, silent degradation; every other failure is logged so
// a broken resolver cannot masquerade as "no release yet". The 5-minute cache
// bounds both release freshness and how long a transient failure can pin the
// coming-soon state.
export async function getDesktopRelease(): Promise<DesktopRelease> {
  try {
    const token = process.env.GITHUB_TOKEN;
    const res = await fetch(
      `https://api.github.com/repos/${DESKTOP_REPO}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        next: { revalidate: 300 },
      },
    );
    if (res.status === 404) return { available: false };
    if (!res.ok) {
      console.error(
        `[desktop-download] GitHub releases/latest ${res.status} (ratelimit-remaining=${res.headers.get("x-ratelimit-remaining")})`,
      );
      return { available: false };
    }

    const data = (await res.json()) as GithubRelease;
    if (data.draft) return { available: false };

    const dmg = data.assets?.find((a) =>
      a.name?.toLowerCase().endsWith(".dmg"),
    );
    if (!dmg?.browser_download_url) return { available: false };

    const version = data.tag_name ?? data.name;
    if (!version) {
      console.error("[desktop-download] release has a DMG but no tag or name");
      return { available: false };
    }

    return {
      available: true,
      version,
      downloadUrl: dmg.browser_download_url,
      releaseUrl: data.html_url ?? DESKTOP_RELEASES_URL,
    };
  } catch (err) {
    console.error("[desktop-download] resolver threw", err);
    return { available: false };
  }
}
