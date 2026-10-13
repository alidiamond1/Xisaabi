import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { audit, fail, requireBusiness } from "./lib/access";
import { optStr } from "./lib/validate";

const OPTS = { roles: ["OWNER" as const], allowLocked: true };

export const current = query({
  args: {},
  handler: async (ctx) => {
    const { business, businessId, plan } = await requireBusiness(ctx, "billing", OPTS);
    const members = await ctx.db
      .query("members")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .collect();
    const products = await ctx.db
      .query("products")
      .withIndex("by_business", (q) => q.eq("businessId", businessId).eq("isArchived", false))
      .take(100_000);
    const payments = await ctx.db
      .query("subscriptionPayments")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .order("desc")
      .take(50);
    return {
      plan,
      subscriptionStatus: business.subscriptionStatus,
      subscriptionEndsAt: business.subscriptionEndsAt,
      usage: { users: members.filter((m) => m.isActive).length, products: products.length },
      payments,
    };
  },
});

export const plans = query({
  args: {},
  handler: async (ctx) => {
    await requireBusiness(ctx, "billing", OPTS);
    const all = await ctx.db.query("plans").withIndex("by_sort").collect();
    return all.filter((p) => p.isActive);
  },
});

export const requestPlan = mutation({
  args: { planId: v.id("plans"), message: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { member, businessId } = await requireBusiness(ctx, "billing", OPTS);
    const plan = await ctx.db.get(a.planId);
    if (!plan || !plan.isActive) fail("NOT_FOUND");
    const message = optStr(a.message, 5000);
    const now = Date.now();
    const ticketId = await ctx.db.insert("tickets", {
      businessId,
      subject: `Upgrade request: ${plan.name}`,
      category: "BILLING",
      priority: "NORMAL",
      status: "OPEN",
      createdBy: member._id,
      unreadByPlatform: true,
      unreadByBusiness: false,
      lastMessageAt: now,
      createdAt: now,
    });
    await ctx.db.insert("ticketMessages", {
      ticketId,
      businessId,
      authorMemberId: member._id,
      authorName: member.fullName,
      fromPlatform: false,
      body: message ?? `We would like to switch to the ${plan.name} plan.`,
      createdAt: now,
    });
    await audit(ctx, member, "billing.requestPlan", plan.name);
    return ticketId;
  },
});
