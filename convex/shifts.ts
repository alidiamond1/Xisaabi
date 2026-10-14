import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { audit, fail, getOwned, requireBusiness } from "./lib/access";
import { cents, posInt, optStr, str, ts } from "./lib/validate";
import { paymentMethod } from "./schema";

type Method = Doc<"sales">["payments"][number]["method"];
export const emptyByMethod = (): Record<Method, number> => ({ CASH: 0, EVC: 0, ZAAD: 0, EDAHAB: 0, BANK: 0, CREDIT: 0 });

/** Money methods tracked per shift, mobile money first (local habit). CREDIT is debt, not money. */
export const SHIFT_METHODS = ["EVC", "ZAAD", "EDAHAB", "CASH", "BANK"] as const;
type MoneyMethod = (typeof SHIFT_METHODS)[number];

const posOrSales = (ctx: QueryCtx) => requireBusiness(ctx, "pos").catch(() => requireBusiness(ctx, "sales"));

/** The member's currently open shift, if any. */
export async function openShiftOf(ctx: QueryCtx | MutationCtx, memberId: Id<"members">) {
  return await ctx.db
    .query("shifts")
    .withIndex("by_member_status", (q) => q.eq("memberId", memberId).eq("status", "OPEN"))
    .first();
}

// Expected per method = payments (CASH net of change) + customer repayments − refunds − expenses paid that way;
// CASH also + float + cash IN − cash OUT.
// ponytail: caps of 5000 rows per shift; a shift never gets near that.
async function totals(ctx: QueryCtx, shift: Doc<"shifts">) {
  const sales = await ctx.db.query("sales").withIndex("by_shift", (q) => q.eq("shiftId", shift._id)).take(5000);
  const byMethod = emptyByMethod();
  let salesTotalCents = 0;
  const lines = new Map<string, { name: string; unitName?: string; qty: number; totalCents: number }>();
  for (const s of sales) {
    salesTotalCents += s.totalCents;
    for (const p of s.payments) byMethod[p.method] += p.amountCents;
    byMethod.CASH -= s.changeCents;
    for (const i of s.items) {
      const k = `${i.name}|${i.unitName ?? ""}`;
      const l = lines.get(k) ?? { name: i.name, unitName: i.unitName, qty: 0, totalCents: 0 };
      l.qty += i.qty;
      l.totalCents += Math.round(i.priceCents * i.qty) - i.discountCents;
      lines.set(k, l);
    }
  }
  const itemsSold = [...lines.values()].sort((x, y) => y.totalCents - x.totalCents).slice(0, 30);
  const refunds = await ctx.db.query("refunds").withIndex("by_shift", (q) => q.eq("shiftId", shift._id)).take(5000);
  const moves = await ctx.db.query("cashMovements").withIndex("by_shift", (q) => q.eq("shiftId", shift._id)).take(5000);
  const expenses = await ctx.db.query("expenses").withIndex("by_shift", (q) => q.eq("shiftId", shift._id)).take(5000);
  const ledger = await ctx.db.query("ledger").withIndex("by_shift", (q) => q.eq("shiftId", shift._id)).take(5000);
  const sum = (xs: { amountCents: number }[]) => xs.reduce((n, x) => n + x.amountCents, 0);
  const repaymentsByMethod = emptyByMethod();
  for (const l of ledger) if (l.type === "PAYMENT" && l.method) repaymentsByMethod[l.method] += l.amountCents;
  const refundsByMethod = emptyByMethod();
  for (const r of refunds) refundsByMethod[r.method] += r.amountCents;
  const expensesByMethod = emptyByMethod();
  for (const e of expenses) expensesByMethod[e.paidVia] += e.amountCents;
  const cashInCents = sum(moves.filter((m) => m.type === "IN"));
  const cashOutCents = sum(moves.filter((m) => m.type === "OUT"));
  const expectedByMethod = {} as Record<MoneyMethod, number>;
  for (const m of SHIFT_METHODS) expectedByMethod[m] = byMethod[m] + repaymentsByMethod[m] - refundsByMethod[m] - expensesByMethod[m];
  expectedByMethod.CASH += shift.openingFloatCents + cashInCents - cashOutCents;
  return {
    salesCount: sales.length,
    salesTotalCents,
    byMethod,
    creditGivenCents: byMethod.CREDIT,
    cashSalesCents: byMethod.CASH,
    refunds,
    refundsCents: sum(refunds),
    refundsByMethod,
    cashRefundsCents: refundsByMethod.CASH,
    repaymentsByMethod,
    cashRepaymentsCents: repaymentsByMethod.CASH,
    moves,
    cashInCents,
    cashOutCents,
    expenses,
    expensesCents: sum(expenses),
    cashExpensesCents: expensesByMethod.CASH,
    itemsSold,
    expectedByMethod,
    expectedCashCents: expectedByMethod.CASH,
  };
}

async function zReport(ctx: QueryCtx, shift: Doc<"shifts">) {
  const t = await totals(ctx, shift);
  const closed = shift.status === "CLOSED";
  const stored = (xs?: { method: string; amountCents: number }[]) => new Map((xs ?? []).map((x) => [x.method, x.amountCents]));
  const exp = stored(shift.expectedByMethod);
  const cnt = stored(shift.countedByMethod);
  const expectedCashCents = closed ? (shift.expectedCashCents ?? t.expectedCashCents) : t.expectedCashCents;
  const countedCashCents = shift.countedCashCents ?? null;
  const methods = SHIFT_METHODS.map((method) => {
    const expected = method === "CASH" ? expectedCashCents : closed ? (exp.get(method) ?? t.expectedByMethod[method]) : t.expectedByMethod[method];
    const counted = method === "CASH" ? countedCashCents : (cnt.get(method) ?? null);
    return { method, expected, counted, difference: counted === null ? null : counted - expected };
  }).filter((r) => r.method === "CASH" || r.expected !== 0 || r.counted !== null);
  return { blind: false as const, shift, ...t, expectedCashCents, countedCashCents, differenceCents: countedCashCents === null ? null : countedCashCents - expectedCashCents, methods };
}

export const current = query({
  args: {},
  handler: async (ctx) => {
    const { member, role } = await requireBusiness(ctx, "pos");
    const shift = await openShiftOf(ctx, member._id);
    if (!shift) return null;
    // blind count: a cashier must not see what the drawer should hold until the shift is closed
    if (role === "CASHIER") return { blind: true as const, shift, salesCount: (await totals(ctx, shift)).salesCount };
    const { refunds, moves, expenses, ...live } = await totals(ctx, shift);
    return { blind: false as const, shift, ...live };
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
  args: {
    countedCashCents: v.number(),
    counted: v.optional(v.array(v.object({ method: paymentMethod, amountCents: v.number() }))), // non-cash totals the cashier sees in their apps
    note: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const { member } = await requireBusiness(ctx, "pos");
    const shift = await openShiftOf(ctx, member._id);
    if (!shift) fail("SHIFT_REQUIRED");
    const countedCashCents = cents(a.countedCashCents);
    const countedByMethod = (a.counted ?? []).map((c) => ({ method: c.method, amountCents: cents(c.amountCents) }));
    if (countedByMethod.some((c, i) => c.method === "CASH" || c.method === "CREDIT" || countedByMethod.findIndex((x) => x.method === c.method) !== i)) fail("INVALID_INPUT");
    const { expectedCashCents, expectedByMethod } = await totals(ctx, shift);
    await ctx.db.patch(shift._id, {
      status: "CLOSED",
      closedAt: Date.now(),
      expectedCashCents,
      countedCashCents,
      expectedByMethod: SHIFT_METHODS.map((method) => ({ method, amountCents: expectedByMethod[method] })),
      countedByMethod,
      note: optStr(a.note, 500),
    });
    const other = countedByMethod.map((c) => `${c.method}:${c.amountCents}`).join(",");
    await audit(ctx, member, "shift.close", `expected=${expectedCashCents} counted=${countedCashCents} other=${other}`);
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
    return shifts.map((s) => {
      const exp = new Map((s.expectedByMethod ?? []).map((x) => [x.method, x.amountCents]));
      const differences = (s.countedByMethod ?? []).map((c) => ({ method: c.method, differenceCents: c.amountCents - (exp.get(c.method) ?? 0) }));
      const differenceCents = s.countedCashCents === undefined || s.expectedCashCents === undefined ? null : s.countedCashCents - s.expectedCashCents;
      if (differenceCents !== null) differences.push({ method: "CASH", differenceCents });
      const totalDifferenceCents = differences.length ? differences.reduce((n, d) => n + d.differenceCents, 0) : null;
      return { ...s, differenceCents, differences, totalDifferenceCents };
    });
  },
});

export const report = query({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, a) => {
    const { businessId, member, role } = await posOrSales(ctx);
    const shift = await getOwned(ctx, businessId, a.shiftId);
    if (role === "CASHIER" && shift.memberId !== member._id) fail("FORBIDDEN"); // cashiers see only their own Z-report
    if (role === "CASHIER" && shift.status === "OPEN") return { blind: true as const, shift, salesCount: (await totals(ctx, shift)).salesCount };
    return await zReport(ctx, shift);
  },
});
