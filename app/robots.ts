import type { MetadataRoute } from "next";

const base = process.env.NEXT_PUBLIC_SITE_URL || "https://xisabsax.netlify.app";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/apps", "/platform"] }, sitemap: `${base}/sitemap.xml` };
}
