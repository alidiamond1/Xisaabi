import { createAccount, invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { audit, diff, fail, requirePlatform } from "./lib/access";
import { str } from "./lib/validate";
import { platformRole } from "./schema";
import { normalizeUsername } from "./shared/username";

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatform(ctx, ["SUPER_ADMIN"]);
    // platform members have no businessId
    const members = await ctx.db
      .query("members")
      .withIndex("by_business", (q) => q.eq("businessId", undefined))
      .take(200);
    return await Promise.all(
      members.map(async (m) => {
        const s = await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", m.userId)).order("desc").first();
        return {
          _id: m._id,
          fullName: m.fullName,
          username: m.username,
          role: m.role,
          isActive: m.isActive,
          createdAt: m.createdAt,
          lastLoginAt: s?._creationTime ?? null,
        };
      }),
    );
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

/** Another active SUPER_ADMIN must remain after `t` stops being one. */
async function keepOneSuper(ctx: QueryCtx, t: Doc<"members">) {
  if (t.role !== "SUPER_ADMIN" || !t.isActive) return;
  const staff = await ctx.db.query("members").withIndex("by_business", (q) => q.eq("businessId", undefined)).take(200);
  if (!staff.some((m) => m._id !== t._id && m.role === "SUPER_ADMIN" && m.isActive)) fail("LAST_SUPER_ADMIN");
}

async function platformMember(ctx: QueryCtx, id: Id<"members">) {
  const t = await ctx.db.get(id);
  if (!t || t.businessId) fail("NOT_FOUND"); // platform members only
  return t;
}

export const setActive = mutation({
  args: { memberId: v.id("members"), isActive: v.boolean() },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx, ["SUPER_ADMIN"]);
    const t = await platformMember(ctx, a.memberId);
    if (t._id === me._id) fail("FORBIDDEN");
    if (!a.isActive) await keepOneSuper(ctx, t);
    await ctx.db.patch(t._id, { isActive: a.isActive });
    await audit(ctx, me, a.isActive ? "platformStaff.unlock" : "platformStaff.lock", t.username, undefined, {
      targetId: t._id,
      targetName: t.username,
      changes: diff(t, { isActive: a.isActive }, ["isActive"]),
    });
  },
});

export const setRole = mutation({
  args: { memberId: v.id("members"), role: platformRole },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx, ["SUPER_ADMIN"]);
    const t = await platformMember(ctx, a.memberId);
    if (a.role !== "SUPER_ADMIN") await keepOneSuper(ctx, t);
    await ctx.db.patch(t._id, { role: a.role });
    await audit(ctx, me, "platformStaff.setRole", t.username, undefined, {
      targetId: t._id,
      targetName: t.username,
      changes: diff(t, { role: a.role }, ["role"]),
    });
  },
});

// resetPassword (action): check -> change credentials -> audit. The password is never logged.

export const checkReset = internalQuery({
  args: { memberId: v.id("members") },
  handler: async (ctx, a) => {
    await requirePlatform(ctx, ["SUPER_ADMIN"]);
    const t = await platformMember(ctx, a.memberId);
    return { userId: t.userId, username: t.username };
  },
});

export const logReset = internalMutation({
  args: { memberId: v.id("members") },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx, ["SUPER_ADMIN"]);
    const t = await platformMember(ctx, a.memberId);
    await audit(ctx, me, "platformStaff.resetPassword", t.username, undefined, { targetId: t._id, targetName: t.username });
  },
});

export const resetPassword = action({
  args: { memberId: v.id("members"), newPassword: v.string() },
  handler: async (ctx, a): Promise<void> => {
    const t = await ctx.runQuery(internal.platformStaff.checkReset, { memberId: a.memberId });
    if (a.newPassword.length < 8) fail("PASSWORD_TOO_SHORT");
    if (a.newPassword.length > 200) fail("INVALID_INPUT");
    await modifyAccountCredentials(ctx, { provider: "password", account: { id: t.username, secret: a.newPassword } });
    await invalidateSessions(ctx, { userId: t.userId });
    await ctx.runMutation(internal.platformStaff.logReset, { memberId: a.memberId });
  },
});
