import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { audit, fail, getOwned, requireBusiness } from "./lib/access";
import { cents, posInt, optStr, str, ts } from "./lib/validate";

type Method = Doc<"sales">["payments"][number]["method"];
export const emptyByMethod = (): Record<Method, number> => ({ CASH: 0, EVC: 0, ZAAD: 0, EDAHAB: 0, BANK: 0, CREDIT: 0 });

const posOrSales = (ctx: QueryCtx) => requireBusiness(ctx, "pos").catch(() => requireBusiness(ctx, "sales"));

/** The member's currently open shift, if any. */
export async function openShiftOf(ctx: QueryCtx | MutationCtx, memberId: Id<"members">) {
  return await ctx.db
    .query("shifts")
    .withIndex("by_member_status", (q) => q.eq("memberId", memberId).eq("status", "OPEN"))
    .first();
}

// Expected cash = float + CASH payments − change + CASH customer repayments + cash IN − cash OUT − CASH refunds − CASH expenses.
// ponytail: caps of 5000 rows per shift; a shift never gets near that.
async function totals(ctx: QueryCtx, shift: Doc<"shifts">) {
  const sales = await ctx.db.query("sales").withIndex("by_shift", (q) => q.eq("shiftId", shift._id)).take(5000);
  const byMethod = emptyByMethod();
  let salesTotalCents = 0;
  for (const s of sales) {
    salesTotalCents += s.totalCents;
    for (const p of s.payments) byMethod[p.method] += p.amountCents;
    byMethod.CASH -= s.changeCents;
  }
  const refunds = await ctx.db.query("refunds").withIndex("by_shift", (q) => q.eq("shiftId", shift._id)).take(5000);
  const moves = await ctx.db.query("cashMovements").withIndex("by_shift", (q) => q.eq("shiftId", shift._id)).take(5000);
  const expenses = await ctx.db.query("expenses").withIndex("by_shift", (q) => q.eq("shiftId", shift._id)).take(5000);
  const sum = (xs: { amountCents: number }[]) => xs.reduce((n, x) => n + x.amountCents, 0);
  const repayments = await ctx.db.query("ledger").withIndex("by_shift", (q) => q.eq("shiftId", shift._id)).take(5000);
  const cashRepaymentsCents = sum(repayments.filter((l) => l.type === "PAYMENT" && l.method === "CASH"));
  const cashRefundsCents = sum(refunds.filter((r) => r.method === "CASH"));
  const cashInCents = sum(moves.filter((m) => m.type === "IN"));
  const cashOutCents = sum(moves.filter((m) => m.type === "OUT"));
  const cashExpensesCents = sum(expenses.filter((e) => e.paidVia === "CASH"));
  return {
    salesCount: sales.length,
    salesTotalCents,
    byMethod,
    cashSalesCents: byMethod.CASH,
    refunds,
    refundsCents: sum(refunds),
    cashRefundsCents,
    cashRepaymentsCents,
    moves,
    cashInCents,
    cashOutCents,
    expenses,
    cashExpensesCents,
    expectedCashCents:
      shift.openingFloatCents + byMethod.CASH + cashRepaymentsCents + cashInCents - cashOutCents - cashRefundsCents - cashExpensesCents,
  };
}

async function zReport(ctx: QueryCtx, shift: Doc<"shifts">) {
  const t = await totals(ctx, shift);
  const expectedCashCents = shift.status === "CLOSED" ? (shift.expectedCashCents ?? t.expectedCashCents) : t.expectedCashCents;
  const countedCashCents = shift.countedCashCents ?? null;
  return { shift, ...t, expectedCashCents, countedCashCents, differenceCents: countedCashCents === null ? null : countedCashCents - expectedCashCents };
}

export const current = query({
  args: {},
  handler: async (ctx) => {
    const { member } = await requireBusiness(ctx, "pos");
    const shift = await openShiftOf(ctx, member._id);
    if (!shift) return null;
    const { refunds, moves, expenses, ...live } = await totals(ctx, shift);
    return { shift, ...live };
  },
});

export const open = mutation({
  args: { openingFloatCents: v.number() },
  handler: async (ctx, a) => {
    const { member, businessId } = await requireBusiness(ctx, "pos");
    const openingFloatCents = cents(a.openingFloatCents);
    if (await openShiftOf(ctx, member._id)) fail("SHIFT_ALREADY_OPEN");
    const id = await ctx.db.insert("shifts", {
      businessId,
      memberId: member._id,
      memberName: member.fullName,
      status: "OPEN",
      openingFloatCents,
      openedAt: Date.now(),
    });
    await audit(ctx, member, "shift.open", `float=${openingFloatCents}`);
    return id;
  },
});

export const cashMove = mutation({
  args: { type: v.union(v.literal("IN"), v.literal("OUT")), amountCents: v.number(), reason: v.string() },
  handler: async (ctx, a) => {
    const { member, businessId } = await requireBusiness(ctx, "pos");
    const shift = await openShiftOf(ctx, member._id);
    if (!shift) fail("SHIFT_REQUIRED");
    const amountCents = posInt(a.amountCents, 1e12);
    const reason = str(a.reason, 200);
    await ctx.db.insert("cashMovements", {
      businessId,
      shiftId: shift._id,
      type: a.type,
      amountCents,
      reason,
      memberId: member._id,
      createdAt: Date.now(),
    });
    await audit(ctx, member, "shift.cashMove", `${a.type} ${amountCents} ${reason}`);
  },
});

export const close = mutation({
  args: { countedCashCents: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { member } = await requireBusiness(ctx, "pos");
    const shift = await openShiftOf(ctx, member._id);
    if (!shift) fail("SHIFT_REQUIRED");
    const countedCashCents = cents(a.countedCashCents);
    const { expectedCashCents } = await totals(ctx, shift);
    await ctx.db.patch(shift._id, {
      status: "CLOSED",
      closedAt: Date.now(),
      expectedCashCents,
      countedCashCents,
      note: optStr(a.note, 500),
    });
    await audit(ctx, member, "shift.close", `expected=${expectedCashCents} counted=${countedCashCents}`);
    return await zReport(ctx, (await ctx.db.get(shift._id))!);
  },
});

export const list = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, a) => {
    const { businessId } = await requireBusiness(ctx, "sales");
    ts(a.from);
    ts(a.to);
    const shifts = await ctx.db
      .query("shifts")
      .withIndex("by_business_opened", (q) => q.eq("businessId", businessId).gte("openedAt", a.from).lte("openedAt", a.to))
      .order("desc")
      .take(500);
    return shifts.map((s) => ({
      ...s,
      differenceCents: s.countedCashCents === undefined || s.expectedCashCents === undefined ? null : s.countedCashCents - s.expectedCashCents,
    }));
  },
});

export const report = query({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, a) => {
    const { businessId, member, role } = await posOrSales(ctx);
    const shift = await getOwned(ctx, businessId, a.shiftId);
    if (role === "CASHIER" && shift.memberId !== member._id) fail("FORBIDDEN"); // cashiers see only their own Z-report
    return await zReport(ctx, shift);
  },
});
