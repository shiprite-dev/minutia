import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.SITE_URL || "https://getminutia.com";

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
