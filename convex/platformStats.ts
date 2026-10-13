import { query } from "./_generated/server";
import { requirePlatform } from "./lib/access";
import { DAY_MS } from "./shared/expiry";

// ponytail: scans all businesses (+ one sales range query each) — fine for hundreds of tenants;
// switch to maintained counters when the platform grows.
export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatform(ctx);
    const now = Date.now();
    const monthStart = new Date(new Date(now).toISOString().slice(0, 8) + "01T00:00:00Z").getTime();
    const businesses = await ctx.db.query("businesses").collect();
    const plans = new Map((await ctx.db.query("plans").collect()).map((p) => [p._id, p]));

    const counts = { total: businesses.length, active: 0, suspended: 0, trial: 0, expired: 0 };
    let mrrCents = 0;
    let newBusinesses30d = 0;
    let gmvThisMonthCents = 0;
    const expiringIn7Days = [];
    for (const b of businesses) {
      if (b.createdAt >= now - 30 * DAY_MS) newBusinesses30d++;
      if (b.status === "SUSPENDED") counts.suspended++;
      else if (b.subscriptionEndsAt < now) counts.expired++;
      else if (b.subscriptionStatus === "TRIAL") counts.trial++;
      else {
        counts.active++;
        mrrCents += plans.get(b.planId)?.priceCents ?? 0;
      }
      if (b.status === "ACTIVE" && b.subscriptionEndsAt >= now && b.subscriptionEndsAt <= now + 7 * DAY_MS) {
        expiringIn7Days.push({
          _id: b._id,
          name: b.name,
          subscriptionEndsAt: b.subscriptionEndsAt,
          subscriptionStatus: b.subscriptionStatus,
          planName: plans.get(b.planId)?.name ?? "?",
        });
      }
      const sales = await ctx.db
        .query("sales")
        .withIndex("by_business_created", (q) => q.eq("businessId", b._id).gte("createdAt", monthStart))
        .collect();
      for (const s of sales) if (s.status === "COMPLETED") gmvThisMonthCents += s.totalCents;
    }
    expiringIn7Days.sort((x, y) => x.subscriptionEndsAt - y.subscriptionEndsAt);

    const payments = await ctx.db
      .query("subscriptionPayments")
      .withIndex("by_created", (q) => q.gte("createdAt", monthStart))
      .collect();
    const open = await ctx.db
      .query("tickets")
      .withIndex("by_status", (q) => q.eq("status", "OPEN"))
      .collect();

    return {
      businesses: counts,
      mrrCents,
      paymentsThisMonthCents: payments.reduce((n, p) => n + p.amountCents, 0),
      newBusinesses30d,
      expiringIn7Days,
      openTickets: open.length,
      gmvThisMonthCents,
    };
  },
});
