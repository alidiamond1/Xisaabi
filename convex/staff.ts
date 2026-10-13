import { createAccount, invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { audit, fail, requireBusiness, type BusinessAccess } from "./lib/access";
import { optStr, str } from "./lib/validate";
import { hasPermission, type Permission, type Permissions } from "./shared/permissions";
import { permissions as permissionsV } from "./schema";
import { normalizeUsername } from "./shared/username";

const staffRole = v.union(v.literal("MANAGER"), v.literal("CASHIER"));
const PERMS: Permission[] = ["seeCost", "giveDiscount", "refund", "adjustStock", "editPrice"];

/** Only the OWNER may set permission toggles. */
function checkPerms(access: BusinessAccess, p?: Permissions) {
  if (p && access.role !== "OWNER") fail("FORBIDDEN");
}

/** Load a member of THIS business (members isn't covered by getOwned). */
async function ownedMember(ctx: QueryCtx, businessId: Id<"businesses">, id: Id<"members">) {
  const m = await ctx.db.get(id);
  if (!m || m.businessId !== businessId) fail("NOT_FOUND");
  return m;
}

/** MANAGER may only touch CASHIERs; nobody touches the OWNER row (except reset by owner). */
function canManage(access: BusinessAccess, target: { role: string }) {
  if (target.role === "OWNER") return false;
  return access.role === "OWNER" || target.role === "CASHIER";
}

async function assertUserLimit(ctx: QueryCtx, access: BusinessAccess) {
  const max = access.plan.maxUsers;
  if (max <= 0) return;
  const members = await ctx.db
    .query("members")
    .withIndex("by_business", (q) => q.eq("businessId", access.businessId))
    .collect();
  if (members.filter((m) => m.isActive).length >= max) fail("PLAN_LIMIT_USERS");
}

function checkNewPassword(p: string) {
  if (p.length < 8) fail("PASSWORD_TOO_SHORT");
  if (p.length > 200) fail("INVALID_INPUT");
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { businessId } = await requireBusiness(ctx, "staff");
    const members = await ctx.db
      .query("members")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .collect();
    return members.map((m) => ({
      _id: m._id,
      fullName: m.fullName,
      username: m.username,
      role: m.role,
      phone: m.phone,
      isActive: m.isActive,
      createdAt: m.createdAt,
      // effective toggles (saved ones or the role defaults)
      permissions: Object.fromEntries(PERMS.map((k) => [k, hasPermission(m, k)])) as Permissions,
    }));
  },
});

// ── create (action: needs createAccount) ──

export const checkCreate = internalQuery({
  args: { username: v.string(), role: staffRole, permissions: v.optional(permissionsV) },
  handler: async (ctx, a) => {
    const access = await requireBusiness(ctx, "staff");
    if (access.role === "MANAGER" && a.role !== "CASHIER") fail("FORBIDDEN");
    checkPerms(access, a.permissions);
    await assertUserLimit(ctx, access);
    const taken = await ctx.db
      .query("members")
      .withIndex("by_username", (q) => q.eq("username", a.username))
      .first();
    if (taken) fail("USERNAME_TAKEN");
  },
});

export const insertMember = internalMutation({
  args: {
    userId: v.id("users"),
    username: v.string(),
    fullName: v.string(),
    phone: v.optional(v.string()),
    role: staffRole,
    permissions: v.optional(permissionsV),
  },
  handler: async (ctx, a) => {
    const access = await requireBusiness(ctx, "staff");
    if (access.role === "MANAGER" && a.role !== "CASHIER") fail("FORBIDDEN");
    checkPerms(access, a.permissions);
    await assertUserLimit(ctx, access);
    // an existing login must never be re-bound to this business
    const has = await ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", a.userId)).first();
    if (has) fail("USERNAME_TAKEN");
    const id = await ctx.db.insert("members", {
      ...a,
      businessId: access.businessId,
      isActive: true,
      createdAt: Date.now(),
    });
    await audit(ctx, access.member, "staff.create", `${a.username} (${a.role})`);
    return id;
  },
});

export const create = action({
  args: {
    fullName: v.string(),
    username: v.string(),
    password: v.string(),
    role: staffRole,
    phone: v.optional(v.string()),
    permissions: v.optional(permissionsV),
  },
  handler: async (ctx, a): Promise<Id<"members">> => {
    const username = normalizeUsername(a.username);
    if (!username) fail("INVALID_USERNAME");
    checkNewPassword(a.password);
    const fullName = str(a.fullName);
    const phone = optStr(a.phone, 50);
    await ctx.runQuery(internal.staff.checkCreate, { username, role: a.role, permissions: a.permissions });
    let userId: Id<"users">;
    try {
      const res = await createAccount(ctx, {
        provider: "password",
        account: { id: username, secret: a.password },
        profile: { email: username, name: fullName },
      });
      userId = res.user._id;
    } catch {
      // account id already exists in auth (maybe a signup without a business)
      fail("USERNAME_TAKEN");
    }
    return await ctx.runMutation(internal.staff.insertMember, {
      userId,
      username,
      fullName,
      phone,
      role: a.role,
      permissions: a.permissions,
    });
  },
});

// ── update / setActive ──

export const update = mutation({
  args: {
    memberId: v.id("members"),
    fullName: v.string(),
    phone: v.optional(v.string()),
    role: staffRole,
    permissions: v.optional(permissionsV),
  },
  handler: async (ctx, a) => {
    const access = await requireBusiness(ctx, "staff");
    const target = await ownedMember(ctx, access.businessId, a.memberId);
    if (!canManage(access, target)) fail("FORBIDDEN");
    if (access.role === "MANAGER" && a.role !== "CASHIER") fail("FORBIDDEN");
    checkPerms(access, a.permissions);
    await ctx.db.patch(target._id, {
      fullName: str(a.fullName),
      phone: optStr(a.phone, 50),
      role: a.role,
      ...(a.permissions ? { permissions: a.permissions } : {}),
    });
    await audit(ctx, access.member, "staff.update", `${target.username} -> ${a.role}${a.permissions ? " " + JSON.stringify(a.permissions) : ""}`);
  },
});

export const setActive = mutation({
  args: { memberId: v.id("members"), isActive: v.boolean() },
  handler: async (ctx, a) => {
    const access = await requireBusiness(ctx, "staff");
    const target = await ownedMember(ctx, access.businessId, a.memberId);
    if (target._id === access.member._id || !canManage(access, target)) fail("FORBIDDEN");
    if (a.isActive && !target.isActive) await assertUserLimit(ctx, access);
    await ctx.db.patch(target._id, { isActive: a.isActive });
    await audit(ctx, access.member, a.isActive ? "staff.unlock" : "staff.lock", target.username);
  },
});

// ── reset password (action) ──

export const checkReset = internalQuery({
  args: { memberId: v.id("members") },
  handler: async (ctx, a) => {
    const access = await requireBusiness(ctx, "staff");
    const target = await ownedMember(ctx, access.businessId, a.memberId);
    // owner may reset anyone in the business (incl. self); manager only cashiers
    if (!(access.role === "OWNER" || canManage(access, target))) fail("FORBIDDEN");
    return { userId: target.userId, username: target.username };
  },
});

export const logReset = internalMutation({
  args: { memberId: v.id("members") },
  handler: async (ctx, a) => {
    const access = await requireBusiness(ctx, "staff");
    const target = await ownedMember(ctx, access.businessId, a.memberId);
    await audit(ctx, access.member, "staff.resetPassword", target.username);
  },
});

export const resetPassword = action({
  args: { memberId: v.id("members"), newPassword: v.string() },
  handler: async (ctx, a): Promise<void> => {
    checkNewPassword(a.newPassword);
    const t = await ctx.runQuery(internal.staff.checkReset, { memberId: a.memberId });
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: t.username, secret: a.newPassword },
    });
    await invalidateSessions(ctx, { userId: t.userId });
    await ctx.runMutation(internal.staff.logReset, { memberId: a.memberId });
  },
});

