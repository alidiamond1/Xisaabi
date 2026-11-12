// One-time setup, run from the CLI (internal = not callable from the browser):
//   npx convex run seed:plans
//   npx convex run seed:createSuperAdmin '{"username":"admin","password":"...","fullName":"..."}'
import { createAccount, invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { MODULE_KEYS } from "./shared/modules";
import { normalizeUsername } from "./shared/username";

const PLANS = [
  { name: "Trial", description: "Try every module free for 14 days.", priceCents: 0, trialDays: 14, maxUsers: 1, maxProducts: 200,
    modules: MODULE_KEYS, features: ["Every module free for 14 days", "1 user", "Up to 200 products"], isDefaultTrial: true, isActive: true, sortOrder: 0 },
  { name: "Starter", description: "Everything a small shop needs, for the owner and one helper.", priceCents: 1000, trialDays: 0, maxUsers: 2, maxProducts: 1000,
    modules: MODULE_KEYS, features: ["All modules: POS, stock, sales, customer credit, expenses, reports, purchases", "2 users (you + 1 staff)", "Up to 1,000 products", "Works offline, receipts included"],
    isDefaultTrial: false, isActive: true, sortOrder: 1 },
  { name: "Pro", description: "For growing shops with a team.", priceCents: 2500, trialDays: 0, maxUsers: 0, maxProducts: 0,
    modules: MODULE_KEYS, features: ["Everything in Starter", "Unlimited users for your whole team", "Unlimited products", "Works offline, receipts included"],
    isDefaultTrial: false, isActive: true, sortOrder: 2 },
];

export const plans = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (await ctx.db.query("plans").first()) return "plans already exist";
    for (const plan of PLANS) await ctx.db.insert("plans", plan);
    return "seeded 3 plans";
  },
});

/** One-off: apply PLANS limits/modules/copy to existing plans by name (prices untouched). `npx convex run seed:updatePlans` */
export const updatePlans = internalMutation({
  args: {},
  handler: async (ctx) => {
    const updated: string[] = [];
    for (const row of await ctx.db.query("plans").collect()) {
      const plan = PLANS.find((p) => p.name === row.name);
      if (!plan) continue;
      const { description, maxUsers, maxProducts, modules, features } = plan;
      await ctx.db.patch(row._id, { description, maxUsers, maxProducts, modules, features });
      updated.push(row.name);
    }
    return updated;
  },
});

export const createSuperAdmin = internalAction({
  args: { username: v.string(), password: v.string(), fullName: v.string() },
  handler: async (ctx, args) => {
    const username = normalizeUsername(args.username);
    if (!username) throw new ConvexError("INVALID_USERNAME");
    if (args.password.length < 8) throw new ConvexError("PASSWORD_TOO_SHORT");
    const { user } = await createAccount(ctx, {
      provider: "password",
      account: { id: username, secret: args.password },
      profile: { email: username, name: args.fullName },
    });
    await ctx.runMutation(internal.seed.insertPlatformMember, {
      userId: user._id,
      username,
      fullName: args.fullName,
    });
    return `super admin "${username}" created`;
  },
});

export const insertPlatformMember = internalMutation({
  args: { userId: v.id("users"), username: v.string(), fullName: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("members", {
      ...args,
      role: "SUPER_ADMIN",
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

export const getMemberByUsername = internalQuery({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("members")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .first();
  },
});

export const resetPassword = internalAction({
  args: { username: v.string(), newPassword: v.string() },
  handler: async (ctx, args) => {
    const username = normalizeUsername(args.username);
    if (!username) throw new ConvexError("INVALID_USERNAME");
    if (args.newPassword.length < 8) throw new ConvexError("PASSWORD_TOO_SHORT");
    const member = await ctx.runQuery(internal.seed.getMemberByUsername, { username });
    if (!member) throw new ConvexError("MEMBER_NOT_FOUND");
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: username, secret: args.newPassword },
    });
    await invalidateSessions(ctx, { userId: member.userId });
    return `Password for user "${username}" was successfully updated.`;
  },
});

