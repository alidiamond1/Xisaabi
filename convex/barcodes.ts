// Internal (retailer-use) EAN-13 generation for products without a barcode.
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation } from "./_generated/server";
import { audit, getOwned, requireBusiness } from "./lib/access";
import { isInternal, makeInternalEan13 } from "./shared/barcode";

/** Every barcode already used in this business (primary, extra and pack barcodes). */
// ponytail: reads the first 5000 products; a barcode-alias table is the upgrade for bigger shops
async function usedCodes(ctx: MutationCtx, businessId: Id<"businesses">): Promise<Set<string>> {
  const rows = await ctx.db.query("products").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(5000);
  return new Set(rows.flatMap((p) => [p.barcode, ...p.extraBarcodes, ...(p.units ?? []).map((u) => u.barcode)]).filter(Boolean));
}

/** Next internal code after the highest generated one, skipping anything already used here. */
function nextFree(used: Set<string>, seq: number): { barcode: string; seq: number } {
  let barcode: string;
  do barcode = makeInternalEan13(++seq);
  while (used.has(barcode));
  used.add(barcode);
  return { barcode, seq };
}

/** Highest internal sequence used by this business (0 if none). */
// ponytail: reads the top 50 barcodes in the "2…" range; a per-business counter doc is the upgrade if scale-style 2x codes crowd the range
async function lastSeq(ctx: MutationCtx, businessId: Id<"businesses">): Promise<number> {
  const rows = await ctx.db
    .query("products")
    .withIndex("by_business_barcode", (q) => q.eq("businessId", businessId).gte("barcode", "20").lt("barcode", "3"))
    .order("desc")
    .take(50);
  for (const r of rows) {
    if (isInternal(r.barcode) && makeInternalEan13(Number(r.barcode.slice(2, 12))) === r.barcode) return Number(r.barcode.slice(2, 12));
  }
  return 0;
}

export const generate = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, { productId }) => {
    const { businessId, member } = await requireBusiness(ctx, "inventory");
    const p = await getOwned(ctx, businessId, productId);
    if (p.barcode) return p.barcode;
    const { barcode } = nextFree(await usedCodes(ctx, businessId), await lastSeq(ctx, businessId));
    await ctx.db.patch(p._id, { barcode, updatedAt: Date.now() });
    await audit(ctx, member, "barcode.generate", `${p.name}: ${barcode}`);
    return barcode;
  },
});

/** Assign internal barcodes to up to 200 live products that have none. */
export const generateMissing = mutation({
  args: {},
  handler: async (ctx) => {
    const { businessId, member } = await requireBusiness(ctx, "inventory");
    const rows = await ctx.db
      .query("products")
      .withIndex("by_business_barcode", (q) => q.eq("businessId", businessId).eq("barcode", ""))
      .take(200);
    let seq = await lastSeq(ctx, businessId);
    const used = await usedCodes(ctx, businessId);
    let count = 0;
    for (const p of rows) {
      if (p.isArchived || p.hasVariants) continue;
      const next = nextFree(used, seq);
      seq = next.seq;
      await ctx.db.patch(p._id, { barcode: next.barcode, updatedAt: Date.now() });
      count++;
    }
    if (count) await audit(ctx, member, "barcode.generateMissing", `${count} products`);
    return { count };
  },
});
