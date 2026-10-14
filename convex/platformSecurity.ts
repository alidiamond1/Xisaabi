import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { requirePlatform } from "./lib/access";

const MAX_ATTEMPTS_PER_HOUR = 10; // Convex Auth default (auth.ts does not override it)

export const recentLogins = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    await requirePlatform(ctx);
    const limit = Math.min(Math.max(Math.floor(a.limit ?? 50), 1), 100);
    const sessions = await ctx.db.query("authSessions").order("desc").take(limit);
    const names = new Map<Id<"businesses">, string>();
    const out = [];
    for (const s of sessions) {
      const m = await ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", s.userId)).unique();
      if (m?.businessId && !names.has(m.businessId)) names.set(m.businessId, (await ctx.db.get(m.businessId))?.name ?? "?");
      out.push({
        sessionId: s._id,
        at: s._creationTime,
        expiresAt: s.expirationTime,
        memberId: m?._id ?? null,
        username: m?.username ?? null,
        fullName: m?.fullName ?? null,
        role: m?.role ?? null,
        businessId: m?.businessId ?? null,
        businessName: m?.businessId ? (names.get(m.businessId) ?? null) : null,
      });
    }
    return out;
  },
});

/** Accounts currently locked out by failed sign-ins (attempts regenerate over an hour). */
export const lockouts = query({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    await requirePlatform(ctx);
    const perMs = MAX_ATTEMPTS_PER_HOUR / 3_600_000;
    const rows = await ctx.db.query("authRateLimits").order("desc").take(200);
    const out = [];
    for (const r of rows) {
      const left = Math.min(MAX_ATTEMPTS_PER_HOUR, r.attemptsLeft + (now - r.lastAttemptTime) * perMs);
      if (left >= 1) continue;
      // identifier is the authAccounts _id; its providerAccountId is the username
      const accId = ctx.db.normalizeId("authAccounts", r.identifier);
      const username = accId ? (await ctx.db.get(accId))?.providerAccountId : undefined;
      const m = username ? await ctx.db.query("members").withIndex("by_username", (q) => q.eq("username", username)).first() : null;
      out.push({
        identifier: username ?? r.identifier,
        memberId: m?._id ?? null,
        fullName: m?.fullName ?? null,
        role: m?.role ?? null,
        lastAttemptAt: r.lastAttemptTime,
        unlocksAt: r.lastAttemptTime + Math.ceil((1 - r.attemptsLeft) / perMs),
      });
    }
    return out.sort((x, y) => y.lastAttemptAt - x.lastAttemptAt);
  },
});
