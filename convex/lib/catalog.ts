// Shared barcode-catalog helpers. The `catalog` table is GLOBAL (not tenant data):
// never return catalogContributions, business ids, prices or anything per-shop from it.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isInternal, normalizeGtin } from "../shared/barcode";
import type { AppKey } from "../shared/modules";
import { requireBusiness, type BusinessAccess } from "./access";

export const VERIFY_SHOPS = 3; // distinct shops needed to verify a community entry
const MIN_SHOP_AGE_MS = 7 * 86_400_000;
export const NOT_FOUND_RETRY_MS = 30 * 86_400_000;

/** Lowercase, collapse whitespace — used to compare names across shops. */
export function normName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Names with URLs, phone-number-like digit runs (>= 7 digits) or currency amounts are not shared. */
export function isSpammy(s: string): boolean {
  if (/https?:|www\.|\b[\w-]+\.(com|net|org|so|info|biz|me|io)\b/i.test(s)) return true;
  if (/[$€£]\s?\d|\d\s?[$€£]|\b(usd|ssh?|shs|sos|kes|etb|dollars?)\.?\s*\d|\d\s*(usd|ssh?|shs|sos|kes|etb|dollars?)\b/i.test(s)) return true;
  // digit runs, allowing single separators inside a phone-like number ("+252 61 555 1234")
  for (const m of s.matchAll(/\+?\d(?:[\s().-]?\d)+/g)) {
    if (m[0].replace(/\D/g, "").length >= 7) return true;
  }
  return false;
}

/** Caller must be an active member who can open at least one of `apps`; throws the first access error otherwise. */
export async function requireAnyApp(ctx: QueryCtx | MutationCtx, apps: AppKey[]): Promise<BusinessAccess> {
  let first: unknown;
  for (const app of apps) {
    try {
      return await requireBusiness(ctx, app);
    } catch (e) {
      first ??= e;
    }
  }
  throw first;
}

/** Public shape of a catalog row — the only thing clients ever see of it. */
export async function publicEntry(ctx: QueryCtx | MutationCtx, row: Doc<"catalog">) {
  return {
    name: row.name,
    brand: row.brand,
    size: row.size,
    categoryHint: row.categoryHint,
    imageUrl: row.imageUrl ?? (row.imageId ? await ctx.storage.getUrl(row.imageId) ?? undefined : undefined),
    confirmCount: row.confirmCount,
    source: row.source,
    status: row.status,
  };
}

type Contribution = {
  barcode: string; name: string; brand: string; size: string; categoryHint: string; imageId?: Id<"_storage">;
};

/**
 * Record that this business uses `barcode` with this name, then recompute the shared row.
 * Silent no-op (never throws) for opted-out shops, internal/invalid barcodes and spammy text.
 */
export async function contribute(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  p: { barcode: string; name: string; brand: string; size: string; categoryHint: string; imageId?: Id<"_storage"> },
): Promise<void> {
  const business = await ctx.db.get(businessId);
  if (!business || business.settings.shareToCatalog === false) return;
  const barcode = normalizeGtin(p.barcode);
  if (!barcode || isInternal(barcode)) return;
  const c: Contribution = {
    barcode,
    name: p.name.trim().replace(/\s+/g, " "),
    brand: p.brand.trim().slice(0, 80),
    size: p.size.trim().slice(0, 40),
    categoryHint: p.categoryHint.trim().slice(0, 80),
    imageId: p.imageId,
  };
  if (!c.name || c.name.length > 120) return;
  if ([c.name, c.brand, c.size, c.categoryHint].some(isSpammy)) return;

  // one contribution per (barcode, business)
  const mine = await ctx.db
    .query("catalogContributions")
    .withIndex("by_barcode_and_business", (q) => q.eq("barcode", barcode).eq("businessId", businessId))
    .unique();
  const now = Date.now();
  if (mine) await ctx.db.patch(mine._id, { name: c.name, brand: c.brand, size: c.size });
  else await ctx.db.insert("catalogContributions", { barcode, businessId, name: c.name, brand: c.brand, size: c.size, createdAt: now });

  // recompute: most-confirmed normalized name wins (ties: earliest group)
  // ponytail: reads at most 200 contributions per barcode; popular barcodes need an incremental counter
  const raw = await ctx.db.query("catalogContributions").withIndex("by_barcode", (q) => q.eq("barcode", barcode)).take(200);
  // brand-new shops can save their own product but don't count toward the shared row (anti-sybil)
  const all: typeof raw = [];
  for (const r of raw) {
    const b = r.businessId === businessId ? business : await ctx.db.get(r.businessId);
    if (b && b.createdAt <= now - MIN_SHOP_AGE_MS) all.push(r);
  }
  const groups = new Map<string, { count: number; latest: Doc<"catalogContributions"> }>();
  for (const r of all) {
    const k = normName(r.name);
    const g = groups.get(k);
    if (!g) groups.set(k, { count: 1, latest: r });
    else {
      g.count++;
      if (r.createdAt >= g.latest.createdAt) g.latest = r;
    }
  }
  let best: { count: number; latest: Doc<"catalogContributions"> } | undefined;
  for (const g of groups.values()) if (!best || g.count > best.count) best = g;
  if (!best) return;
  const status = best.count >= VERIFY_SHOPS ? ("VERIFIED" as const) : ("PENDING" as const);

  const row = await ctx.db.query("catalog").withIndex("by_barcode", (q) => q.eq("barcode", barcode)).unique();
  // categoryHint is not stored per contribution: keep the row's, else this contributor's
  const fields = { name: best.latest.name, brand: best.latest.brand, size: best.latest.size, confirmCount: best.count };
  if (!row) {
    await ctx.db.insert("catalog", {
      barcode, ...fields, status, categoryHint: c.categoryHint, imageId: c.imageId,
      source: "COMMUNITY", flagCount: 0, fetchedAt: now,
    });
    return;
  }
  if (row.locked) {
    await ctx.db.patch(row._id, { confirmCount: best.count });
    return;
  }
  // an Open Food Facts row is only replaced once the community agrees (>= VERIFY_SHOPS shops)
  if (row.source === "OPEN_FOOD_FACTS" && row.status !== "NOT_FOUND" && best.count < VERIFY_SHOPS) return;
  await ctx.db.patch(row._id, {
    ...fields,
    status: row.status === "HIDDEN" ? "HIDDEN" : status,
    source: "COMMUNITY",
    categoryHint: row.categoryHint || c.categoryHint,
    imageId: row.imageId ?? c.imageId,
    fetchedAt: now,
  });
}

/** Find a product of this business by barcode, extra barcode, unit barcode or SKU. */
export async function resolveLocal(
  ctx: QueryCtx | MutationCtx,
  businessId: Id<"businesses">,
  code: string,
): Promise<{ product: Doc<"products">; unit?: NonNullable<Doc<"products">["units"]>[number] } | null> {
  const c = code.trim();
  if (!c) return null;
  const pick = (rows: Doc<"products">[]) => rows.find((r) => !r.isArchived) ?? rows[0];
  const variants = [c];
  const g = normalizeGtin(c);
  if (g && g !== c) variants.push(g);
  if (g?.length === 13 && g[0] === "0") variants.push(g.slice(1)); // UPC-A form
  for (const b of variants) {
    const hit = pick(
      await ctx.db.query("products").withIndex("by_business_barcode", (q) => q.eq("businessId", businessId).eq("barcode", b)).take(5),
    );
    if (hit) return { product: hit };
  }
  const sku = pick(
    await ctx.db.query("products").withIndex("by_business_sku", (q) => q.eq("businessId", businessId).eq("sku", c)).take(5),
  );
  if (sku) return { product: sku };
  // extraBarcodes / units[].barcode have no index.
  // ponytail: scans the first 3000 live products; add a barcode-alias table if a shop outgrows this
  const live = await ctx.db.query("products").withIndex("by_business", (q) => q.eq("businessId", businessId).eq("isArchived", false)).take(3000);
  for (const p of live) {
    if (variants.some((b) => p.extraBarcodes.includes(b))) return { product: p };
    const unit = p.units?.find((u) => u.barcode && variants.includes(u.barcode));
    if (unit) return { product: p, unit };
  }
  return null;
}
