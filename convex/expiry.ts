import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { audit, diff, fail, getOwned, requireBusiness, requirePermission } from "./lib/access";
import { stockOut } from "./lib/stock";
import { optStr, cents } from "./lib/validate";
import { DAY_MS, daysLeft, expiryStatus } from "./shared/expiry";
import { hasPermission } from "./shared/permissions";
import { noCost } from "./products";

/** Batches with stock expiring within 90 days (or already expired), bucketed. */
async function buckets(ctx: QueryCtx, businessId: Id<"businesses">, see: boolean) {
  const now = Date.now();
  // ponytail: first 2000 batches by expiry; old zero-qty batches count against it, prune them if this ever truncates
  const batches = await ctx.db
    .query("batches")
    .withIndex("by_business_expiry", (q) => q.eq("businessId", businessId).lte("expiryDate", now + 91 * DAY_MS))
    .take(2000);
  const products = new Map<Id<"products">, Doc<"products"> | null>();
  type Entry = {
    batch: ReturnType<typeof noCost<Doc<"batches">>>;
    product: ReturnType<typeof noCost<Doc<"products">>>;
    daysLeft: number;
    valueCents: number | undefined;
  };
  const out = { expired: [] as Entry[], oneMonth: [] as Entry[], threeMonths: [] as Entry[] };
  for (const b of batches) {
    if (b.qty <= 0) continue;
    if (!products.has(b.productId)) products.set(b.productId, await ctx.db.get(b.productId));
    const product = products.get(b.productId);
    if (!product || product.businessId !== businessId || product.isArchived) continue;
    const entry = {
      batch: noCost(b, see),
      product: noCost(product, see),
      daysLeft: daysLeft(b.expiryDate, now),
      valueCents: see ? Math.round(b.qty * b.costCents) : undefined,
    };
    const s = expiryStatus(b.expiryDate, now);
    if (s === "EXPIRED") out.expired.push(entry);
    else if (s === "1_MONTH") out.oneMonth.push(entry);
    else if (s === "3_MONTHS") out.threeMonths.push(entry);
  }
  return out;
}

export const watchlist = query({
  args: {},
  handler: async (ctx) => {
    const { businessId, member } = await requireBusiness(ctx, "expiry");
    return await buckets(ctx, businessId, hasPermission(member, "seeCost"));
  },
});

export const alertCount = query({
  args: {},
  handler: async (ctx) => {
    let access;
    try {
      access = await requireBusiness(ctx, "expiry");
    } catch {
      return null; // cashier, plan without expiry, locked business...
    }
    const b = await buckets(ctx, access.businessId, false);
    return { expired: b.expired.length, oneMonth: b.oneMonth.length };
  },
});

export const writeOff = mutation({
  args: { batchId: v.id("batches"), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "expiry");
    requirePermission(member, "adjustStock");
    const b = await getOwned(ctx, businessId, a.batchId);
    const p = await getOwned(ctx, businessId, b.productId);
    if (b.qty <= 0) fail("INVALID_INPUT");
    await stockOut(ctx, member, p, b.qty, "WRITE_OFF", {
      allowNegative: true, // the batch is physically being thrown away even if the counter drifted
      batchId: b._id,
      reason: "EXPIRED",
      note: optStr(a.note, 300),
      ref: `Batch ${b.batchNo}`,
    });
    await audit(ctx, member, "expiry.writeOff", `${p.name} batch ${b.batchNo} qty=${b.qty}`);
  },
});

export const setPrice = mutation({
  args: { productId: v.id("products"), priceCents: v.number() },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "expiry");
    requirePermission(member, "editPrice");
    const p = await getOwned(ctx, businessId, a.productId);
    const price = cents(a.priceCents);
    await ctx.db.patch(p._id, { priceCents: price, updatedAt: Date.now() });
    await audit(ctx, member, "expiry.setPrice", `${p.name} ${p.priceCents}->${price}`, undefined, {
      targetId: p._id,
      targetName: p.name,
      changes: diff(p, { priceCents: price }, ["priceCents"]),
    });
  },
});
