import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { fail, requireBusiness, requirePermission } from "./lib/access";
import { roundQty } from "./lib/stock";
import { ts } from "./lib/validate";
import { DAY_MS } from "./shared/expiry";
import { hasPermission } from "./shared/permissions";
import { mulDiv } from "./sales";
import { emptyByMethod } from "./shifts";

// ponytail: reads at most 8000 sales / 2000 refunds per call (range capped to 366 days); pre-aggregate if shops outgrow it.
const SALES_CAP = 8000;

/** "YYYY-MM-DD" of a timestamp in the viewer's timezone (offset in minutes east of UTC). */
function dayKey(t: number, tzMin: number) {
  return new Date(t + tzMin * 60_000).toISOString().slice(0, 10);
}

const tzOf = (n?: number) => Math.max(-840, Math.min(840, Math.trunc(n ?? 0)));

function range(a: { from: number; to: number }) {
  ts(a.from);
  ts(a.to);
  if (a.to < a.from || a.to - a.from > 366 * DAY_MS) fail("INVALID_INPUT");
}

const salesIn = (ctx: QueryCtx, businessId: Id<"businesses">, a: { from: number; to: number }) =>
  ctx.db
    .query("sales")
    .withIndex("by_business_created", (q) => q.eq("businessId", businessId).gte("createdAt", a.from).lte("createdAt", a.to))
    .take(SALES_CAP);

const saleCost = (s: Doc<"sales">) => s.items.reduce((n, i) => n + Math.round(i.costCents * i.qty), 0);

/**
 * Refunds made in the range, valued net of tax (like revenue), plus the cost of goods that went back on the shelf.
 */
async function refundsIn(ctx: QueryCtx, businessId: Id<"businesses">, a: { from: number; to: number }) {
  const rows = await ctx.db
    .query("refunds")
    .withIndex("by_business_created", (q) => q.eq("businessId", businessId).gte("createdAt", a.from).lte("createdAt", a.to))
    .take(2000);
  const cache = new Map<Id<"sales">, Doc<"sales"> | null>();
  const out: { r: Doc<"refunds">; netCents: number; returnedCostCents: number }[] = [];
  for (const r of rows) {
    if (!cache.has(r.saleId)) {
      const s = await ctx.db.get(r.saleId);
      cache.set(r.saleId, s && s.businessId === businessId ? s : null);
    }
    const s = cache.get(r.saleId);
    if (!s) continue;
    const returnedCostCents = r.items.reduce((n, i) => {
      const it = s.items.find((x) => x.productId === i.productId && x.unitName === i.unitName);
      return n + (i.restock && it ? Math.round(it.costCents * i.qty) : 0);
    }, 0);
    out.push({ r, netCents: mulDiv(r.amountCents, s.subtotalCents - s.discountCents, s.totalCents), returnedCostCents });
  }
  return out;
}

// Revenue = subtotal − order discount (net of tax). Refunds are counted on the day they were made, net of tax.
// byPaymentMethod = money collected per method incl. tax, minus refunds paid out by that method (CASH net of change).
export const summary = query({
  args: { from: v.number(), to: v.number(), tzOffsetMinutes: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "reports");
    range(a);
    const seeCost = hasPermission(member, "seeCost");
    const tz = tzOf(a.tzOffsetMinutes);
    const sales = await salesIn(ctx, businessId, a);
    const refunds = await refundsIn(ctx, businessId, a);

    let revenueCents = 0;
    let costCents = 0;
    let discountsCents = 0;
    const byPaymentMethod = emptyByMethod();
    const products = new Map<string, { name: string; qty: number; revenueCents: number }>();
    const daily = new Map<string, { revenueCents: number; profitCents: number }>();
    for (let t = a.from; t <= a.to; t += DAY_MS) daily.set(dayKey(t, tz), { revenueCents: 0, profitCents: 0 });
    const day = (t: number) => {
      const k = dayKey(t, tz);
      const d = daily.get(k) ?? { revenueCents: 0, profitCents: 0 };
      daily.set(k, d);
      return d;
    };

    for (const s of sales) {
      const rev = s.subtotalCents - s.discountCents;
      const cost = saleCost(s);
      revenueCents += rev;
      costCents += cost;
      discountsCents += s.discountCents;
      for (const it of s.items) {
        discountsCents += it.discountCents;
        const p = products.get(it.productId) ?? { name: it.name, qty: 0, revenueCents: 0 };
        p.qty = roundQty(p.qty + it.qty * (it.unitFactor ?? 1));
        p.revenueCents += Math.round(it.priceCents * it.qty) - it.discountCents;
        products.set(it.productId, p);
      }
      for (const p of s.payments) byPaymentMethod[p.method] += p.amountCents;
      byPaymentMethod.CASH -= s.changeCents;
      const d = day(s.createdAt);
      d.revenueCents += rev;
      d.profitCents += rev - cost;
    }
    let refundsCents = 0;
    for (const { r, netCents, returnedCostCents } of refunds) {
      refundsCents += netCents;
      costCents -= returnedCostCents;
      byPaymentMethod[r.method] -= r.amountCents;
      const d = day(r.createdAt);
      d.revenueCents -= netCents;
      d.profitCents -= netCents - returnedCostCents;
    }

    const expenses = await ctx.db
      .query("expenses")
      .withIndex("by_business_spent", (q) => q.eq("businessId", businessId).gte("spentAt", a.from).lte("spentAt", a.to))
      .take(8000);
    const expensesCents = expenses.reduce((n, e) => n + e.amountCents, 0);
    const debtors = await ctx.db
      .query("customers")
      .withIndex("by_business_balance", (q) => q.eq("businessId", businessId).gt("balanceCents", 0))
      .take(5000);

    const grossProfitCents = revenueCents - refundsCents - costCents;
    return {
      revenueCents,
      refundsCents,
      // cost / profit only with the seeCost permission
      costCents: seeCost ? costCents : null,
      grossProfitCents: seeCost ? grossProfitCents : null,
      expensesCents,
      netProfitCents: seeCost ? grossProfitCents - expensesCents : null,
      salesCount: sales.length,
      refundsCount: refunds.length,
      discountsCents,
      byPaymentMethod,
      topProducts: [...products.values()].sort((x, y) => y.revenueCents - x.revenueCents).slice(0, 10),
      daily: [...daily.entries()]
        .sort(([x], [y]) => (x < y ? -1 : 1))
        .map(([date, d]) => ({ date, revenueCents: d.revenueCents, profitCents: seeCost ? d.profitCents : null })),
      outstandingDebtCents: debtors.reduce((n, c) => n + c.balanceCents, 0),
    };
  },
});

export const profitAndLoss = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "reports");
    requirePermission(member, "seeCost");
    range(a);
    const sales = await salesIn(ctx, businessId, a);
    const refunds = await refundsIn(ctx, businessId, a);
    const revenue = sales.reduce((n, s) => n + s.subtotalCents - s.discountCents, 0);
    const refundsNet = refunds.reduce((n, x) => n + x.netCents, 0);
    const cogs = sales.reduce((n, s) => n + saleCost(s), 0) - refunds.reduce((n, x) => n + x.returnedCostCents, 0);

    const expenses = await ctx.db
      .query("expenses")
      .withIndex("by_business_spent", (q) => q.eq("businessId", businessId).gte("spentAt", a.from).lte("spentAt", a.to))
      .take(8000);
    const byCat = new Map<string, number>();
    for (const e of expenses) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amountCents);

    // stock thrown away: write-offs and damaged/expired/lost adjustments, at cost
    const moves = await ctx.db
      .query("stockMovements")
      .withIndex("by_business_created", (q) => q.eq("businessId", businessId).gte("createdAt", a.from).lte("createdAt", a.to))
      .take(SALES_CAP);
    const writeOffsCostCents = moves
      .filter((m) => m.qty < 0 && (m.type === "WRITE_OFF" || (m.type === "ADJUSTMENT" && ["DAMAGED", "EXPIRED", "LOST"].includes(m.reason ?? ""))))
      .reduce((n, m) => n + Math.round(-m.qty * m.unitCostCents), 0);

    const netSales = revenue - refundsNet;
    const grossProfit = netSales - cogs;
    const totalExpenses = expenses.reduce((n, e) => n + e.amountCents, 0);
    return {
      revenueCents: revenue,
      refundsCents: refundsNet,
      netSalesCents: netSales,
      cogsCents: cogs,
      grossProfitCents: grossProfit,
      expensesByCategory: [...byCat.entries()].map(([category, amountCents]) => ({ category, amountCents })).sort((x, y) => y.amountCents - x.amountCents),
      totalExpensesCents: totalExpenses,
      writeOffsCostCents,
      netProfitCents: grossProfit - totalExpenses - writeOffsCostCents,
    };
  },
});

export const salesBy = query({
  args: {
    from: v.number(),
    to: v.number(),
    dimension: v.union(v.literal("product"), v.literal("category"), v.literal("cashier"), v.literal("customer"), v.literal("hour")),
    tzOffsetMinutes: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "reports");
    range(a);
    const seeCost = hasPermission(member, "seeCost");
    const tz = tzOf(a.tzOffsetMinutes);
    const sales = await salesIn(ctx, businessId, a);

    const catOf = new Map<Id<"products">, string>(); // productId -> category label
    if (a.dimension === "category") {
      const cats = new Map<string, string>();
      for (const c of await ctx.db.query("categories").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(1000)) cats.set(c._id, c.name);
      for (const id of new Set(sales.flatMap((s) => s.items.map((i) => i.productId)))) {
        const p = await ctx.db.get(id);
        catOf.set(id, p && p.businessId === businessId && p.categoryId ? (cats.get(p.categoryId) ?? "Uncategorized") : "Uncategorized");
      }
    }

    const rows = new Map<string, { key: string; label: string; qty: number; revenueCents: number; profitCents: number }>();
    for (const s of sales) {
      for (const it of s.items) {
        // line revenue net of its discount and its share of the order discount, ex tax, minus refunded units
        const net = Math.round(it.priceCents * it.qty) - it.discountCents;
        const eff = mulDiv(net, s.subtotalCents - s.discountCents, s.subtotalCents);
        const left = roundQty(it.qty - it.refundedQty);
        const rev = mulDiv(eff, Math.round(left * 1000), Math.round(it.qty * 1000));
        const [key, label] =
          a.dimension === "product" ? [it.productId as string, it.name]
          : a.dimension === "category" ? [catOf.get(it.productId)!, catOf.get(it.productId)!]
          : a.dimension === "cashier" ? [s.cashierId as string, s.cashierName]
          : a.dimension === "customer" ? [s.customerId ?? "walkin", s.customerName ?? "Walk-in"]
          : (() => { const h = new Date(s.createdAt + tz * 60_000).getUTCHours(); return [String(h), `${String(h).padStart(2, "0")}:00`]; })();
        const r = rows.get(key) ?? { key, label, qty: 0, revenueCents: 0, profitCents: 0 };
        r.qty = roundQty(r.qty + left * (it.unitFactor ?? 1));
        r.revenueCents += rev;
        r.profitCents += rev - Math.round(it.costCents * left);
        rows.set(key, r);
      }
    }
    const sorted = [...rows.values()].sort((x, y) => (a.dimension === "hour" ? Number(x.key) - Number(y.key) : y.revenueCents - x.revenueCents));
    return sorted.map((r) => ({ ...r, profitCents: seeCost ? r.profitCents : null }));
  },
});

export const debtors = query({
  args: {},
  handler: async (ctx) => {
    const { businessId } = await requireBusiness(ctx, "reports");
    const rows = await ctx.db
      .query("customers")
      .withIndex("by_business_balance", (q) => q.eq("businessId", businessId).gt("balanceCents", 0))
      .order("desc")
      .take(5000);
    const now = Date.now();
    return {
      customers: rows.map((c) => ({
        _id: c._id, fullName: c.fullName, phone: c.phone, whatsapp: c.whatsapp, balanceCents: c.balanceCents,
        creditLimitCents: c.creditLimitCents, lastPaymentAt: c.lastPaymentAt ?? null,
        daysSinceLastPayment: c.lastPaymentAt === undefined ? null : Math.floor((now - c.lastPaymentAt) / DAY_MS),
      })),
      totalCents: rows.reduce((n, c) => n + c.balanceCents, 0),
    };
  },
});

export const creditors = query({
  args: {},
  handler: async (ctx) => {
    const { businessId, plan } = await requireBusiness(ctx, "reports");
    if (!plan.modules.includes("purchases")) return { suppliers: [], totalCents: 0 };
    const rows = (await ctx.db.query("suppliers").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(2000))
      .filter((s) => s.balanceCents > 0)
      .sort((x, y) => y.balanceCents - x.balanceCents);
    return {
      suppliers: rows.map((s) => ({ _id: s._id, name: s.name, company: s.company, phone: s.phone, whatsapp: s.whatsapp, balanceCents: s.balanceCents })),
      totalCents: rows.reduce((n, s) => n + s.balanceCents, 0),
    };
  },
});
