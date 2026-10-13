import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { audit, fail, lockReason, requirePlatform } from "./lib/access";
import { cents, optStr, posInt, str } from "./lib/validate";
import { DAY_MS } from "./shared/expiry";

type Biz = Doc<"businesses">;

function derivedStatus(b: Biz, now: number) {
  if (b.status === "SUSPENDED") return "SUSPENDED";
  if (b.subscriptionEndsAt < now) return "EXPIRED";
  return b.subscriptionStatus === "TRIAL" ? "TRIAL" : "ACTIVE";
}

export const list = query({
  args: {
    search: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("ACTIVE"), v.literal("SUSPENDED"), v.literal("TRIAL"), v.literal("EXPIRED")),
    ),
  },
  handler: async (ctx, a) => {
    await requirePlatform(ctx);
    const now = Date.now();
    const needle = a.search?.trim().toLowerCase();
    // platform side may scan; ponytail: first 1000 businesses, add search index if the platform outgrows it
    let rows = await ctx.db.query("businesses").order("desc").take(1000);
    if (a.status) rows = rows.filter((b) => derivedStatus(b, now) === a.status);
    if (needle) {
      rows = rows.filter((b) => [b.name, b.phone, b.city, b.email ?? ""].some((s) => s.toLowerCase().includes(needle)));
    }
    const plans = new Map<Id<"plans">, string>();
    for (const p of await ctx.db.query("plans").collect()) plans.set(p._id, p.name);
    return await Promise.all(
      rows.map(async (b) => {
        const members = await ctx.db
          .query("members")
          .withIndex("by_business", (q) => q.eq("businessId", b._id))
          .collect();
        const owner = members.find((m) => m.role === "OWNER");
        return {
          ...b,
          logoUrl: b.logoId ? await ctx.storage.getUrl(b.logoId) : null,
          planName: plans.get(b.planId) ?? "?",
          ownerName: owner?.fullName ?? null,
          ownerUsername: owner?.username ?? null,
          staffCount: members.length,
          lockReason: lockReason(b, now),
        };
      }),
    );
  },
});

export const get = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, a) => {
    await requirePlatform(ctx);
    const business = await ctx.db.get(a.businessId);
    if (!business) fail("NOT_FOUND");
    const id = business._id;
    const staff = await ctx.db
      .query("members")
      .withIndex("by_business", (q) => q.eq("businessId", id))
      .collect();
    const since = Date.now() - 30 * DAY_MS;
    const sales = await ctx.db
      .query("sales")
      .withIndex("by_business_created", (q) => q.eq("businessId", id).gte("createdAt", since))
      .take(10_000);
    const completed = sales.filter((s) => s.status === "COMPLETED");
    const products = await ctx.db
      .query("products")
      .withIndex("by_business", (q) => q.eq("businessId", id))
      .take(100_000);
    const customers = await ctx.db
      .query("customers")
      .withIndex("by_business", (q) => q.eq("businessId", id))
      .take(100_000);
    return {
      business,
      logoUrl: business.logoId ? await ctx.storage.getUrl(business.logoId) : null,
      plan: await ctx.db.get(business.planId),
      owner: staff.find((m) => m.role === "OWNER") ?? null,
      staff,
      stats: {
        products: products.length,
        customers: customers.length,
        sales30dCents: completed.reduce((n, s) => n + s.totalCents, 0),
        sales30dCount: completed.length,
      },
      payments: await ctx.db
        .query("subscriptionPayments")
        .withIndex("by_business", (q) => q.eq("businessId", id))
        .order("desc")
        .take(50),
      audit: await ctx.db
        .query("auditLog")
        .withIndex("by_business", (q) => q.eq("businessId", id))
        .order("desc")
        .take(50),
    };
  },
});

async function loadBusiness(ctx: { db: { get: (id: Id<"businesses">) => Promise<Biz | null> } }, id: Id<"businesses">) {
  const b = await ctx.db.get(id);
  if (!b) fail("NOT_FOUND");
  return b;
}

export const suspend = mutation({
  args: { businessId: v.id("businesses"), reason: v.string() },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const b = await loadBusiness(ctx, a.businessId);
    const reason = str(a.reason, 500);
    await ctx.db.patch(b._id, { status: "SUSPENDED", suspendedReason: reason });
    await audit(ctx, me, "business.suspend", reason, b._id);
  },
});

export const activate = mutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const b = await loadBusiness(ctx, a.businessId);
    await ctx.db.patch(b._id, { status: "ACTIVE", suspendedReason: undefined });
    await audit(ctx, me, "business.activate", undefined, b._id);
  },
});

export const changePlan = mutation({
  args: { businessId: v.id("businesses"), planId: v.id("plans") },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const b = await loadBusiness(ctx, a.businessId);
    const plan = await ctx.db.get(a.planId);
    if (!plan) fail("NOT_FOUND");
    await ctx.db.patch(b._id, { planId: plan._id });
    await audit(ctx, me, "business.changePlan", plan.name, b._id);
  },
});

export const extend = mutation({
  args: { businessId: v.id("businesses"), days: v.number() },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const b = await loadBusiness(ctx, a.businessId);
    const days = posInt(a.days, 3650);
    const now = Date.now();
    await ctx.db.patch(b._id, { subscriptionEndsAt: Math.max(now, b.subscriptionEndsAt) + days * DAY_MS });
    await audit(ctx, me, "business.extend", `${days} days`, b._id);
  },
});

export const recordPayment = mutation({
  args: {
    businessId: v.id("businesses"),
    planId: v.id("plans"),
    amountCents: v.number(),
    months: v.number(),
    method: v.string(),
    reference: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const b = await loadBusiness(ctx, a.businessId);
    const plan = await ctx.db.get(a.planId);
    if (!plan) fail("NOT_FOUND");
    const amountCents = cents(a.amountCents);
    const months = posInt(a.months, 60);
    const method = str(a.method, 30);
    const now = Date.now();
    await ctx.db.insert("subscriptionPayments", {
      businessId: b._id,
      planId: plan._id,
      amountCents,
      months,
      method,
      reference: optStr(a.reference, 100),
      recordedBy: me._id,
      createdAt: now,
    });
    await ctx.db.patch(b._id, {
      planId: plan._id,
      subscriptionStatus: "ACTIVE",
      subscriptionEndsAt: Math.max(now, b.subscriptionEndsAt) + months * 30 * DAY_MS,
    });
    await audit(ctx, me, "business.payment", `${plan.name} ${months}mo ${amountCents} ${method}`, b._id);
  },
});
