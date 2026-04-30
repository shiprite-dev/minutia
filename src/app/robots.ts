import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.SITE_URL || "https://minutia.app";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/settings", "/inbox", "/actions"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
