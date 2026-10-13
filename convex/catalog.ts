// Global shared barcode catalog. Clients only ever see name/brand/size/category/image/source/status:
// never contributions, business ids or prices.
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { audit, fail, requirePlatform } from "./lib/access";
import { NOT_FOUND_RETRY_MS, publicEntry, requireAnyApp, resolveLocal } from "./lib/catalog";
import { optStr, str } from "./lib/validate";
import { isInternal, normalizeGtin } from "./shared/barcode";
import { hasPermission } from "./shared/permissions";

const status = v.union(v.literal("PENDING"), v.literal("VERIFIED"), v.literal("HIDDEN"), v.literal("NOT_FOUND"));
const FLAGS_TO_HIDE = 3;

/**
 * Local product first, then the shared catalog. `now` (optional, pass a coarse timestamp) lets
 * a NOT_FOUND row older than 30 days count as needing a remote retry; lookups.remote re-checks it anyway.
 */
export const lookup = query({
  args: { code: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, { code, now }) => {
    const { businessId, member } = await requireAnyApp(ctx, ["inventory", "pos", "purchases"]);
    const raw = str(code, 128);
    const found = await resolveLocal(ctx, businessId, raw);
    let local = null;
    if (found) {
      const { costCents: _c, ...rest } = found.product;
      const product: Omit<Doc<"products">, "costCents"> & { costCents?: number } = hasPermission(member, "seeCost") ? found.product : rest;
      local = { product, unit: found.unit };
    }
    const gtin = normalizeGtin(raw);
    if (!gtin) return { local, catalog: null, needsRemote: false };
    const row = await ctx.db.query("catalog").withIndex("by_barcode", (q) => q.eq("barcode", gtin)).unique();
    const needsRemote =
      !isInternal(gtin) && (!row || (row.status === "NOT_FOUND" && now !== undefined && row.fetchedAt + NOT_FOUND_RETRY_MS < now));
    const visible = row && row.status !== "NOT_FOUND" && row.status !== "HIDDEN" ? row : null;
    return { local, catalog: visible ? await publicEntry(ctx, visible) : null, needsRemote };
  },
});

/** Report a wrong/abusive entry. Once per business; hidden at 3 distinct businesses. */
export const flag = mutation({
  args: { barcode: v.string() },
  handler: async (ctx, { barcode }) => {
    const { businessId } = await requireAnyApp(ctx, ["inventory", "pos", "purchases"]);
    const code = normalizeGtin(str(barcode, 64));
    if (!code) fail("INVALID_INPUT");
    const row = await ctx.db.query("catalog").withIndex("by_barcode", (q) => q.eq("barcode", code)).unique();
    if (!row) fail("NOT_FOUND");
    const dup = await ctx.db
      .query("catalogFlags")
      .withIndex("by_barcode_and_business", (q) => q.eq("barcode", code).eq("businessId", businessId))
      .unique();
    if (dup) return { flagCount: row.flagCount };
    await ctx.db.insert("catalogFlags", { barcode: code, businessId });
    const flagCount = row.flagCount + 1;
    await ctx.db.patch(row._id, { flagCount, ...(flagCount >= FLAGS_TO_HIDE ? { status: "HIDDEN" as const } : {}) });
    return { flagCount };
  },
});

/** Platform moderation list (no contributor info). */
export const adminList = query({
  args: { status: v.optional(status) },
  handler: async (ctx, { status: st }) => {
    await requirePlatform(ctx);
    const rows = st
      ? await ctx.db.query("catalog").withIndex("by_status", (q) => q.eq("status", st)).order("desc").take(200)
      : await ctx.db.query("catalog").order("desc").take(200);
    return rows.map((r) => ({
      barcode: r.barcode, status: r.status, name: r.name, brand: r.brand, size: r.size, categoryHint: r.categoryHint,
      imageUrl: r.imageUrl, source: r.source, confirmCount: r.confirmCount, flagCount: r.flagCount, fetchedAt: r.fetchedAt,
    }));
  },
});

export const adminSet = mutation({
  args: {
    barcode: v.string(), status,
    name: v.optional(v.string()), brand: v.optional(v.string()), size: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const member = await requirePlatform(ctx, ["SUPER_ADMIN"]);
    const code = normalizeGtin(str(a.barcode, 64));
    if (!code) fail("INVALID_INPUT");
    const row = await ctx.db.query("catalog").withIndex("by_barcode", (q) => q.eq("barcode", code)).unique();
    if (!row) fail("NOT_FOUND");
    await ctx.db.patch(row._id, {
      status: a.status,
      locked: true,
      ...(a.name !== undefined ? { name: str(a.name, 120) } : {}),
      ...(a.brand !== undefined ? { brand: optStr(a.brand, 80) ?? "" } : {}),
      ...(a.size !== undefined ? { size: optStr(a.size, 40) ?? "" } : {}),
      ...(a.status === "VERIFIED" || a.status === "PENDING" ? { flagCount: 0 } : {}),
    });
    await audit(ctx, member, "catalog.adminSet", `${code} -> ${a.status}`);
  },
});
