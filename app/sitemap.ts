import type { MetadataRoute } from "next";
import { NAV } from "@/lib/marketing";

const base = process.env.NEXT_PUBLIC_SITE_URL || "https://xisabsax.netlify.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", ...NAV.map((n) => n.href), "/signup"].map((p) => ({ url: base + p, changeFrequency: "monthly", priority: p === "/" ? 1 : 0.7 }));
}
