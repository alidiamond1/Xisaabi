import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { audit, fail, getOwned, requireBusiness, requirePermission } from "./lib/access";
import { roundQty, stockIn, stockOut, type BatchUse } from "./lib/stock";
import { cents, optStr, str, ts } from "./lib/validate";
import { hasPermission } from "./shared/permissions";
import { DAY_MS } from "./shared/expiry";
import { paymentMethod } from "./schema";
import { emptyByMethod, openShiftOf } from "./shifts";
import { normSerial } from "./serials";

const itemKey = (productId: string, unitName?: string) => `${productId}|${unitName?.toLowerCase() ?? ""}`;
/** Warranty end = sale time + N calendar months. */
const addMonths = (t: number, m: number) => { const d = new Date(t); d.setUTCMonth(d.getUTCMonth() + m); return d.getTime(); };

type Sale = Doc<"sales">;
const posOrSales = (ctx: QueryCtx) => requireBusiness(ctx, "pos").catch(() => requireBusiness(ctx, "sales"));

/** round(a*b/c) exactly (BigInt: a*b can pass 2^53). All args non-negative integers. */
export const mulDiv = (a: number, b: number, c: number) =>
  c === 0 ? 0 : Number((BigInt(a) * BigInt(b) * BigInt(2) + BigInt(c)) / (BigInt(2) * BigInt(c)));

const lineNet = (it: Sale["items"][number]) => Math.round(it.priceCents * it.qty) - it.discountCents;

/**
 * Each line's share of the sale total (line net + its part of the order discount + tax).
 * Cumulative rounding => shares add up to exactly totalCents.
 */
export function lineShares(sale: Sale): number[] {
  let cum = 0;
  let prev = 0;
  return sale.items.map((it) => {
    cum += lineNet(it);
    const c = mulDiv(cum, sale.totalCents, sale.subtotalCents);
    const share = c - prev;
    prev = c;
    return share;
  });
}

/** Part of a line's share for the first `done` of `qty` units (rounded down); the final refund takes the remainder. */
const shareOf = (share: number, done: number, qty: number) =>
  done >= qty ? share : Number((BigInt(share) * BigInt(Math.round(done * 1000))) / BigInt(Math.round(qty * 1000))); // floor

/** Cost never leaves the server unless the caller may see it. */
const view = (s: Sale, seeCost: boolean) => ({
  ...s,
  items: s.items.map(({ costCents, ...i }) => (seeCost ? { ...i, costCents } : i)),
});

const methodsOf = (s: Sale) => [...new Set(s.payments.map((p) => p.method))];

export const create = mutation({
  args: {
    clientSaleId: v.string(),
    items: v.array(
      v.object({
        productId: v.id("products"), qty: v.number(), discountCents: v.number(),
        unitName: v.optional(v.string()), serials: v.optional(v.array(v.string())),
      }),
    ),
    orderDiscountCents: v.number(),
    payments: v.array(v.object({ method: paymentMethod, amountCents: v.number(), reference: v.optional(v.string()) })),
    customerId: v.optional(v.id("customers")),
    note: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, a) => {
    const { member, role, businessId, business } = await requireBusiness(ctx, "pos");
    const clientSaleId = str(a.clientSaleId, 100);

    // idempotent retry (offline outbox)
    const dup = await ctx.db
      .query("sales")
      .withIndex("by_business_client_id", (q) => q.eq("businessId", businessId).eq("clientSaleId", clientSaleId))
      .first();
    if (dup) return { saleId: dup._id, receiptNo: dup.receiptNo, duplicate: true };

    if (a.items.length < 1 || a.items.length > 200 || a.payments.length > 10) fail("INVALID_INPUT");
    const orderDiscount = cents(a.orderDiscountCents);
    const now = Date.now();
    // offline outbox time, clamped to the last 30 days so sales can't be backdated into old reports
    const createdAt = Math.max(Math.min(ts(a.createdAt), now), now - 30 * DAY_MS);
    const { settings } = business;

    // merge repeated products so stock checks are right
    // (one line per product + unit)
    const merged = new Map<string, { productId: Id<"products">; unitName?: string; qty: number; disc: number; serials: string[] }>();
    for (const it of a.items) {
      if (!Number.isFinite(it.qty) || it.qty <= 0 || it.qty > 1e6) fail("INVALID_INPUT");
      const unitName = optStr(it.unitName, 30);
      const key = itemKey(it.productId, unitName);
      const m = merged.get(key) ?? { productId: it.productId, unitName, qty: 0, disc: 0, serials: [] };
      m.qty = roundQty(m.qty + it.qty);
      m.disc += cents(it.discountCents);
      if (it.serials) m.serials.push(...it.serials.map(normSerial));
      merged.set(key, m);
    }
    const sold = new Set<string>();

    const customer = a.customerId ? await getOwned(ctx, businessId, a.customerId) : null;
    const wholesale = customer?.group === "WHOLESALE";

    const lines: { p: Doc<"products">; item: Sale["items"][number] }[] = [];
    let grossTotal = 0;
    let lineDiscounts = 0;
    let subtotal = 0;
    const serialDocs: Id<"serials">[] = [];
    for (const { productId, unitName, qty, disc, serials } of merged.values()) {
      const p = await getOwned(ctx, businessId, productId);
      if (p.isArchived || p.hasVariants) fail("INVALID_INPUT");
      if (qty < 0.001 || (!p.allowDecimal && !Number.isInteger(qty))) fail("INVALID_INPUT");
      // a pack: qty and price are per unit, stock moves qty × factor base units
      const unit = unitName && unitName.toLowerCase() !== p.unit.toLowerCase()
        ? p.units?.find((x) => x.name.toLowerCase() === unitName.toLowerCase()) ?? fail("INVALID_INPUT")
        : undefined;
      const factor = unit?.factor ?? 1;
      const basePrice = wholesale && p.wholesalePriceCents !== undefined ? p.wholesalePriceCents : p.priceCents;
      const price = unit ? (unit.priceCents ?? Math.round(factor * basePrice)) : basePrice;
      // serial products: exactly one IN_STOCK serial of this product per unit sold
      let warrantyUntil: number | undefined;
      if (p.trackSerial) {
        if (unit || serials.length !== qty || new Set(serials).size !== serials.length) fail("SERIAL_REQUIRED");
        for (const sn of serials) {
          if (sold.has(sn)) fail("INVALID_INPUT");
          sold.add(sn);
          const row = await ctx.db.query("serials").withIndex("by_business_and_serial", (q) => q.eq("businessId", businessId).eq("serial", sn)).first();
          if (!row || row.productId !== p._id || row.status !== "IN_STOCK") fail("SERIAL_NOT_AVAILABLE");
          serialDocs.push(row._id);
        }
        if (p.warrantyMonths) warrantyUntil = addMonths(createdAt, p.warrantyMonths);
      } else if (serials.length) fail("INVALID_INPUT");
      const gross = Math.round(price * qty);
      if (gross > 1e12 || disc > gross) fail("INVALID_INPUT"); // 1e12 keeps cents exact in float64
      grossTotal += gross;
      lineDiscounts += disc;
      subtotal += gross - disc;
      lines.push({
        p,
        item: {
          productId,
          name: p.variantLabel ? `${p.name} (${p.variantLabel})` : p.name,
          qty,
          priceCents: price,
          discountCents: disc,
          costCents: unit ? Math.round(p.costCents * factor) : p.costCents,
          refundedQty: 0,
          ...(unit ? { unitName: unit.name, unitFactor: factor } : {}),
          ...(p.trackSerial ? { serials, warrantyUntil } : {}),
        },
      });
    }
    if (subtotal > 1e12 || orderDiscount > subtotal) fail("INVALID_INPUT");

    // discounts: need the permission; non-owners are capped by settings
    const discountTotal = lineDiscounts + orderDiscount;
    if (discountTotal > 0) {
      requirePermission(member, "giveDiscount");
      if (role !== "OWNER" && discountTotal * 100 > settings.maxCashierDiscountPercent * grossTotal) fail("DISCOUNT_TOO_HIGH");
    }
    const taxCents = Math.round(((subtotal - orderDiscount) * settings.taxRatePercent) / 100);
    const totalCents = subtotal - orderDiscount + taxCents;

    // payments: methods enabled, non-cash <= total, everything together >= total; cash may overpay (= change)
    const enabled = new Set<string>([...settings.paymentMethods, "CASH"]);
    const payments = a.payments
      .map((p) => ({ method: p.method, amountCents: cents(p.amountCents), reference: optStr(p.reference, 100) }))
      .filter((p) => p.amountCents > 0);
    if (payments.some((p) => !enabled.has(p.method))) fail("INVALID_INPUT");
    const paid = payments.reduce((n, p) => n + p.amountCents, 0);
    const nonCash = payments.filter((p) => p.method !== "CASH").reduce((n, p) => n + p.amountCents, 0);
    if (nonCash > totalCents || paid < totalCents) fail("PAYMENT_MISMATCH");
    const changeCents = paid - totalCents;

    const creditCents = payments.filter((p) => p.method === "CREDIT").reduce((n, p) => n + p.amountCents, 0);
    if (creditCents > 0) {
      if (!customer) fail("CUSTOMER_REQUIRED");
      if (customer.creditBlocked) fail("CREDIT_BLOCKED");
      if (customer.balanceCents + creditCents > customer.creditLimitCents) fail("CREDIT_LIMIT_EXCEEDED");
    }

    const last = await ctx.db
      .query("sales")
      .withIndex("by_business_receipt", (q) => q.eq("businessId", businessId))
      .order("desc")
      .first();
    const receiptNo = (last?.receiptNo ?? 0) + 1;

    const items: Sale["items"] = [];
    for (const { p: seen, item } of lines) {
      const p = (await ctx.db.get(seen._id))!; // re-read: the same product can have a base line and a pack line
      const used = await stockOut(ctx, member, p, roundQty(item.qty * (item.unitFactor ?? 1)), "SALE", {
        allowNegative: settings.allowNegativeStock,
        ref: `Sale #${receiptNo}`,
      });
      items.push(used.length ? { ...item, batches: used } : item);
    }

    const shift = await openShiftOf(ctx, member._id);
    const saleId = await ctx.db.insert("sales", {
      businessId,
      clientSaleId,
      receiptNo,
      cashierId: member._id,
      cashierName: member.fullName,
      shiftId: shift?._id,
      customerId: customer?._id,
      customerName: customer?.fullName,
      items,
      subtotalCents: subtotal,
      discountCents: orderDiscount,
      taxCents,
      totalCents,
      payments,
      changeCents,
      refundedCents: 0,
      status: "COMPLETED",
      note: optStr(a.note, 500),
      createdAt,
      syncedAt: now,
    });

    for (const id of serialDocs) {
      const sr = (await ctx.db.get(id))!;
      const line = items.find((i) => i.serials?.includes(sr.serial) && i.productId === sr.productId)!;
      await ctx.db.patch(id, { status: "SOLD", saleId, customerId: customer?._id, soldAt: createdAt, warrantyUntil: line.warrantyUntil });
    }

    if (creditCents > 0 && customer) {
      const balanceAfterCents = customer.balanceCents + creditCents;
      await ctx.db.patch(customer._id, { balanceCents: balanceAfterCents });
      await ctx.db.insert("ledger", {
        businessId,
        customerId: customer._id,
        type: "DEBT",
        amountCents: creditCents,
        balanceAfterCents,
        saleId,
        createdBy: member._id,
        createdAt: now,
      });
    }
    return { saleId, receiptNo, duplicate: false };
  },
});

export const get = query({
  args: { saleId: v.id("sales") },
  handler: async (ctx, a) => {
    const { businessId, business, member } = await posOrSales(ctx);
    const sale = await getOwned(ctx, businessId, a.saleId);
    const refunds = await ctx.db.query("refunds").withIndex("by_sale", (q) => q.eq("saleId", sale._id)).take(100);
    return {
      ...view(sale, hasPermission(member, "seeCost")),
      refunds,
      businessName: business.name,
      logoUrl: business.logoId ? await ctx.storage.getUrl(business.logoId) : null,
      phone: business.phone,
      address: business.address,
      receiptHeader: business.settings.receiptHeader,
      receiptFooter: business.settings.receiptFooter,
      currency: business.currency,
    };
  },
});

export const list = query({
  args: {
    from: v.number(),
    to: v.number(),
    method: v.optional(paymentMethod),
    cashierId: v.optional(v.id("members")),
    customerId: v.optional(v.id("customers")),
    status: v.optional(v.union(v.literal("COMPLETED"), v.literal("PARTIALLY_REFUNDED"), v.literal("REFUNDED"))),
    shiftId: v.optional(v.id("shifts")),
  },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "sales");
    ts(a.from);
    ts(a.to);
    const { cashierId, customerId, shiftId } = a;
    if (cashierId) {
      const m = await ctx.db.get(cashierId);
      if (!m || m.businessId !== businessId) fail("NOT_FOUND");
    }
    if (customerId) await getOwned(ctx, businessId, customerId);
    if (shiftId) await getOwned(ctx, businessId, shiftId);
    // pick the narrowest index; the other filters run in memory
    const q = shiftId
      ? ctx.db.query("sales").withIndex("by_shift", (x) => x.eq("shiftId", shiftId))
      : customerId
        ? ctx.db.query("sales").withIndex("by_customer", (x) => x.eq("customerId", customerId).gte("createdAt", a.from).lte("createdAt", a.to))
        : cashierId
          ? ctx.db
              .query("sales")
              .withIndex("by_business_cashier", (x) =>
                x.eq("businessId", businessId).eq("cashierId", cashierId).gte("createdAt", a.from).lte("createdAt", a.to),
              )
          : ctx.db
              .query("sales")
              .withIndex("by_business_created", (x) => x.eq("businessId", businessId).gte("createdAt", a.from).lte("createdAt", a.to));
    const seeCost = hasPermission(member, "seeCost");
    const sales: ReturnType<typeof view>[] = [];
    const totals = { count: 0, totalCents: 0, refundedCents: 0, discountCents: 0, byMethod: emptyByMethod() };
    // ponytail: first 500 matches; totals cover those rows only. Use reports for full-period numbers.
    for await (const s of q.order("desc")) {
      if (s.createdAt < a.from || s.createdAt > a.to) continue;
      if (a.status && s.status !== a.status) continue;
      if (cashierId && s.cashierId !== cashierId) continue;
      if (a.method && !s.payments.some((p) => p.method === a.method)) continue;
      sales.push(view(s, seeCost));
      totals.count++;
      totals.totalCents += s.totalCents;
      totals.refundedCents += s.refundedCents;
      totals.discountCents += s.discountCents + s.items.reduce((n, i) => n + i.discountCents, 0);
      for (const p of s.payments) totals.byMethod[p.method] += p.amountCents;
      totals.byMethod.CASH -= s.changeCents;
      if (sales.length >= 500) break;
    }
    return { sales, totals };
  },
});

export const recentForCashier = query({
  args: {},
  handler: async (ctx) => {
    const { businessId, member } = await requireBusiness(ctx, "pos");
    const seeCost = hasPermission(member, "seeCost");
    const rows = await ctx.db
      .query("sales")
      .withIndex("by_business_cashier", (q) => q.eq("businessId", businessId).eq("cashierId", member._id))
      .order("desc")
      .take(20);
    return rows.map((s) => view(s, seeCost));
  },
});

export const findByReceipt = query({
  args: { receiptNo: v.number() },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "pos");
    const s = await ctx.db
      .query("sales")
      .withIndex("by_business_receipt", (q) => q.eq("businessId", businessId).eq("receiptNo", a.receiptNo))
      .first();
    return s ? view(s, hasPermission(member, "seeCost")) : null;
  },
});

export const refund = mutation({
  args: {
    saleId: v.id("sales"),
    items: v.array(
      v.object({
        productId: v.id("products"), qty: v.number(), restock: v.boolean(),
        unitName: v.optional(v.string()), serials: v.optional(v.array(v.string())), // which serials come back (default: first sold)
      }),
    ),
    method: paymentMethod,
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    const { member, businessId } = await posOrSales(ctx);
    requirePermission(member, "refund");
    const sale = await getOwned(ctx, businessId, a.saleId);
    const reason = a.reason.trim();
    if (!reason) fail("REASON_REQUIRED");
    if (reason.length > 500 || a.items.length < 1 || a.items.length > 200) fail("INVALID_INPUT");
    if (sale.status === "REFUNDED") fail("ALREADY_REFUNDED");
    const customer = a.method === "CREDIT" ? (sale.customerId ? await getOwned(ctx, businessId, sale.customerId) : fail("CUSTOMER_REQUIRED")) : null;

    const shares = lineShares(sale);
    const items = sale.items.map((i) => ({ ...i }));
    const seen = new Set<string>();
    const rows: Doc<"refunds">["items"] = [];
    let amount = 0;
    for (const r of a.items) {
      const key = itemKey(r.productId, optStr(r.unitName, 30));
      if (seen.has(key)) fail("INVALID_INPUT"); // one row per product + unit
      seen.add(key);
      if (!Number.isFinite(r.qty) || r.qty <= 0 || r.qty > 1e6) fail("INVALID_INPUT");
      const idx = items.findIndex((i) => itemKey(i.productId, i.unitName) === key);
      if (idx < 0) fail("INVALID_INPUT");
      const it = items[idx];
      const q = roundQty(r.qty);
      const p = await getOwned(ctx, businessId, it.productId);
      if (q <= 0 || (!p.allowDecimal && !Number.isInteger(q))) fail("INVALID_INPUT");
      const done = roundQty(it.refundedQty + q);
      if (done > it.qty) fail("REFUND_TOO_MUCH");
      const money = shareOf(shares[idx], done, it.qty) - shareOf(shares[idx], it.refundedQty, it.qty);

      const factor = it.unitFactor ?? 1;
      const baseQ = roundQty(q * factor);
      if (it.serials?.length) {
        // serial lines: pick the sold serials that come back; restock → IN_STOCK again, otherwise RETURNED
        const pool: Doc<"serials">[] = [];
        for (const sn of it.serials) {
          const row = await ctx.db.query("serials").withIndex("by_business_and_serial", (x) => x.eq("businessId", businessId).eq("serial", sn)).first();
          if (row && row.status === "SOLD" && row.saleId === sale._id) pool.push(row);
        }
        const want = r.serials?.map(normSerial);
        const pick = want ? want.map((sn) => pool.find((x) => x.serial === sn) ?? fail("SERIAL_NOT_AVAILABLE")) : pool.slice(0, q);
        if (pick.length !== q || new Set(pick.map((x) => x._id)).size !== q) fail("SERIAL_REQUIRED");
        for (const row of pick) {
          await ctx.db.patch(row._id, r.restock
            ? { status: "IN_STOCK", saleId: undefined, customerId: undefined, soldAt: undefined, warrantyUntil: undefined }
            : { status: "RETURNED" });
        }
      }
      if (r.restock) {
        // put stock back into the batches the sale took it from, pro-rata by refunded qty
        let restore: BatchUse[] | undefined;
        if (it.batches?.length) {
          restore = it.batches.map((b) => ({ batchId: b.batchId, qty: roundQty((b.qty * q) / it.qty) }));
          const whole = Math.abs(it.batches.reduce((n, b) => n + b.qty, 0) - it.qty * factor) < 1e-6;
          if (whole && restore.length > 1) {
            const rest = restore.slice(0, -1).reduce((n, b) => n + b.qty, 0);
            restore[restore.length - 1].qty = Math.max(roundQty(baseQ - rest), 0);
          }
        }
        // ponytail: expiry-tracked line sold without batch data (negative stock) cannot be restocked; stock is left as is
        if (!p.trackExpiry || restore) {
          await stockIn(ctx, member, p, baseQ, "REFUND", { restore, ref: `Refund #${sale.receiptNo}`, reason: "REFUND" });
        }
      }
      it.refundedQty = done;
      amount += money;
      rows.push({ productId: it.productId, name: it.name, qty: q, amountCents: money, restock: r.restock, unitName: it.unitName });
    }

    const fully = items.every((i) => i.refundedQty >= i.qty);
    const refundedCents = sale.refundedCents + amount;
    const now = Date.now();
    await ctx.db.patch(sale._id, { items, refundedCents, status: fully ? "REFUNDED" : "PARTIALLY_REFUNDED" });
    const shift = await openShiftOf(ctx, member._id);
    const refundId = await ctx.db.insert("refunds", {
      businessId,
      saleId: sale._id,
      receiptNo: sale.receiptNo,
      items: rows,
      amountCents: amount,
      method: a.method,
      reason,
      shiftId: shift?._id,
      createdBy: member._id,
      createdAt: now,
    });

    if (customer && amount > 0) {
      // may leave a negative balance = store credit when the customer already paid
      const balanceAfterCents = customer.balanceCents - amount;
      await ctx.db.patch(customer._id, { balanceCents: balanceAfterCents });
      await ctx.db.insert("ledger", {
        businessId,
        customerId: customer._id,
        type: "REVERSAL",
        amountCents: amount,
        balanceAfterCents,
        saleId: sale._id,
        note: reason,
        createdBy: member._id,
        createdAt: now,
      });
    }
    await audit(ctx, member, "sale.refund", `#${sale.receiptNo} ${amount} ${a.method}: ${reason}`);
    return { refundId, amountCents: amount, status: fully ? ("REFUNDED" as const) : ("PARTIALLY_REFUNDED" as const) };
  },
});

export const exportCsv = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, a) => {
    const { businessId } = await requireBusiness(ctx, "sales");
    ts(a.from);
    ts(a.to);
    if (a.to < a.from || a.to - a.from > 366 * DAY_MS) fail("INVALID_INPUT");
    const sales = await ctx.db
      .query("sales")
      .withIndex("by_business_created", (q) => q.eq("businessId", businessId).gte("createdAt", a.from).lte("createdAt", a.to))
      .take(8000);
    return sales.map((s) => ({
      receiptNo: s.receiptNo,
      date: new Date(s.createdAt).toISOString(),
      cashier: s.cashierName,
      customer: s.customerName ?? "",
      items: s.items.reduce((n, i) => n + i.qty, 0),
      subtotalCents: s.subtotalCents,
      discountCents: s.discountCents + s.items.reduce((n, i) => n + i.discountCents, 0),
      taxCents: s.taxCents,
      totalCents: s.totalCents,
      refundedCents: s.refundedCents,
      methods: methodsOf(s).join("+"),
      status: s.status,
    }));
  },
});
