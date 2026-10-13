import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { fail, requirePlatform } from "./lib/access";
import { limiter } from "./lib/limiter";
import { DAY_MS } from "./shared/expiry";
import { healthOf, type Health } from "./shared/health";

const PAGE = 500; // sales per page: keeps one mutation inside the read limits
const CAP = 1000; // ponytail: product/customer counts stop here; add counters if a tenant outgrows it

const monthStartOf = (t: number, offset = 0) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1);
};

// ── rollup (cron hourly + "Refresh now") ──

export const refreshAll = internalMutation({
  args: {},
  handler: async (ctx): Promise<null> => {
    // ponytail: first 1000 businesses (also the scheduler's per-mutation limit); shard if the platform outgrows it
    for (const b of await ctx.db.query("businesses").take(1000)) {
      await ctx.scheduler.runAfter(0, internal.platformStats.refreshOne, { businessId: b._id });
    }
    return null;
  },
});

export const refreshNow = mutation({
  args: {},
  handler: async (ctx): Promise<null> => {
    await requirePlatform(ctx);
    if (!(await limiter.limit(ctx, "statsRefresh")).ok) fail("RATE_LIMITED");
    await ctx.scheduler.runAfter(0, internal.platformStats.refreshAll, {});
    return null;
  },
});

const sums = v.object({ cents30d: v.number(), count30d: v.number(), gmvThis: v.number(), gmvLast: v.number() });

/** Walks the business's sales newest-first, a page per run, carrying running sums in `acc`. */
export const refreshOne = internalMutation({
  args: { businessId: v.id("businesses"), cursor: v.optional(v.string()), acc: v.optional(sums) },
  handler: async (ctx, a): Promise<null> => {
    const biz = await ctx.db.get(a.businessId);
    if (!biz) return null;
    const now = Date.now();
    const thisMonth = monthStartOf(now);
    const lastMonth = monthStartOf(now, -1);
    const since = Math.min(lastMonth, now - 30 * DAY_MS);
    const acc = a.acc ?? { cents30d: 0, count30d: 0, gmvThis: 0, gmvLast: 0 };

    const res = await ctx.db
      .query("sales")
      .withIndex("by_business_created", (q) => q.eq("businessId", biz._id).gte("createdAt", since))
      .order("desc")
      .paginate({ numItems: PAGE, cursor: a.cursor ?? null });
    for (const s of res.page) {
      if (s.status === "REFUNDED") continue;
      const net = s.totalCents - s.refundedCents;
      if (s.createdAt >= now - 30 * DAY_MS) {
        acc.cents30d += net;
        acc.count30d++;
      }
      if (s.createdAt >= thisMonth) acc.gmvThis += net;
      else if (s.createdAt >= lastMonth) acc.gmvLast += net;
    }
    if (!res.isDone) {
      await ctx.scheduler.runAfter(0, internal.platformStats.refreshOne, { businessId: biz._id, cursor: res.continueCursor, acc });
      return null;
    }

    const newest = await ctx.db
      .query("sales")
      .withIndex("by_business_created", (q) => q.eq("businessId", biz._id))
      .order("desc")
      .first();
    const members = await ctx.db.query("members").withIndex("by_business", (q) => q.eq("businessId", biz._id)).take(200);
    let lastLoginAt: number | undefined;
    for (const m of members) {
      const s = await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", m.userId)).order("desc").first();
      if (s && (lastLoginAt === undefined || s._creationTime > lastLoginAt)) lastLoginAt = s._creationTime;
    }
    const products = await ctx.db
      .query("products")
      .withIndex("by_business", (q) => q.eq("businessId", biz._id).eq("isArchived", false))
      .take(CAP);
    const customers = await ctx.db.query("customers").withIndex("by_business", (q) => q.eq("businessId", biz._id)).take(CAP);

    const row = {
      businessId: biz._id,
      lastSaleAt: newest?.createdAt,
      lastLoginAt,
      sales30dCents: acc.cents30d,
      sales30dCount: acc.count30d,
      gmvThisMonthCents: acc.gmvThis,
      gmvLastMonthCents: acc.gmvLast,
      products: products.length,
      customers: customers.length,
      staff: members.filter((m) => m.isActive).length,
      updatedAt: now,
    };
    const cur = await ctx.db.query("businessStats").withIndex("by_business", (q) => q.eq("businessId", biz._id)).first();
    if (cur) await ctx.db.replace(cur._id, row);
    else await ctx.db.insert("businessStats", row);
    return null;
  },
});

// ── dashboard ──

const countBy = (keys: string[]) => {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].map(([key, count]) => ({ key, count })).sort((x, y) => y.count - x.count);
};

export const overview = query({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    await requirePlatform(ctx);
    // ponytail: platform side may scan; first 1000 businesses / 5000 payments, then move to counters
    const businesses = await ctx.db.query("businesses").take(1000);
    const plans = new Map((await ctx.db.query("plans").take(100)).map((p) => [p._id, p]));
    const stats = new Map<Id<"businesses">, Doc<"businessStats">>();
    for (const s of await ctx.db.query("businessStats").take(1000)) stats.set(s.businessId, s);
    const payments = (await ctx.db.query("subscriptionPayments").withIndex("by_created").order("desc").take(5000)).filter(
      (p) => p.voidedAt === undefined,
    );

    const planName = (b: Doc<"businesses">) => plans.get(b.planId)?.name ?? "?";
    const counts = { total: businesses.length, active: 0, suspended: 0, trial: 0, expired: 0 };
    const health: Record<Health, number> = { ACTIVE: 0, QUIET: 0, DORMANT: 0, NEW: 0 };
    let mrrCents = 0;
    let newBusinesses30d = 0;
    let churned30d = 0;
    let gmvThisMonthCents = 0;
    let gmvLastMonthCents = 0;
    const expiringIn7Days = [];
    const overdue = [];
    const atRisk = [];
    const payers = new Set(payments.map((p) => p.businessId));
    let old = 0;
    let oldPaid = 0;
    for (const b of businesses) {
      const st = stats.get(b._id);
      const h = healthOf(b.createdAt, st?.lastSaleAt, now);
      health[h]++;
      gmvThisMonthCents += st?.gmvThisMonthCents ?? 0;
      gmvLastMonthCents += st?.gmvLastMonthCents ?? 0;
      if (b.createdAt >= now - 30 * DAY_MS) newBusinesses30d++;
      if (b.createdAt <= now - 14 * DAY_MS) {
        old++;
        if (payers.has(b._id)) oldPaid++;
      }
      if (b.status === "SUSPENDED") counts.suspended++;
      else if (b.subscriptionEndsAt < now) {
        counts.expired++;
        overdue.push({ _id: b._id, name: b.name, planName: planName(b), subscriptionStatus: b.subscriptionStatus, subscriptionEndsAt: b.subscriptionEndsAt });
        // churn = a paying business (subscriptionStatus ACTIVE) whose period ended in the last 30 days
        if (b.subscriptionStatus === "ACTIVE" && b.subscriptionEndsAt >= now - 30 * DAY_MS) churned30d++;
      } else if (b.subscriptionStatus === "TRIAL") counts.trial++;
      else {
        counts.active++;
        mrrCents += plans.get(b.planId)?.priceCents ?? 0;
        if (h === "DORMANT" || h === "QUIET") atRisk.push({ _id: b._id, name: b.name, planName: planName(b), health: h, lastSaleAt: st?.lastSaleAt ?? null });
      }
      if (b.status === "ACTIVE" && b.subscriptionEndsAt >= now && b.subscriptionEndsAt <= now + 7 * DAY_MS) {
        expiringIn7Days.push({ _id: b._id, name: b.name, planName: planName(b), subscriptionStatus: b.subscriptionStatus, subscriptionEndsAt: b.subscriptionEndsAt });
      }
    }
    expiringIn7Days.sort((x, y) => x.subscriptionEndsAt - y.subscriptionEndsAt);
    overdue.sort((x, y) => y.subscriptionEndsAt - x.subscriptionEndsAt);

    // last 12 months, oldest first
    const series = Array.from({ length: 12 }, (_, i) => {
      const from = monthStartOf(now, i - 11);
      const to = monthStartOf(now, i - 10);
      return {
        month: new Date(from).toISOString().slice(0, 7),
        signups: businesses.filter((b) => b.createdAt >= from && b.createdAt < to).length,
        collectedCents: payments.filter((p) => p.createdAt >= from && p.createdAt < to).reduce((n, p) => n + p.amountCents, 0),
      };
    });

    const open = await ctx.db.query("tickets").withIndex("by_status", (q) => q.eq("status", "OPEN")).take(1000);
    const waiting = open.filter((t) => t.unreadByPlatform).map((t) => t.lastMessageAt);
    const topByGmv = businesses
      .map((b) => ({ _id: b._id, name: b.name, sales30dCents: stats.get(b._id)?.sales30dCents ?? 0, sales30dCount: stats.get(b._id)?.sales30dCount ?? 0 }))
      .filter((b) => b.sales30dCents > 0)
      .sort((x, y) => y.sales30dCents - x.sales30dCents)
      .slice(0, 10);

    return {
      counts,
      mrrCents,
      arrCents: mrrCents * 12,
      payingCount: counts.active,
      trialConversionPercent: old ? Math.round((oldPaid / old) * 100) : 0,
      churned30d,
      newBusinesses30d,
      collectedThisMonthCents: series[11].collectedCents,
      collectedLastMonthCents: series[10].collectedCents,
      gmvThisMonthCents,
      gmvLastMonthCents,
      health,
      openTickets: open.length,
      oldestWaitingTicketAt: waiting.length ? Math.min(...waiting) : null,
      series,
      expiringIn7Days: expiringIn7Days.slice(0, 50),
      overdue: overdue.slice(0, 50),
      atRisk: atRisk.slice(0, 50),
      topByGmv,
      byType: countBy(businesses.map((b) => b.businessType)),
      byPlan: countBy(businesses.map(planName)),
      byCity: countBy(businesses.map((b) => b.city)),
    };
  },
});
