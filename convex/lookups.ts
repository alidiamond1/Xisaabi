// External barcode lookup (Open Food Facts family). Network happens ONLY here, in an action.
// Open Food Facts data is ODbL: we keep `source`, hotlink the thumbnail (no image copying) and expose no bulk export.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { fail } from "./lib/access";
import { NOT_FOUND_RETRY_MS, publicEntry, requireAnyApp } from "./lib/catalog";
import { limiter } from "./lib/limiter";
import { isInternal, normalizeGtin } from "./shared/barcode";

const TIMEOUT_MS = 5000;
const USER_AGENT = "Xisaabi/1.0 (calinuurcabdulle11@gmail.com)"; // contact for Open Food Facts; change when a support address exists
const HOSTS = [
  { host: "world.openfoodfacts.org", source: "OPEN_FOOD_FACTS" as const },
  { host: "world.openbeautyfacts.org", source: "OTHER" as const },
  { host: "world.openproductsfacts.org", source: "OTHER" as const },
];
const FIELDS = "product_name,brands,quantity,categories_tags,image_front_small_url";

type Found = { name: string; brand: string; size: string; categoryHint: string; imageUrl?: string; source: "OPEN_FOOD_FACTS" | "OTHER" };

/** Access check + cache read in one transaction (runQuery forwards the caller's auth). */
export const prepare = internalQuery({
  args: { barcode: v.string() },
  handler: async (ctx, { barcode }) => {
    const { businessId } = await requireAnyApp(ctx, ["inventory", "pos", "purchases"]);
    const row = await ctx.db.query("catalog").withIndex("by_barcode", (q) => q.eq("barcode", barcode)).unique();
    const stale = row?.status === "NOT_FOUND" && row.fetchedAt + NOT_FOUND_RETRY_MS < Date.now();
    return {
      businessId,
      cached: !row || stale ? null : { notFound: row.status === "NOT_FOUND" || row.status === "HIDDEN", entry: await publicEntry(ctx, row) },
    };
  },
});

/** Store a lookup result (or a NOT_FOUND negative cache) and return the public shape. Never overwrites a real row. */
export const store = internalMutation({
  args: {
    barcode: v.string(),
    found: v.union(
      v.null(),
      v.object({
        name: v.string(), brand: v.string(), size: v.string(), categoryHint: v.string(),
        imageUrl: v.optional(v.string()), source: v.union(v.literal("OPEN_FOOD_FACTS"), v.literal("OTHER")),
      }),
    ),
  },
  handler: async (ctx, { barcode, found }) => {
    const row = await ctx.db.query("catalog").withIndex("by_barcode", (q) => q.eq("barcode", barcode)).unique();
    if (row && row.status !== "NOT_FOUND") return row.status === "HIDDEN" ? null : await publicEntry(ctx, row);
    const now = Date.now();
    const doc = found
      ? { ...found, barcode, status: "PENDING" as const, confirmCount: 0, flagCount: 0, fetchedAt: now }
      : { barcode, status: "NOT_FOUND" as const, name: "", brand: "", size: "", categoryHint: "", source: "OTHER" as const, confirmCount: 0, flagCount: 0, fetchedAt: now };
    const id = row ? (await ctx.db.replace(row._id, doc), row._id) : await ctx.db.insert("catalog", doc);
    const saved = (await ctx.db.get(id))!;
    return found ? await publicEntry(ctx, saved) : null;
  },
});

const IMAGE_HOST = /^https:\/\/images\.open(food|beauty|products)facts\.org\//;
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");

function parse(json: unknown, source: Found["source"]): Found | null {
  const j = json as { status?: number; product?: Record<string, unknown> } | null;
  const p = j?.product;
  if (!p || j?.status === 0) return null;
  const name = clip(p.product_name, 120);
  if (!name) return null;
  const tag = Array.isArray(p.categories_tags) && typeof p.categories_tags[0] === "string" ? (p.categories_tags[0] as string) : "";
  const img = clip(p.image_front_small_url, 500);
  return {
    name,
    brand: clip(p.brands, 80).split(",")[0].trim(),
    size: clip(p.quantity, 40),
    categoryHint: tag.replace(/^[a-z]{2}:/, "").replace(/-/g, " ").slice(0, 80),
    imageUrl: IMAGE_HOST.test(img) ? img : undefined, // every shop's browser hotlinks it: Open *Facts image hosts only
    source,
  };
}

export const remote = action({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<Awaited<ReturnType<typeof publicEntry>> | null> => {
    const barcode = normalizeGtin(code.slice(0, 64));
    const { businessId, cached } = await ctx.runQuery(internal.lookups.prepare, { barcode: barcode ?? "" });
    if (!barcode || isInternal(barcode)) return null;
    if (cached) return cached.notFound ? null : cached.entry;

    const biz = String(businessId);
    if (!(await limiter.limit(ctx, "lookupMinute", { key: biz })).ok) fail("RATE_LIMITED");
    if (!(await limiter.limit(ctx, "lookupDay", { key: biz })).ok) fail("RATE_LIMITED");
    if (!(await limiter.limit(ctx, "offGlobal")).ok) return null; // shared upstream budget used up: try later

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let found: Found | null = null;
    let failed = false;
    try {
      for (const { host, source } of HOSTS) {
        try {
          const res = await fetch(`https://${host}/api/v2/product/${barcode}.json?fields=${FIELDS}`, {
            headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
            signal: ctl.signal,
          });
          if (res.status === 404) continue;
          if (!res.ok) { failed = true; continue; }
          found = parse(await res.json(), source);
          if (found) break;
        } catch {
          failed = true;
          if (ctl.signal.aborted) break;
        }
      }
    } finally {
      clearTimeout(timer);
    }
    // a network failure is not a "not found": don't negative-cache it
    if (!found && failed) return null;
    return await ctx.runMutation(internal.lookups.store, { barcode, found });
  },
});
