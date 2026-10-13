import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { audit, fail, getOwned, requireBusiness, requirePermission } from "./lib/access";
import { roundQty, stockIn, stockOut } from "./lib/stock";
import { optStr, ts } from "./lib/validate";
import { hasPermission } from "./shared/permissions";
import { movementType } from "./schema";
import { noCost, qtyOf } from "./products";

const batchArg = v.object({ batchNo: v.string(), expiryDate: v.number() });
type BatchArg = { batchNo: string; expiryDate: number };
const CAP = 5000; // ponytail: product scans capped at 5000; paginate if a shop outgrows it

/** Stock that can be taken by FEFO without touching expired batches. */
async function sellableQty(ctx: QueryCtx, p: Doc<"products">) {
  if (!p.trackExpiry) return p.stock;
  const now = Date.now();
  const bs = await ctx.db.query("batches").withIndex("by_product_expiry", (q) => q.eq("productId", p._id).gt("expiryDate", now)).take(500);
  return bs.reduce((s, b) => s + b.qty, 0);
}

const toBatch = (b?: BatchArg) => b && { batchNo: optStr(b.batchNo, 60) ?? "ADJ", expiryDate: ts(b.expiryDate) };

/** Apply a signed change (+ in, - out) through stockIn / stockOut. */
async function change(
  ctx: Parameters<typeof stockIn>[0], member: Doc<"members">, p: Doc<"products">, delta: number,
  type: "ADJUSTMENT" | "STOCKTAKE", o: { reason: string; note?: string; ref: string; batch?: BatchArg },
) {
  if (p.trackSerial) fail("INVALID_INPUT"); // serial products: stock moves only with serials (purchase / sale / serials.writeOff)
  if (delta > 0) {
    await stockIn(ctx, member, p, delta, type, { ...o, batch: toBatch(o.batch) });
  } else {
    // expired batches are never consumed here (use expiry.writeOff for those)
    if (p.trackExpiry && (await sellableQty(ctx, p)) < -delta) fail("INSUFFICIENT_STOCK");
    await stockOut(ctx, member, p, -delta, type, { ...o, allowNegative: false });
  }
}

export const adjust = mutation({
  args: {
    productId: v.id("products"),
    delta: v.number(),
    reason: v.union(
      v.literal("DAMAGED"), v.literal("EXPIRED"), v.literal("LOST"), v.literal("FOUND"),
      v.literal("CORRECTION"), v.literal("OWN_USE"), v.literal("OTHER"),
    ),
    note: v.optional(v.string()),
    batch: v.optional(batchArg),
  },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "inventory");
    requirePermission(member, "adjustStock");
    const p = await getOwned(ctx, businessId, a.productId);
    if (p.type !== "STOCKABLE" || p.hasVariants || p.isArchived) fail("INVALID_INPUT");
    if (!Number.isFinite(a.delta) || a.delta === 0) fail("INVALID_INPUT");
    const delta = a.delta > 0 ? qtyOf(a.delta, p.allowDecimal) : -qtyOf(-a.delta, p.allowDecimal);
    const note = optStr(a.note, 300);
    await change(ctx, member, p, delta, "ADJUSTMENT", { reason: a.reason, note, ref: "Adjustment", batch: a.batch });
    await audit(ctx, member, "inventory.adjust", `${p.name} ${delta > 0 ? "+" : ""}${delta} (${a.reason})`);
  },
});

export const movements = query({
  args: { productId: v.optional(v.id("products")), type: v.optional(movementType), from: v.number(), to: v.number() },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "inventory");
    const from = ts(a.from), to = ts(a.to);
    let q;
    if (a.productId) {
      const p = await getOwned(ctx, businessId, a.productId);
      q = ctx.db.query("stockMovements").withIndex("by_product", (i) => i.eq("productId", p._id).gte("createdAt", from).lte("createdAt", to));
    } else {
      q = ctx.db.query("stockMovements").withIndex("by_business_created", (i) => i.eq("businessId", businessId).gte("createdAt", from).lte("createdAt", to));
    }
    // ponytail: type filter runs after the index range; fine for the 500-row cap
    const type = a.type;
    const rows = await (type ? q.filter((f) => f.eq(f.field("type"), type)) : q).order("desc").take(500);
    const see = hasPermission(member, "seeCost");
    return rows.map((m) => {
      if (see) return m;
      const { unitCostCents: _u, ...rest } = m;
      return rest;
    });
  },
});

export const stocktake = mutation({
  args: {
    counts: v.array(v.object({ productId: v.id("products"), counted: v.number(), batch: v.optional(batchArg) })),
    note: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "inventory");
    requirePermission(member, "adjustStock");
    if (a.counts.length > 500 || new Set(a.counts.map((c) => c.productId)).size !== a.counts.length) fail("INVALID_INPUT");
    const note = optStr(a.note, 300);
    let adjusted = 0;
    let variance = 0;
    for (const c of a.counts) {
      const p = await getOwned(ctx, businessId, c.productId);
      if (p.type !== "STOCKABLE" || p.hasVariants) fail("INVALID_INPUT");
      if (!Number.isFinite(c.counted) || c.counted < 0 || c.counted > 1e9) fail("INVALID_INPUT");
      if (!p.allowDecimal && !Number.isInteger(c.counted)) fail("INVALID_INPUT");
      const diff = roundQty(roundQty(c.counted) - p.stock);
      if (diff === 0) continue;
      await change(ctx, member, p, diff, "STOCKTAKE", { reason: "STOCKTAKE", note, ref: "Stocktake", batch: c.batch });
      adjusted++;
      variance += Math.round(diff * p.costCents);
    }
    await audit(ctx, member, "inventory.stocktake", `${adjusted} adjusted`);
    // cost-derived: callers without seeCost just get 0
    return { adjusted, varianceValueCents: hasPermission(member, "seeCost") ? variance : 0 };
  },
});

export const valuation = query({
  args: {},
  handler: async (ctx) => {
    const { businessId, member } = await requireBusiness(ctx, "inventory");
    requirePermission(member, "seeCost");
    const rows = await ctx.db.query("products").withIndex("by_business", (q) => q.eq("businessId", businessId).eq("isArchived", false)).take(CAP);
    const cats = new Map((await ctx.db.query("categories").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(1000)).map((c) => [c._id, c.name]));
    const by = new Map<string, { name: string; costCents: number; retailCents: number; items: number }>();
    let totalCostCents = 0, totalRetailCents = 0;
    for (const p of rows) {
      if (p.type !== "STOCKABLE" || p.hasVariants || p.stock <= 0) continue;
      const cost = Math.round(p.stock * p.costCents), retail = Math.round(p.stock * p.priceCents);
      const name = (p.categoryId && cats.get(p.categoryId)) || "Uncategorized";
      const g = by.get(name) ?? { name, costCents: 0, retailCents: 0, items: 0 };
      g.costCents += cost; g.retailCents += retail; g.items++;
      by.set(name, g);
      totalCostCents += cost; totalRetailCents += retail;
    }
    return { totalCostCents, totalRetailCents, byCategory: [...by.values()].sort((x, y) => y.costCents - x.costCents) };
  },
});

export const lowStock = query({
  args: {},
  handler: async (ctx) => {
    const { businessId, member } = await requireBusiness(ctx, "inventory");
    const see = hasPermission(member, "seeCost");
    const rows = await ctx.db.query("products").withIndex("by_business", (q) => q.eq("businessId", businessId).eq("isArchived", false)).take(CAP);
    const low = rows.filter((p) => p.type === "STOCKABLE" && !p.hasVariants && p.stock <= p.reorderLevel);
    const suppliers = new Map<string, string>();
    const out = [];
    for (const p of low) {
      if (p.supplierId && !suppliers.has(p.supplierId)) {
        const s = await ctx.db.get(p.supplierId);
        suppliers.set(p.supplierId, s && s.businessId === businessId ? s.name : "");
      }
      out.push({
        ...noCost(p, see),
        supplierName: p.supplierId ? suppliers.get(p.supplierId) || undefined : undefined,
        suggestedQty: Math.max(roundQty(p.reorderLevel * 2 - p.stock), 1),
      });
    }
    return out;
  },
});
