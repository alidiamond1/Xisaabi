import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { audit, fail, getOwned, requireBusiness } from "./lib/access";
import { roundQty, stockIn } from "./lib/stock";
import { cents, optStr, ts } from "./lib/validate";
import { hasPermission } from "./shared/permissions";
import { paymentMethod } from "./schema";
import { qtyOf } from "./products";
import { postLedger } from "./suppliers";
import { addSerials, checkNewSerials } from "./serials";

/** Unit costs are cost data: hidden from members without seeCost. */
const view = (p: Doc<"purchases">, see: boolean) =>
  see ? p : { ...p, items: p.items.map(({ unitCostCents: _u, ...i }) => i) };

export const list = query({
  args: { from: v.number(), to: v.number(), supplierId: v.optional(v.id("suppliers")) },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "purchases");
    const from = ts(a.from), to = ts(a.to);
    const rows = a.supplierId
      ? await ctx.db
          .query("purchases")
          .withIndex("by_supplier", (q) => q.eq("supplierId", a.supplierId).gte("createdAt", from).lte("createdAt", to))
          .order("desc")
          .take(500)
      : await ctx.db
          .query("purchases")
          .withIndex("by_business_created", (q) => q.eq("businessId", businessId).gte("createdAt", from).lte("createdAt", to))
          .order("desc")
          .take(500);
    // by_supplier is not business-scoped: prove ownership of the supplier, then of every row
    if (a.supplierId) await getOwned(ctx, businessId, a.supplierId);
    const see = hasPermission(member, "seeCost");
    return rows.filter((p) => p.businessId === businessId).map((p) => view(p, see));
  },
});

export const get = query({
  args: { purchaseId: v.id("purchases") },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "purchases");
    return view(await getOwned(ctx, businessId, a.purchaseId), hasPermission(member, "seeCost"));
  },
});

export const create = mutation({
  args: {
    supplierId: v.optional(v.id("suppliers")),
    items: v.array(
      v.object({
        productId: v.id("products"), qty: v.number(), unitCostCents: v.number(),
        batchNo: v.optional(v.string()), expiryDate: v.optional(v.number()),
        // v3: qty and unitCostCents are per `unitName` (a pack of the product); serials for trackSerial products
        unitName: v.optional(v.string()), serials: v.optional(v.array(v.string())),
      }),
    ),
    otherCostCents: v.number(),
    paidCents: v.number(),
    paidMethod: v.optional(paymentMethod),
    note: v.string(),
  },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "purchases");
    if (a.items.length < 1 || a.items.length > 100) fail("INVALID_INPUT");
    const supplier = a.supplierId ? await getOwned(ctx, businessId, a.supplierId) : null;
    if (supplier?.isArchived) fail("INVALID_INPUT");
    const other = cents(a.otherCostCents);
    const paid = cents(a.paidCents);
    if (paid > 0 && (!a.paidMethod || a.paidMethod === "CREDIT")) fail("INVALID_INPUT");

    // validate lines first (nothing is written yet)
    const lines = [];
    const seen = new Set<string>();
    for (const it of a.items) {
      const p = await getOwned(ctx, businessId, it.productId);
      if (p.type !== "STOCKABLE" || p.hasVariants || p.isArchived) fail("INVALID_INPUT");
      const inQty = qtyOf(it.qty, p.allowDecimal);
      const inCost = cents(it.unitCostCents);
      const u = it.unitName && it.unitName.trim().toLowerCase() !== p.unit.toLowerCase()
        ? p.units?.find((x) => x.name.toLowerCase() === it.unitName!.trim().toLowerCase()) ?? fail("INVALID_INPUT")
        : undefined;
      const factor = u?.factor ?? 1;
      const qty = roundQty(inQty * factor);
      if (qty > 1e9) fail("INVALID_INPUT"); // keeps stock maths exact (factor can be 1e6)
      // per-base-unit cost stays fractional until the landed cost is rounded
      const unitF = inCost / factor;
      let serials: string[] | undefined;
      if (p.trackSerial) {
        if (u) fail("INVALID_INPUT");
        serials = await checkNewSerials(ctx, businessId, it.serials, qty);
        for (const s of serials) if (seen.has(s)) fail("SERIAL_EXISTS");
        for (const s of serials) seen.add(s);
      } else if (it.serials?.length) fail("INVALID_INPUT");
      lines.push({ it, p, qty, unit: Math.round(unitF), unitF, value: Math.round(inQty * inCost), u, inQty, serials });
    }
    const itemsValue = lines.reduce((s, l) => s + l.value, 0);
    const total = itemsValue + other;
    if (paid > total) fail("INVALID_INPUT");
    const unpaid = total - paid;
    if (unpaid > 0 && !supplier) fail("INVALID_INPUT"); // credit needs a supplier to owe

    const last = await ctx.db.query("purchases").withIndex("by_business_number", (q) => q.eq("businessId", businessId)).order("desc").first();
    const number = (last?.number ?? 0) + 1;
    const purchaseId = await ctx.db.insert("purchases", {
      businessId, number, supplierId: supplier?._id, supplierName: supplier?.name ?? "",
      items: lines.map((l) => ({
        productId: l.p._id,
        name: l.p.variantLabel ? `${l.p.name} (${l.p.variantLabel})` : l.p.name,
        qty: l.qty,
        unitCostCents: l.unit,
        unitName: l.u?.name,
        unitQty: l.u ? l.inQty : undefined,
        serials: l.serials,
        batchNo: l.p.trackExpiry ? (optStr(l.it.batchNo, 60) ?? `P${number}`) : undefined,
        expiryDate: l.p.trackExpiry && l.it.expiryDate !== undefined ? ts(l.it.expiryDate) : undefined,
      })),
      otherCostCents: other, totalCents: total, paidCents: paid, paidMethod: paid > 0 ? a.paidMethod : undefined,
      note: optStr(a.note, 500) ?? "", createdBy: member._id, createdAt: Date.now(),
    });

    for (const l of lines) {
      // re-read: the same product may appear on two lines
      const p = (await ctx.db.get(l.p._id))!;
      // other costs (transport...) are spread over lines by value; equally by qty if every line is free
      const share = itemsValue > 0 ? l.value / itemsValue : l.qty / lines.reduce((s, x) => s + x.qty, 0);
      const landed = Math.round(l.unitF + (other * share) / l.qty);
      const exp = l.it.expiryDate;
      await stockIn(ctx, member, p, l.qty, "PURCHASE", {
        unitCostCents: landed,
        batch: p.trackExpiry && exp !== undefined
          ? { batchNo: optStr(l.it.batchNo, 60) ?? `P${number}`, expiryDate: ts(exp), purchaseId }
          : undefined,
        ref: `Purchase #${number}`,
      });
      if (l.serials) await addSerials(ctx, businessId, p._id, l.serials, landed, purchaseId);
      if (supplier && !p.supplierId) await ctx.db.patch(p._id, { supplierId: supplier._id });
    }

    if (supplier && unpaid > 0) await postLedger(ctx, member, supplier, "PURCHASE", unpaid, { purchaseId });
    await audit(ctx, member, "purchase.create", `#${number} total=${total} paid=${paid}`);
    return { purchaseId, number };
  },
});
