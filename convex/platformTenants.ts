import { invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { audit, diff, fail, lockReason, requirePlatform } from "./lib/access";
import { limiter } from "./lib/limiter";
import { cents, optStr, posInt, str } from "./lib/validate";
import { DAY_MS } from "./shared/expiry";
import { healthOf } from "./shared/health";

type Biz = Doc<"businesses">;

function derivedStatus(b: Biz, now: number) {
  if (b.status === "SUSPENDED") return "SUSPENDED";
  if (b.subscriptionEndsAt < now) return "EXPIRED";
  return b.subscriptionStatus === "TRIAL" ? "TRIAL" : "ACTIVE";
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

async function statsOf(ctx: QueryCtx, businessId: Id<"businesses">) {
  return await ctx.db.query("businessStats").withIndex("by_business", (q) => q.eq("businessId", businessId)).first();
}

/** Newest sign-in of a login (authSessions are created per sign-in). */
async function lastLogin(ctx: QueryCtx, userId: Id<"users">) {
  const s = await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).order("desc").first();
  return s?._creationTime ?? null;
}

/** A business member (never platform staff) — platform functions here may only touch these. */
async function tenantMember(ctx: QueryCtx, id: Id<"members">) {
  const m = await ctx.db.get(id);
  if (!m || !m.businessId) fail("NOT_FOUND");
  return m as Doc<"members"> & { businessId: Id<"businesses"> };
}

export const list = query({
  args: {
    now: v.number(),
    search: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("ACTIVE"), v.literal("SUSPENDED"), v.literal("TRIAL"), v.literal("EXPIRED")),
    ),
    planId: v.optional(v.id("plans")),
    type: v.optional(v.string()),
    city: v.optional(v.string()),
    health: v.optional(
      v.union(v.literal("ACTIVE"), v.literal("QUIET"), v.literal("DORMANT"), v.literal("NEW")),
    ),
  },
  handler: async (ctx, a) => {
    await requirePlatform(ctx);
    const { now } = a;
    const needle = a.search?.trim().toLowerCase();
    // platform side may scan; ponytail: first 1000 businesses, add search index if the platform outgrows it
    let rows = await ctx.db.query("businesses").order("desc").take(1000);
    if (a.status) rows = rows.filter((b) => derivedStatus(b, now) === a.status);
    if (a.planId) rows = rows.filter((b) => b.planId === a.planId);
    if (a.type) rows = rows.filter((b) => b.businessType === a.type);
    if (a.city) rows = rows.filter((b) => b.city.toLowerCase() === a.city!.trim().toLowerCase());
    if (needle) {
      rows = rows.filter((b) => [b.name, b.phone, b.city, b.email ?? ""].some((s) => s.toLowerCase().includes(needle)));
    }
    const plans = new Map<Id<"plans">, string>();
    for (const p of await ctx.db.query("plans").take(100)) plans.set(p._id, p.name);
    const out = await Promise.all(
      rows.map(async (b) => {
        const st = await statsOf(ctx, b._id);
        const owner = await ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", b.ownerUserId)).unique();
        return {
          ...b,
          logoUrl: b.logoId ? await ctx.storage.getUrl(b.logoId) : null,
          planName: plans.get(b.planId) ?? "?",
          ownerName: owner?.fullName ?? null,
          ownerUsername: owner?.username ?? null,
          staffCount: st?.staff ?? 0,
          lockReason: lockReason(b, now),
          displayStatus: derivedStatus(b, now),
          health: healthOf(b.createdAt, st?.lastSaleAt, now),
          stats: st
            ? {
                lastSaleAt: st.lastSaleAt ?? null,
                lastLoginAt: st.lastLoginAt ?? null,
                sales30dCents: st.sales30dCents,
                sales30dCount: st.sales30dCount,
                products: st.products,
                customers: st.customers,
                staff: st.staff,
                updatedAt: st.updatedAt,
              }
            : null,
        };
      }),
    );
    return a.health ? out.filter((b) => b.health === a.health) : out;
  },
});

export const get = query({
  args: { businessId: v.id("businesses"), now: v.number() },
  handler: async (ctx, a) => {
    await requirePlatform(ctx);
    const business = await ctx.db.get(a.businessId);
    if (!business) fail("NOT_FOUND");
    const id = business._id;
    const staff = await ctx.db.query("members").withIndex("by_business", (q) => q.eq("businessId", id)).take(200);
    const plan = await ctx.db.get(business.planId);
    const stats = await statsOf(ctx, id);
    const tickets = await ctx.db.query("tickets").withIndex("by_business", (q) => q.eq("businessId", id)).order("desc").take(50);
    return {
      business,
      logoUrl: business.logoId ? await ctx.storage.getUrl(business.logoId) : null,
      plan,
      owner: staff.find((m) => m.role === "OWNER") ?? null,
      staff,
      stats,
      health: healthOf(business.createdAt, stats?.lastSaleAt, a.now),
      usage: {
        users: { used: staff.filter((m) => m.isActive).length, max: plan?.maxUsers ?? 0 }, // max 0 = unlimited
        products: { used: stats?.products ?? 0, max: plan?.maxProducts ?? 0 },
      },
      openTickets: tickets.filter((t) => t.status !== "CLOSED"),
      notes: await ctx.db.query("businessNotes").withIndex("by_business", (q) => q.eq("businessId", id)).order("desc").take(100),
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
    await audit(ctx, me, "business.suspend", reason, b._id, { targetId: b._id, targetName: b.name });
  },
});

export const activate = mutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const b = await loadBusiness(ctx, a.businessId);
    await ctx.db.patch(b._id, { status: "ACTIVE", suspendedReason: undefined });
    await audit(ctx, me, "business.activate", undefined, b._id, { targetId: b._id, targetName: b.name });
  },
});

export const changePlan = mutation({
  args: { businessId: v.id("businesses"), planId: v.id("plans") },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const b = await loadBusiness(ctx, a.businessId);
    const plan = await ctx.db.get(a.planId);
    if (!plan) fail("NOT_FOUND");
    const old = await ctx.db.get(b.planId);
    await ctx.db.patch(b._id, { planId: plan._id });
    await audit(ctx, me, "business.changePlan", plan.name, b._id, {
      targetId: b._id,
      targetName: b.name,
      changes: diff({ plan: old?.name }, { plan: plan.name }, ["plan"]),
    });
  },
});

export const extend = mutation({
  args: { businessId: v.id("businesses"), days: v.number() },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const b = await loadBusiness(ctx, a.businessId);
    const days = posInt(a.days, 3650);
    const now = Date.now();
    const endsAt = Math.max(now, b.subscriptionEndsAt) + days * DAY_MS;
    await ctx.db.patch(b._id, { subscriptionEndsAt: endsAt });
    await audit(ctx, me, "business.extend", `${days} days`, b._id, {
      targetId: b._id,
      targetName: b.name,
      changes: diff({ endsAt: day(b.subscriptionEndsAt) }, { endsAt: day(endsAt) }, ["endsAt"]),
    });
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
    if (!(await limiter.limit(ctx, "paymentRecord", { key: `${b._id}:${a.planId}:${a.amountCents}:${a.months}:${a.method}` })).ok) fail("RATE_LIMITED");
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
    await audit(ctx, me, "business.payment", `${plan.name} ${months}mo ${amountCents} ${method}`, b._id, { targetId: b._id, targetName: b.name });
  },
});

// ── profile & notes ──

export const editProfile = mutation({
  args: {
    businessId: v.id("businesses"),
    name: v.string(),
    phone: v.string(),
    city: v.string(),
    address: v.string(),
    email: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const b = await loadBusiness(ctx, a.businessId);
    const next = { name: str(a.name), phone: str(a.phone, 50), city: str(a.city), address: str(a.address), email: optStr(a.email) };
    await ctx.db.patch(b._id, next);
    await audit(ctx, me, "business.editProfile", undefined, b._id, {
      targetId: b._id,
      targetName: next.name,
      changes: diff(b, next, Object.keys(next)),
    });
  },
});

export const addNote = mutation({
  args: { businessId: v.id("businesses"), body: v.string() },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const b = await loadBusiness(ctx, a.businessId);
    const body = str(a.body, 2000);
    const id = await ctx.db.insert("businessNotes", {
      businessId: b._id,
      body,
      authorMemberId: me._id,
      authorName: me.fullName,
      createdAt: Date.now(),
    });
    await audit(ctx, me, "business.note", body.slice(0, 200), b._id, { targetId: b._id, targetName: b.name });
    return id;
  },
});

export const deleteNote = mutation({
  args: { noteId: v.id("businessNotes") },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const n = await ctx.db.get(a.noteId);
    if (!n) fail("NOT_FOUND");
    await ctx.db.delete(n._id);
    await audit(ctx, me, "business.noteDelete", n.body.slice(0, 200), n.businessId, { targetId: n.businessId });
  },
});

// ── members of a business ──

export const members = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, a) => {
    await requirePlatform(ctx);
    const rows = await ctx.db.query("members").withIndex("by_business", (q) => q.eq("businessId", a.businessId)).take(200);
    return await Promise.all(
      rows.map(async (m) => ({
        _id: m._id,
        fullName: m.fullName,
        username: m.username,
        role: m.role,
        phone: m.phone,
        isActive: m.isActive,
        createdAt: m.createdAt,
        lastLoginAt: await lastLogin(ctx, m.userId),
      })),
    );
  },
});

export const setMemberActive = mutation({
  args: { memberId: v.id("members"), isActive: v.boolean() },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const m = await tenantMember(ctx, a.memberId);
    await ctx.db.patch(m._id, { isActive: a.isActive });
    await audit(ctx, me, "business.setMemberActive", m.username, m.businessId, {
      targetId: m._id,
      targetName: m.username,
      changes: diff(m, { isActive: a.isActive }, ["isActive"]),
    });
  },
});

// SUPER_ADMIN credential actions: check (internal query) -> change credentials -> audit (internal mutation).

export const checkMember = internalQuery({
  args: { memberId: v.id("members") },
  handler: async (ctx, a) => {
    await requirePlatform(ctx, ["SUPER_ADMIN"]);
    const m = await tenantMember(ctx, a.memberId);
    return { userId: m.userId, username: m.username };
  },
});

export const logMemberAction = internalMutation({
  args: { memberId: v.id("members"), action: v.string() },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const m = await tenantMember(ctx, a.memberId);
    await audit(ctx, me, a.action, m.username, m.businessId, { targetId: m._id, targetName: m.username });
  },
});

export const resetMemberPassword = action({
  args: { memberId: v.id("members"), newPassword: v.string() },
  handler: async (ctx, a): Promise<void> => {
    const t = await ctx.runQuery(internal.platformTenants.checkMember, { memberId: a.memberId });
    if (a.newPassword.length < 8) fail("PASSWORD_TOO_SHORT");
    if (a.newPassword.length > 200) fail("INVALID_INPUT");
    await modifyAccountCredentials(ctx, { provider: "password", account: { id: t.username, secret: a.newPassword } });
    await invalidateSessions(ctx, { userId: t.userId });
    await ctx.runMutation(internal.platformTenants.logMemberAction, { memberId: a.memberId, action: "business.resetMemberPassword" });
  },
});

// Action, not mutation: invalidateSessions only runs from an action. Any platform role may log someone out.
export const checkForceLogout = internalQuery({
  args: { memberId: v.id("members") },
  handler: async (ctx, a) => {
    await requirePlatform(ctx);
    const m = await tenantMember(ctx, a.memberId);
    return { userId: m.userId };
  },
});

export const forceLogout = action({
  args: { memberId: v.id("members") },
  handler: async (ctx, a): Promise<void> => {
    const t = await ctx.runQuery(internal.platformTenants.checkForceLogout, { memberId: a.memberId });
    await invalidateSessions(ctx, { userId: t.userId });
    await ctx.runMutation(internal.platformTenants.logMemberAction, { memberId: a.memberId, action: "business.forceLogout" });
  },
});
