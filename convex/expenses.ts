import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { audit, fail, getOwned, requireBusiness } from "./lib/access";
import { optStr, posInt, str, ts } from "./lib/validate";
import { paymentMethod } from "./schema";
import { openShiftOf } from "./shifts";

const fields = { category: v.string(), amountCents: v.number(), paidVia: paymentMethod, payee: v.string(), note: v.string(), spentAt: v.number() };

export const list = query({
  args: { from: v.number(), to: v.number(), category: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { businessId } = await requireBusiness(ctx, "expenses");
    const rows = await ctx.db
      .query("expenses")
      .withIndex("by_business_spent", (q) => q.eq("businessId", businessId).gte("spentAt", a.from).lte("spentAt", a.to))
      .order("desc")
      .take(1000);
    const expenses = a.category ? rows.filter((e) => e.category === a.category) : rows;
    const by = new Map<string, { category: string; totalCents: number; count: number }>();
    for (const e of expenses) {
      const r = by.get(e.category) ?? { category: e.category, totalCents: 0, count: 0 };
      r.totalCents += e.amountCents;
      r.count++;
      by.set(e.category, r);
    }
    return {
      expenses,
      totalCents: expenses.reduce((n, e) => n + e.amountCents, 0),
      byCategory: [...by.values()].sort((x, y) => y.totalCents - x.totalCents),
    };
  },
});

export const create = mutation({
  args: fields,
  handler: async (ctx, a) => {
    const { businessId, member, business } = await requireBusiness(ctx, "expenses");
    const category = str(a.category, 40);
    if (!business.settings.expenseCategories.includes(category) || a.paidVia === "CREDIT") fail("INVALID_INPUT");
    const amountCents = posInt(a.amountCents, 1e12);
    // cash paid from the drawer counts against the caller's open shift
    const shift = a.paidVia === "CASH" ? await openShiftOf(ctx, member._id) : null;
    const id = await ctx.db.insert("expenses", {
      businessId,
      category,
      amountCents,
      paidVia: a.paidVia,
      payee: optStr(a.payee) ?? "",
      note: optStr(a.note, 500) ?? "",
      shiftId: shift?._id,
      spentAt: ts(a.spentAt),
      createdBy: member._id,
      createdAt: Date.now(),
    });
    await audit(ctx, member, "expense.create", `${category} ${amountCents} ${a.paidVia}`);
    return id;
  },
});

export const update = mutation({
  args: { expenseId: v.id("expenses"), ...fields },
  handler: async (ctx, a) => {
    const { businessId, member, business } = await requireBusiness(ctx, "expenses");
    const e = await getOwned(ctx, businessId, a.expenseId);
    const category = str(a.category, 40);
    // an old category may have been removed from settings: keep it if unchanged
    if ((category !== e.category && !business.settings.expenseCategories.includes(category)) || a.paidVia === "CREDIT") fail("INVALID_INPUT");
    const amountCents = posInt(a.amountCents, 1e12);
    const shiftId = a.paidVia === "CASH" ? (e.shiftId ?? (await openShiftOf(ctx, member._id))?._id) : undefined;
    await ctx.db.patch(e._id, {
      category,
      amountCents,
      paidVia: a.paidVia,
      payee: optStr(a.payee) ?? "",
      note: optStr(a.note, 500) ?? "",
      shiftId,
      spentAt: ts(a.spentAt),
    });
    await audit(ctx, member, "expense.update", `${category} ${e.amountCents} -> ${amountCents}`);
  },
});

export const remove = mutation({
  args: { expenseId: v.id("expenses") },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "expenses");
    const e = await getOwned(ctx, businessId, a.expenseId);
    await ctx.db.delete(e._id);
    await audit(ctx, member, "expense.remove", `${e.category} ${e.amountCents}`);
  },
});
