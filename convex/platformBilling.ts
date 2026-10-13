import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { audit, diff, fail, requirePlatform } from "./lib/access";
import { str, ts } from "./lib/validate";
import { DAY_MS } from "./shared/expiry";

const filters = {
  from: v.optional(v.number()),
  to: v.optional(v.number()),
  method: v.optional(v.string()),
  businessId: v.optional(v.id("businesses")),
};

/** Payments newest first, window in the index, method filtered after. Includes voided rows. */
function filtered(ctx: QueryCtx, a: { from?: number; to?: number; method?: string; businessId?: Id<"businesses"> }) {
  const from = a.from === undefined ? 0 : ts(a.from);
  const to = a.to === undefined ? 4.1e12 : ts(a.to);
  const { businessId, method } = a;
  const q = ctx.db.query("subscriptionPayments");
  return (
    businessId
      ? q.withIndex("by_business", (x) => x.eq("businessId", businessId).gte("createdAt", from).lte("createdAt", to))
      : q.withIndex("by_created", (x) => x.gte("createdAt", from).lte("createdAt", to))
  )
    .order("desc")
    .filter((f) => (method ? f.eq(f.field("method"), method) : true));
}

export const payments = query({
  args: { paginationOpts: paginationOptsValidator, ...filters },
  handler: async (ctx, { paginationOpts, ...a }) => {
    await requirePlatform(ctx);
    const res = await filtered(ctx, a).paginate(paginationOpts);
    const names = new Map<string, string>();
    const name = async (id: Id<"businesses"> | Id<"plans"> | Id<"members">) => {
      if (!names.has(id)) {
        const d = (await ctx.db.get(id as Id<"businesses">)) as { name?: string; fullName?: string } | null;
        names.set(id, d?.name ?? d?.fullName ?? "?");
      }
      return names.get(id)!;
    };
    const page = [];
    for (const p of res.page) {
      page.push({
        ...p,
        businessName: await name(p.businessId),
        planName: await name(p.planId),
        recordedByName: await name(p.recordedBy),
        isVoid: p.voidedAt !== undefined,
      });
    }
    return { ...res, page };
  },
});

/** Totals of the same filter, voided payments excluded. */
export const totals = query({
  args: filters,
  handler: async (ctx, a) => {
    await requirePlatform(ctx);
    // ponytail: first 5000 payments of the window; add a rollup table if a month ever exceeds it
    const rows = (await filtered(ctx, a).take(5000)).filter((p) => p.voidedAt === undefined);
    const byMethod = new Map<string, { cents: number; count: number }>();
    for (const p of rows) {
      const m = byMethod.get(p.method) ?? { cents: 0, count: 0 };
      m.cents += p.amountCents;
      m.count++;
      byMethod.set(p.method, m);
    }
    return {
      totalCents: rows.reduce((n, p) => n + p.amountCents, 0),
      count: rows.length,
      byMethod: [...byMethod].map(([method, m]) => ({ method, ...m })).sort((x, y) => y.cents - x.cents),
    };
  },
});

export const voidPayment = mutation({
  args: { paymentId: v.id("subscriptionPayments"), reason: v.string() },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx, ["SUPER_ADMIN"]);
    const p: Doc<"subscriptionPayments"> | null = await ctx.db.get(a.paymentId);
    if (!p || p.voidedAt !== undefined) fail("NOT_FOUND");
    const reason = str(a.reason, 500);
    const b = await ctx.db.get(p.businessId);
    if (!b) fail("NOT_FOUND");
    const now = Date.now();
    // take back the months this payment bought, but never push the end date earlier than yesterday (or raise it)
    const endsAt = Math.min(b.subscriptionEndsAt, Math.max(now - DAY_MS, b.subscriptionEndsAt - p.months * 30 * DAY_MS));
    await ctx.db.patch(p._id, { voidedAt: now, voidReason: reason, voidedBy: me._id });
    await ctx.db.patch(b._id, { subscriptionEndsAt: endsAt });
    const day = (t: number) => new Date(t).toISOString().slice(0, 10);
    await audit(ctx, me, "payment.void", `${p.amountCents} ${p.method}: ${reason}`, b._id, {
      targetId: p._id,
      targetName: b.name,
      changes: diff({ endsAt: day(b.subscriptionEndsAt) }, { endsAt: day(endsAt) }, ["endsAt"]),
    });
  },
});
