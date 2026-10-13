import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireBusiness } from "./lib/access";
import { DAY_MS } from "./shared/expiry";
import { openShiftOf } from "./shifts";

// Any active member may call; only OWNER/MANAGER get numbers.
// "support" is open to exactly those two roles on every plan, and requireBusiness
// also throws when the business is locked -> null (launcher shows the banner instead).
export const home = query({
  args: { tzOffsetMinutes: v.optional(v.number()) },
  handler: async (ctx, a) => {
    let access;
    try {
      access = await requireBusiness(ctx, "support");
    } catch {
      return null;
    }
    const { businessId, member, plan } = access;
    const tz = Math.max(-840, Math.min(840, Math.trunc(a.tzOffsetMinutes ?? 0))) * 60_000;
    const now = Date.now();
    const todayStart = Math.floor((now + tz) / DAY_MS) * DAY_MS - tz;

    const today = await ctx.db
      .query("sales")
      .withIndex("by_business_created", (q) => q.eq("businessId", businessId).gte("createdAt", todayStart))
      .take(5000);
    const refundsToday = await ctx.db
      .query("refunds")
      .withIndex("by_business_created", (q) => q.eq("businessId", businessId).gte("createdAt", todayStart))
      .take(2000);

    const products = await ctx.db
      .query("products")
      .withIndex("by_business", (q) => q.eq("businessId", businessId).eq("isArchived", false))
      .take(5000);
    const debtors = await ctx.db
      .query("customers")
      .withIndex("by_business_balance", (q) => q.eq("businessId", businessId).gt("balanceCents", 0))
      .take(5000);
    const tickets = await ctx.db
      .query("tickets")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .order("desc")
      .take(200);
    const shift = await openShiftOf(ctx, member._id);
    let payablesCents: number | null = null;
    if (plan.modules.includes("purchases")) {
      const suppliers = await ctx.db.query("suppliers").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(2000);
      payablesCents = suppliers.reduce((n, s) => n + Math.max(s.balanceCents, 0), 0);
    }

    return {
      // net of refunds made today
      todaySalesCents: today.reduce((n, s) => n + s.totalCents, 0) - refundsToday.reduce((n, r) => n + r.amountCents, 0),
      todaySalesCount: today.filter((s) => s.status !== "REFUNDED").length,
      lowStockCount: products.filter((p) => p.type === "STOCKABLE" && !p.hasVariants && p.stock <= p.reorderLevel).length,
      outstandingDebtCents: debtors.reduce((n, c) => n + c.balanceCents, 0),
      openTickets: tickets.filter((t) => t.status !== "CLOSED").length,
      openShift: shift ? { _id: shift._id, openedAt: shift.openedAt, openingFloatCents: shift.openingFloatCents } : null,
      payablesCents,
    };
  },
});
