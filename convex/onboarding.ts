import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { DAY_MS } from "./shared/expiry";
import { fail } from "./lib/access";
import { limiter } from "./lib/limiter";
import { checkLogo, optStr, str } from "./lib/validate";
import { MAX_BUSINESS_TYPES, PRESETS, mergePresets } from "./shared/presets";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) fail("UNAUTHENTICATED");
    // only for the logo step of signup; existing owners use settings.generateUploadUrl
    const member = await ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (member) fail("ALREADY_ONBOARDED");
    if (!(await limiter.limit(ctx, "uploadOnboarding", { key: userId })).ok) fail("RATE_LIMITED");
    return await ctx.storage.generateUploadUrl();
  },
});

export const createBusiness = mutation({
  args: {
    fullName: v.string(),
    name: v.string(),
    businessType: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    address: v.string(),
    city: v.string(),
    country: v.string(),
    currency: v.string(),
    logoId: v.optional(v.id("_storage")),
    businessTypes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, a) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) fail("UNAUTHENTICATED");
    const existing = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) fail("ALREADY_ONBOARDED");
    const user = await ctx.db.get(userId);
    const username = user?.email;
    if (!username) fail("FORBIDDEN");
    // belt and braces: the auth account id must not already map to a member
    const taken = await ctx.db
      .query("members")
      .withIndex("by_username", (q) => q.eq("username", username))
      .first();
    if (taken) fail("USERNAME_TAKEN");

    const settings = await ctx.db.query("platformSettings").first();
    if (settings && !settings.signupsOpen) fail("SIGNUPS_CLOSED");

    const plans = await ctx.db.query("plans").collect();
    const plan = plans.find((p) => p.isDefaultTrial);
    if (!plan) fail("NOT_FOUND");
    if (a.logoId) await checkLogo(ctx, a.logoId);

    const types = [...new Set(a.businessTypes ?? [])];
    if (types.length > MAX_BUSINESS_TYPES || types.some((k) => !PRESETS.some((p) => p.key === k))) fail("UNKNOWN_BUSINESS_TYPE");
    if (!types.length) types.push("general");
    const preset = mergePresets(types);

    const now = Date.now();
    const businessId = await ctx.db.insert("businesses", {
      name: str(a.name),
      logoId: a.logoId,
      businessType: str(a.businessType),
      phone: str(a.phone, 50),
      email: optStr(a.email),
      address: str(a.address),
      city: str(a.city),
      country: str(a.country),
      currency: str(a.currency, 8).toUpperCase(),
      ownerUserId: userId,
      status: "ACTIVE",
      planId: plan._id,
      subscriptionStatus: "TRIAL",
      subscriptionEndsAt: now + plan.trialDays * DAY_MS,
      settings: {
        taxRatePercent: 0,
        lowStockThreshold: 5,
        allowNegativeStock: true,
        paymentMethods: ["CASH", "EVC", "ZAAD", "EDAHAB", "CREDIT"],
        maxCashierDiscountPercent: 10,
        defaultCreditLimitCents: 0,
        expenseCategories: [
          "Rent", "Electricity", "Water", "Salaries", "Transport",
          "Airtime & Internet", "Generator fuel", "Licence & Tax", "Supplies", "Other",
        ],
        discountPresets: [5, 10],
      },
      businessTypes: types,
      features: preset.features,
      attributeDefs: preset.attributes,
      createdAt: now,
    });
    for (const name of preset.categories) await ctx.db.insert("categories", { businessId, name });
    const memberId = await ctx.db.insert("members", {
      userId,
      businessId,
      role: "OWNER",
      username,
      fullName: str(a.fullName),
      isActive: true,
      createdAt: now,
    });
    await ctx.db.insert("auditLog", {
      businessId,
      actorMemberId: memberId,
      actorName: a.fullName.trim(),
      action: "business.create",
      createdAt: now,
    });
    return businessId;
  },
});
