import { createAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { audit, fail, requirePlatform } from "./lib/access";
import { str } from "./lib/validate";
import { normalizeUsername } from "./shared/username";

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatform(ctx, ["SUPER_ADMIN"]);
    // platform members have no businessId
    const members = await ctx.db
      .query("members")
      .withIndex("by_business", (q) => q.eq("businessId", undefined))
      .collect();
    return members.map((m) => ({
      _id: m._id,
      fullName: m.fullName,
      username: m.username,
      role: m.role,
      isActive: m.isActive,
      createdAt: m.createdAt,
    }));
  },
});

export const checkCreate = internalQuery({
  args: { username: v.string() },
  handler: async (ctx, a) => {
    await requirePlatform(ctx, ["SUPER_ADMIN"]);
    const taken = await ctx.db
      .query("members")
      .withIndex("by_username", (q) => q.eq("username", a.username))
      .first();
    if (taken) fail("USERNAME_TAKEN");
  },
});

export const insertMember = internalMutation({
  args: { userId: v.id("users"), username: v.string(), fullName: v.string() },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx, ["SUPER_ADMIN"]);
    const has = await ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", a.userId)).first();
    if (has) fail("USERNAME_TAKEN");
    const id = await ctx.db.insert("members", {
      ...a,
      role: "PLATFORM_ADMIN",
      isActive: true,
      createdAt: Date.now(),
    });
    await audit(ctx, me, "platformStaff.create", a.username);
    return id;
  },
});

export const create = action({
  args: { fullName: v.string(), username: v.string(), password: v.string() },
  handler: async (ctx, a): Promise<Id<"members">> => {
    const username = normalizeUsername(a.username);
    if (!username) fail("INVALID_USERNAME");
    if (a.password.length < 8) fail("PASSWORD_TOO_SHORT");
    if (a.password.length > 200) fail("INVALID_INPUT");
    const fullName = str(a.fullName);
    await ctx.runQuery(internal.platformStaff.checkCreate, { username });
    let userId: Id<"users">;
    try {
      const res = await createAccount(ctx, {
        provider: "password",
        account: { id: username, secret: a.password },
        profile: { email: username, name: fullName },
      });
      userId = res.user._id;
    } catch {
      fail("USERNAME_TAKEN");
    }
    return await ctx.runMutation(internal.platformStaff.insertMember, { userId, username, fullName });
  },
});

export const setActive = mutation({
  args: { memberId: v.id("members"), isActive: v.boolean() },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx, ["SUPER_ADMIN"]);
    const t = await ctx.db.get(a.memberId);
    if (!t || t.businessId) fail("NOT_FOUND"); // platform members only
    if (t._id === me._id) fail("FORBIDDEN");
    await ctx.db.patch(t._id, { isActive: a.isActive });
    await audit(ctx, me, a.isActive ? "platformStaff.unlock" : "platformStaff.lock", t.username);
  },
});
