// THE only place that changes product stock. Every change writes a stockMovements row.
// SERVICE and CONSUMABLE products don't track stock: these functions are no-ops for them.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { fail } from "./access";

type MovementType = Doc<"stockMovements">["type"];
export type BatchUse = { batchId: Id<"batches">; qty: number };

/** Quantities may be decimal (kg, metre). Round to 3 places to stop float drift. */
export const roundQty = (n: number) => Math.round(n * 1000) / 1000;

const tracks = (p: Doc<"products">) => p.type === "STOCKABLE";

async function log(
  ctx: MutationCtx,
  member: Doc<"members">,
  p: Doc<"products">,
  type: MovementType,
  qty: number,
  balanceAfter: number,
  unitCostCents: number,
  o: { batchId?: Id<"batches">; ref?: string; reason?: string; note?: string },
) {
  await ctx.db.insert("stockMovements", {
    businessId: p.businessId,
    productId: p._id,
    productName: p.variantLabel ? `${p.name} (${p.variantLabel})` : p.name,
    batchId: o.batchId,
    type,
    qty,
    balanceAfter,
    unitCostCents,
    reason: o.reason,
    note: o.note,
    ref: o.ref,
    memberId: member._id,
    memberName: member.fullName,
    createdAt: Date.now(),
  });
}

/**
 * Take `qty` out of stock. For trackExpiry products, consumes non-expired batches
 * earliest-expiry first (FEFO), or only `batchId` if given (write-off of one batch).
 * Throws PRODUCT_EXPIRED on a SALE when all remaining stock is expired, and
 * INSUFFICIENT_STOCK when stock would go negative and `allowNegative` is false.
 * Returns the batches used (store them on the sale so a refund can put stock back).
 */
export async function stockOut(
  ctx: MutationCtx,
  member: Doc<"members">,
  product: Doc<"products">,
  qty: number,
  type: MovementType,
  o: { allowNegative: boolean; batchId?: Id<"batches">; ref?: string; reason?: string; note?: string },
): Promise<BatchUse[]> {
  if (!tracks(product) || qty <= 0) return [];
  const used: BatchUse[] = [];
  let remaining = roundQty(qty);

  if (product.trackExpiry) {
    const now = Date.now();
    let batches: Doc<"batches">[];
    if (o.batchId) {
      const b = await ctx.db.get(o.batchId);
      if (!b || b.productId !== product._id) fail("NOT_FOUND");
      if (b.qty < remaining) fail("INSUFFICIENT_STOCK");
      batches = [b];
    } else {
      batches = await ctx.db
        .query("batches")
        .withIndex("by_product_expiry", (q) => q.eq("productId", product._id).gt("expiryDate", now))
        .collect();
      const sellable = batches.reduce((s, b) => s + b.qty, 0);
      if (type === "SALE" && sellable <= 0 && product.stock > 0) fail("PRODUCT_EXPIRED");
    }
    for (const b of batches) {
      if (remaining <= 0) break;
      if (b.qty <= 0) continue;
      const take = Math.min(b.qty, remaining);
      await ctx.db.patch(b._id, { qty: roundQty(b.qty - take) });
      used.push({ batchId: b._id, qty: take });
      remaining = roundQty(remaining - take);
    }
    // expired batches don't count as available: only oversell when negative stock is allowed
    if (remaining > 0 && !o.allowNegative) fail("INSUFFICIENT_STOCK");
  }

  const balance = roundQty(product.stock - qty);
  if (balance < 0 && !o.allowNegative) fail("INSUFFICIENT_STOCK");
  await ctx.db.patch(product._id, { stock: balance, updatedAt: Date.now() });

  // one movement row per batch portion (+ one for any unbatched remainder)
  let running = product.stock;
  for (const u of used) {
    running = roundQty(running - u.qty);
    await log(ctx, member, product, type, -u.qty, running, product.costCents, { ...o, batchId: u.batchId });
  }
  if (remaining > 0) await log(ctx, member, product, type, -remaining, balance, product.costCents, o);
  return used;
}

/**
 * Put `qty` into stock.
 * - trackExpiry products need `batch` (new batch with expiry) or `restore` (batches from a refunded sale).
 * - `unitCostCents` on PURCHASE updates the product's weighted-average cost.
 */
export async function stockIn(
  ctx: MutationCtx,
  member: Doc<"members">,
  product: Doc<"products">,
  qty: number,
  type: MovementType,
  o: {
    unitCostCents?: number;
    batch?: { batchNo: string; expiryDate: number; purchaseId?: Id<"purchases"> };
    restore?: BatchUse[];
    ref?: string;
    reason?: string;
    note?: string;
  } = {},
) {
  if (!tracks(product) || qty <= 0) return;
  qty = roundQty(qty);
  const cost = o.unitCostCents ?? product.costCents;
  let batchId: Id<"batches"> | undefined;

  if (product.trackExpiry) {
    if (o.restore?.length) {
      for (const r of o.restore) {
        const b = await ctx.db.get(r.batchId);
        if (b) await ctx.db.patch(b._id, { qty: roundQty(b.qty + r.qty) });
      }
    } else if (o.batch) {
      batchId = await ctx.db.insert("batches", {
        businessId: product.businessId,
        productId: product._id,
        batchNo: o.batch.batchNo,
        qty,
        costCents: cost,
        expiryDate: o.batch.expiryDate,
        receivedAt: Date.now(),
        purchaseId: o.batch.purchaseId,
      });
    } else {
      fail("EXPIRY_REQUIRED");
    }
  }

  const balance = roundQty(product.stock + qty);
  const patch: Partial<Doc<"products">> = { stock: balance, updatedAt: Date.now() };
  if (type === "PURCHASE" && o.unitCostCents !== undefined) {
    const onHand = Math.max(product.stock, 0);
    patch.costCents = Math.round((onHand * product.costCents + qty * o.unitCostCents) / (onHand + qty));
  }
  await ctx.db.patch(product._id, patch);
  await log(ctx, member, product, type, qty, balance, cost, { ...o, batchId });
}
