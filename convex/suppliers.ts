import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { audit, diff, fail, getOwned, requireBusiness } from "./lib/access";
import { cents, optStr, posInt, str } from "./lib/validate";
import { paymentMethod } from "./schema";

type LedgerType = Doc<"supplierLedger">["type"];

/** Change a supplier's balance and write the matching ledger row. `delta` > 0 = we owe more. */
export async function postLedger(
  ctx: MutationCtx, member: Doc<"members">, s: Doc<"suppliers">, type: LedgerType, delta: number,
  o: { purchaseId?: Id<"purchases">; method?: Doc<"supplierLedger">["method"]; reference?: string; note?: string } = {},
) {
  const balance = s.balanceCents + delta;
  await ctx.db.patch(s._id, { balanceCents: balance });
  await ctx.db.insert("supplierLedger", {
    businessId: s.businessId, supplierId: s._id, type, amountCents: Math.abs(delta), balanceAfterCents: balance,
    ...o, createdBy: member._id, createdAt: Date.now(),
  });
  return balance;
}

const info = {
  name: v.string(), company: v.string(), phone: v.string(), whatsapp: v.string(), address: v.string(), notes: v.string(),
};
const cleanInfo = (a: { name: string; company: string; phone: string; whatsapp: string; address: string; notes: string }) => ({
  name: str(a.name, 100),
  company: optStr(a.company, 100) ?? "",
  phone: optStr(a.phone, 40) ?? "",
  whatsapp: optStr(a.whatsapp, 40) ?? "",
  address: optStr(a.address, 200) ?? "",
  notes: optStr(a.notes, 500) ?? "",
});

export const list = query({
  args: { search: v.optional(v.string()), withBalance: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const { businessId } = await requireBusiness(ctx, "purchases");
    const search = a.search?.trim().slice(0, 100);
    let rows = search
      ? await ctx.db.query("suppliers").withSearchIndex("search_name", (q) => q.search("name", search).eq("businessId", businessId)).take(100)
      : await ctx.db.query("suppliers").withIndex("by_business", (q) => q.eq("businessId", businessId).eq("isArchived", false)).take(1000);
    rows = rows.filter((s) => !s.isArchived);
    return a.withBalance ? rows.filter((s) => s.balanceCents > 0) : rows;
  },
});

export const get = query({
  args: { supplierId: v.id("suppliers") },
  handler: async (ctx, a) => {
    const { businessId } = await requireBusiness(ctx, "purchases");
    const supplier = await getOwned(ctx, businessId, a.supplierId);
    const ledger = await ctx.db.query("supplierLedger").withIndex("by_supplier", (q) => q.eq("supplierId", supplier._id)).order("desc").take(200);
    const purchases = await ctx.db.query("purchases").withIndex("by_supplier", (q) => q.eq("supplierId", supplier._id)).order("desc").take(50);
    return {
      supplier,
      ledger,
      // unit costs are cost data: hidden from members without seeCost
      purchases: purchases.map((p) => ({ ...p, items: p.items.map(({ unitCostCents, ...i }) => i) })),
    };
  },
});

export const create = mutation({
  args: { ...info, openingBalanceCents: v.number() },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "purchases");
    const opening = cents(a.openingBalanceCents);
    const id = await ctx.db.insert("suppliers", { ...cleanInfo(a), businessId, balanceCents: 0, isArchived: false, createdAt: Date.now() });
    if (opening > 0) await postLedger(ctx, member, (await ctx.db.get(id))!, "OPENING", opening);
    await audit(ctx, member, "supplier.create", a.name.trim());
    return id;
  },
});

export const update = mutation({
  args: { supplierId: v.id("suppliers"), ...info },
  handler: async (ctx, { supplierId, ...a }) => {
    const { businessId, member } = await requireBusiness(ctx, "purchases");
    const s = await getOwned(ctx, businessId, supplierId);
    const next = cleanInfo(a);
    await ctx.db.patch(s._id, next);
    await audit(ctx, member, "supplier.update", s.name, undefined, {
      targetId: s._id,
      targetName: s.name,
      changes: diff(s, next, Object.keys(next)),
    });
  },
});

export const archive = mutation({
  args: { supplierId: v.id("suppliers"), archived: v.boolean() },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "purchases");
    const s = await getOwned(ctx, businessId, a.supplierId);
    await ctx.db.patch(s._id, { isArchived: a.archived });
    await audit(ctx, member, a.archived ? "supplier.archive" : "supplier.unarchive", s.name);
  },
});

export const pay = mutation({
  args: {
    supplierId: v.id("suppliers"), amountCents: v.number(), method: paymentMethod,
    reference: v.optional(v.string()), note: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "purchases");
    const s = await getOwned(ctx, businessId, a.supplierId);
    const amount = posInt(a.amountCents, 1e12);
    if (a.method === "CREDIT") fail("INVALID_INPUT");
    if (amount > s.balanceCents) fail("PAYMENT_EXCEEDS_BALANCE");
    const balance = await postLedger(ctx, member, s, "PAYMENT", -amount, {
      method: a.method, reference: optStr(a.reference, 100), note: optStr(a.note, 300),
    });
    await audit(ctx, member, "supplier.pay", `${s.name} ${amount}`);
    return { balanceAfterCents: balance };
  },
});

export const adjust = mutation({
  args: { supplierId: v.id("suppliers"), direction: v.union(v.literal("UP"), v.literal("DOWN")), amountCents: v.number(), note: v.string() },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "purchases");
    const s = await getOwned(ctx, businessId, a.supplierId);
    const amount = posInt(a.amountCents, 1e12);
    const note = optStr(a.note, 300);
    if (!note) fail("REASON_REQUIRED");
    const up = a.direction === "UP";
    const balance = await postLedger(ctx, member, s, up ? "ADJUST_UP" : "ADJUST_DOWN", up ? amount : -amount, { note });
    await audit(ctx, member, "supplier.adjust", `${s.name} ${up ? "+" : "-"}${amount}: ${note}`);
    return { balanceAfterCents: balance };
  },
});
