// One-time setup, run from the CLI (internal = not callable from the browser):
//   npx convex run seed:plans
//   npx convex run seed:createSuperAdmin '{"username":"admin","password":"...","fullName":"..."}'
import { createAccount } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { MODULE_KEYS } from "./shared/modules";
import { normalizeUsername } from "./shared/username";

export const plans = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (await ctx.db.query("plans").first()) return "plans already exist";
    await ctx.db.insert("plans", {
      name: "Trial",
      description: "Try every module free for 14 days.",
      priceCents: 0,
      trialDays: 14,
      maxUsers: 3,
      maxProducts: 200,
      modules: MODULE_KEYS,
      features: ["All modules", "3 users", "200 products"],
      isDefaultTrial: true,
      isActive: true,
      sortOrder: 0,
    });
    await ctx.db.insert("plans", {
      name: "Starter",
      description: "For a single small shop.",
      priceCents: 1000,
      trialDays: 0,
      maxUsers: 3,
      maxProducts: 1000,
      modules: ["pos", "inventory", "sales", "customers", "expiry"],
      features: ["POS & receipts", "Customer credit", "Expiry alerts", "3 users", "1,000 products"],
      isDefaultTrial: false,
      isActive: true,
      sortOrder: 1,
    });
    await ctx.db.insert("plans", {
      name: "Pro",
      description: "Everything, unlimited.",
      priceCents: 2500,
      trialDays: 0,
      maxUsers: 0,
      maxProducts: 0,
      modules: MODULE_KEYS,
      features: ["All modules", "Expenses & profit reports", "Unlimited users", "Unlimited products"],
      isDefaultTrial: false,
      isActive: true,
      sortOrder: 2,
    });
    return "seeded 3 plans";
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
