/// <reference types="vite/client" />
// v4 super-admin console tests (SPEC_V4_ADMIN.md). Auth is simulated like in security.test.ts.
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { diff } from "./lib/access";
import schema from "./schema";
import { MODULE_KEYS } from "./shared/modules";

const modules = import.meta.glob("./**/*.*s");
const DAY = 86_400_000;

type Role = "OWNER" | "MANAGER" | "CASHIER" | "SUPER_ADMIN" | "PLATFORM_ADMIN";

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    const d = (e as { data?: unknown }).data;
    return typeof d === "string" ? d : `RAW:${(e as Error).message}`;
  }
}

const makeT = () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return t;
};
let t: ReturnType<typeof makeT>;
let F: Awaited<ReturnType<typeof build>>;

async function build(t: ReturnType<typeof makeT>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const mkPlan = (name: string, isDefaultTrial: boolean) =>
      ctx.db.insert("plans", {
        name, description: "d", priceCents: 1000, trialDays: 14, maxUsers: 5, maxProducts: 100,
        modules: MODULE_KEYS, features: [], isDefaultTrial, isActive: true, sortOrder: isDefaultTrial ? 0 : 1,
      });
    const planId = await mkPlan("Pro", true);
    const plan2Id = await mkPlan("Other", false);
    const mkBiz = async (name: string, businessType: string, ends: number) => {
      const ownerUserId = await ctx.db.insert("users", { email: `${name}-owner`, name });
      const businessId = await ctx.db.insert("businesses", {
        name, businessType, phone: "1", address: "a", city: "Hargeisa", country: "SO", currency: "USD",
        ownerUserId, status: "ACTIVE", planId, subscriptionStatus: "ACTIVE", subscriptionEndsAt: ends,
        settings: {
          taxRatePercent: 0, lowStockThreshold: 5, allowNegativeStock: false, paymentMethods: ["CASH"],
          maxCashierDiscountPercent: 10, defaultCreditLimitCents: 0, expenseCategories: ["Rent"], discountPresets: [5],
        },
        createdAt: now - 60 * DAY,
      });
      return { businessId, ownerUserId };
    };
    const mkMember = async (role: Role, username: string, businessId?: Id<"businesses">, userId?: Id<"users">) => {
      const uid = userId ?? (await ctx.db.insert("users", { email: username, name: username }));
      const memberId = await ctx.db.insert("members", {
        userId: uid, businessId, role, username, fullName: username, isActive: true, createdAt: now,
      });
      return { userId: uid, memberId };
    };
    const A = await mkBiz("A", "Grocery", now + 365 * DAY);
    const B = await mkBiz("B", "Pharmacy", now + 365 * DAY);
    const ownerA = await mkMember("OWNER", "owner-a", A.businessId, A.ownerUserId);
    const managerA = await mkMember("MANAGER", "manager-a", A.businessId);
    const cashierA = await mkMember("CASHIER", "cashier-a", A.businessId);
    const ownerB = await mkMember("OWNER", "owner-b", B.businessId, B.ownerUserId);
    const superAdmin = await mkMember("SUPER_ADMIN", "super");
    const padmin = await mkMember("PLATFORM_ADMIN", "padmin");
    const loneUser = await ctx.db.insert("users", { email: "lone", name: "lone" });
    const productId = await ctx.db.insert("products", {
      businessId: A.businessId, type: "STOCKABLE", sku: "", barcode: "", extraBarcodes: [], name: "Tea", brand: "", unit: "pcs",
      allowDecimal: false, costCents: 300, priceCents: 500, stock: 10, reorderLevel: 5, trackExpiry: false, hasVariants: false,
      isArchived: false, updatedAt: now,
    });
    const ticketId = await ctx.db.insert("tickets", {
      businessId: A.businessId, subject: "Help", category: "OTHER", priority: "LOW", status: "OPEN", createdBy: ownerA.memberId,
      unreadByPlatform: true, unreadByBusiness: false, lastMessageAt: now - 1000, createdAt: now - 1000,
    });
    const noteId = await ctx.db.insert("businessNotes", {
      businessId: A.businessId, body: "n", authorMemberId: superAdmin.memberId, authorName: "super", createdAt: now,
    });
    const paymentId = await ctx.db.insert("subscriptionPayments", {
      businessId: A.businessId, planId, amountCents: 1, months: 1, method: "CASH", recordedBy: superAdmin.memberId, createdAt: now,
      voidedAt: now, voidReason: "seed", voidedBy: superAdmin.memberId, // voided: stays out of totals
    });
    const announcementId = await ctx.db.insert("announcements", {
      title: "t", body: "b", level: "INFO", audience: { planIds: [], businessTypes: [] }, startsAt: now, isActive: false,
      createdBy: superAdmin.memberId, createdAt: now,
    });
    return { planId, plan2Id, A, B, ownerA, managerA, cashierA, ownerB, superAdmin, padmin, loneUser, productId, ticketId, noteId, paymentId, announcementId };
  });
}

const as = (u: { userId: Id<"users"> }) => t.withIdentity({ subject: `${u.userId}|fakesession` });
const asUser = (userId: Id<"users">) => as({ userId });
const page = { numItems: 50, cursor: null };
const planFields = {
  name: "Pro", description: "d", priceCents: 1000, trialDays: 14, maxUsers: 5, maxProducts: 100, modules: MODULE_KEYS,
  features: [] as string[], isDefaultTrial: true, isActive: true, sortOrder: 0,
};
const announcement = (over: Record<string, unknown> = {}) => ({
  title: "Hello", body: "body", level: "INFO" as const, audience: { planIds: [], businessTypes: [] as string[] },
  startsAt: Date.now() - DAY, isActive: true, ...over,
});

beforeEach(async () => {
  t = makeT();
  F = await build(t);
});

/** Every new platform function, as callers. SUPER_ADMIN-only ones are flagged. */
function platformCalls() {
  const b = F.A.businessId;
  const calls: [string, boolean, (c: ReturnType<typeof as>) => Promise<unknown>][] = [
    ["platformActivity.list", false, (c) => c.query(api.platformActivity.list, { paginationOpts: page })],
    ["platformActivity.modules", false, (c) => c.query(api.platformActivity.modules, {})],
    ["platformStats.overview", false, (c) => c.query(api.platformStats.overview, { now: Date.now() })],
    ["platformStats.refreshNow", false, (c) => c.mutation(api.platformStats.refreshNow, {})],
    ["platformTenants.editProfile", false, (c) =>
      c.mutation(api.platformTenants.editProfile, { businessId: b, name: "n", phone: "1", city: "c", address: "a" })],
    ["platformTenants.addNote", false, (c) => c.mutation(api.platformTenants.addNote, { businessId: b, body: "x" })],
    ["platformTenants.deleteNote", false, (c) => c.mutation(api.platformTenants.deleteNote, { noteId: F.noteId })],
    ["platformTenants.members", false, (c) => c.query(api.platformTenants.members, { businessId: b })],
    ["platformTenants.setMemberActive", false, (c) =>
      c.mutation(api.platformTenants.setMemberActive, { memberId: F.cashierA.memberId, isActive: false })],
    ["platformTenants.forceLogout", false, (c) => c.action(api.platformTenants.forceLogout, { memberId: F.cashierA.memberId })],
    ["platformTenants.resetMemberPassword", true, (c) =>
      c.action(api.platformTenants.resetMemberPassword, { memberId: F.cashierA.memberId, newPassword: "longenough1" })],
    ["platformBilling.payments", false, (c) => c.query(api.platformBilling.payments, { paginationOpts: page })],
    ["platformBilling.totals", false, (c) => c.query(api.platformBilling.totals, {})],
    ["platformBilling.voidPayment", true, (c) =>
      c.mutation(api.platformBilling.voidPayment, { paymentId: F.paymentId, reason: "r" })],
    ["platformAnnouncements.list", false, (c) => c.query(api.platformAnnouncements.list, {})],
    ["platformAnnouncements.create", false, (c) => c.mutation(api.platformAnnouncements.create, announcement())],
    ["platformAnnouncements.update", false, (c) =>
      c.mutation(api.platformAnnouncements.update, { announcementId: F.announcementId, ...announcement() })],
    ["platformAnnouncements.remove", false, (c) =>
      c.mutation(api.platformAnnouncements.remove, { announcementId: F.announcementId })],
    ["platformSupport.assign", false, (c) => c.mutation(api.platformSupport.assign, { ticketId: F.ticketId, memberId: null })],
    ["platformSupport.setPriority", false, (c) => c.mutation(api.platformSupport.setPriority, { ticketId: F.ticketId, priority: "HIGH" })],
    ["platformTenants.changePlan", true, (c) => c.mutation(api.platformTenants.changePlan, { businessId: F.A.businessId, planId: F.plan2Id })],
    ["platformTenants.extend", true, (c) => c.mutation(api.platformTenants.extend, { businessId: F.A.businessId, days: 5 })],
    ["platformTenants.recordPayment", true, (c) =>
      c.mutation(api.platformTenants.recordPayment, { businessId: F.A.businessId, planId: F.planId, amountCents: 500, months: 1, method: "EVC" })],
    ["platformStaff.setRole", true, (c) => c.mutation(api.platformStaff.setRole, { memberId: F.padmin.memberId, role: "SUPER_ADMIN" })],
    ["platformStaff.resetPassword", true, (c) =>
      c.action(api.platformStaff.resetPassword, { memberId: F.padmin.memberId, newPassword: "longenough1" })],
    ["platformSecurity.recentLogins", false, (c) => c.query(api.platformSecurity.recentLogins, {})],
    ["platformSecurity.lockouts", false, (c) => c.query(api.platformSecurity.lockouts, { now: Date.now() })],
    ["platformSettings.update", true, (c) =>
      c.mutation(api.platformSettings.update, {
        paymentInstructions: "", supportPhone: "", supportWhatsApp: "", supportEmail: "", signupsOpen: false,
      })],
  ];
  return calls;
}

describe("tenant isolation of the v4 platform functions", () => {
  it("business users are FORBIDDEN on every one", async () => {
    for (const who of [F.ownerA, F.managerA, F.cashierA, F.ownerB]) {
      for (const [name, , call] of platformCalls()) {
        expect(await code(call(as(who))), `${name} as ${who.memberId}`).toBe("FORBIDDEN");
      }
    }
  });

  it("PLATFORM_ADMIN is blocked from the SUPER_ADMIN-only ones and not from the rest", async () => {
    for (const [name, superOnly, call] of platformCalls()) {
      const c = await code(call(as(F.padmin)));
      if (superOnly) expect(c, name).toBe("FORBIDDEN");
      else expect(c, name).not.toBe("FORBIDDEN");
    }
  });

  it("announcements.active is business-side only", async () => {
    expect(await code(as(F.superAdmin).query(api.announcements.active, { now: Date.now() }))).toBe("FORBIDDEN");
    expect(await code(as(F.ownerA).query(api.announcements.active, { now: Date.now() }))).toBe("OK");
  });

  it("platformSettings.get is public", async () => {
    expect(await t.query(api.platformSettings.get, {})).toMatchObject({ signupsOpen: true, paymentInstructions: "" });
  });

  it("member actions only reach business members, never platform staff", async () => {
    const P = as(F.superAdmin);
    expect(await code(P.mutation(api.platformTenants.setMemberActive, { memberId: F.padmin.memberId, isActive: false }))).toBe("NOT_FOUND");
    expect(await code(P.action(api.platformTenants.forceLogout, { memberId: F.padmin.memberId }))).toBe("NOT_FOUND");
    expect(await code(P.action(api.platformTenants.resetMemberPassword, { memberId: F.padmin.memberId, newPassword: "longenough1" }))).toBe("NOT_FOUND");
  });
});

describe("change tracking", () => {
  it("diff only reports changed fields, stringified and capped", () => {
    const long = "x".repeat(300);
    const d = diff(
      { a: 1, b: "same", c: ["x"], d: undefined, e: long },
      { a: 2, b: "same", c: ["x", "y"], d: "now", e: "short" },
      ["a", "b", "c", "d", "e"],
    );
    expect(d).toEqual([
      { field: "a", from: "1", to: "2" },
      { field: "c", from: '["x"]', to: '["x","y"]' },
      { field: "d", from: "", to: "now" },
      { field: "e", from: "x".repeat(200), to: "short" },
    ]);
  });

  it("product.update records module, target and changes", async () => {
    await as(F.ownerA).mutation(api.products.update, {
      productId: F.productId, type: "STOCKABLE", name: "Tea", sku: "", barcode: "", extraBarcodes: [], brand: "", unit: "pcs",
      allowDecimal: false, costCents: 300, priceCents: 999, reorderLevel: 5, trackExpiry: false,
    });
    const row = await t.run((ctx) => ctx.db.query("auditLog").withIndex("by_module", (q) => q.eq("module", "product")).first());
    expect(row).toMatchObject({ action: "product.update", targetId: F.productId, targetName: "Tea", businessId: F.A.businessId });
    expect(row?.changes).toEqual([{ field: "priceCents", from: "500", to: "999" }]);
  });

  it("plan.update records changes", async () => {
    await as(F.superAdmin).mutation(api.platformPlans.update, { planId: F.planId, ...planFields, priceCents: 2500 });
    const row = await t.run((ctx) => ctx.db.query("auditLog").withIndex("by_module", (q) => q.eq("module", "plan")).first());
    expect(row?.changes).toEqual([{ field: "priceCents", from: "1000", to: "2500" }]);
  });

  it("business.extend, changePlan, editProfile and notes are audited with changes", async () => {
    const P = as(F.superAdmin);
    const b = F.A.businessId;
    await P.mutation(api.platformTenants.changePlan, { businessId: b, planId: F.plan2Id });
    await P.mutation(api.platformTenants.extend, { businessId: b, days: 10 });
    await P.mutation(api.platformTenants.editProfile, { businessId: b, name: "A2", phone: "1", city: "Hargeisa", address: "a" });
    const noteId = await P.mutation(api.platformTenants.addNote, { businessId: b, body: "called them" });
    await P.mutation(api.platformTenants.deleteNote, { noteId });
    const rows = await t.run((ctx) => ctx.db.query("auditLog").withIndex("by_business", (q) => q.eq("businessId", b)).take(20));
    const by = (a: string) => rows.find((r) => r.action === a);
    expect(by("business.changePlan")?.changes).toEqual([{ field: "plan", from: "Pro", to: "Other" }]);
    expect(by("business.extend")?.changes?.[0].field).toBe("endsAt");
    expect(by("business.editProfile")?.changes).toEqual([{ field: "name", from: "A", to: "A2" }]);
    expect(by("business.note")).toBeTruthy();
    expect(by("business.noteDelete")).toBeTruthy();
  });

  it("activity list filters by business, module, actor and time; returns the business name", async () => {
    const ids = await t.run(async (ctx) => {
      const base = { actorName: "x", createdAt: 0 };
      const mk = (over: object) => ctx.db.insert("auditLog", { actorMemberId: F.ownerA.memberId, action: "product.update", module: "product", ...base, ...over });
      await mk({ businessId: F.A.businessId, createdAt: 1000 });
      await mk({ businessId: F.A.businessId, module: "customer", action: "customer.update", createdAt: 2000 });
      await mk({ businessId: F.B.businessId, actorMemberId: F.ownerB.memberId, createdAt: 3000 });
      await mk({ actorMemberId: F.superAdmin.memberId, module: "plan", action: "plan.update", createdAt: 4000 });
    });
    void ids;
    const P = as(F.padmin);
    const list = async (a: object) => (await P.query(api.platformActivity.list, { paginationOpts: page, ...a })).page;
    expect((await list({})).map((r) => r.createdAt)).toEqual([4000, 3000, 2000, 1000]);
    const a = await list({ businessId: F.A.businessId });
    expect(a.map((r) => r.createdAt)).toEqual([2000, 1000]);
    expect(a[0].businessName).toBe("A");
    expect((await list({ businessId: F.A.businessId, module: "product" })).map((r) => r.createdAt)).toEqual([1000]);
    expect((await list({ module: "plan" })).map((r) => r.createdAt)).toEqual([4000]);
    expect((await list({ actorMemberId: F.ownerB.memberId })).map((r) => r.createdAt)).toEqual([3000]);
    expect((await list({ from: 1500, to: 3500 })).map((r) => r.createdAt)).toEqual([3000, 2000]);
    expect((await P.query(api.platformActivity.modules, {})).includes("product")).toBe(true);
  });
});

describe("billing", () => {
  it("voidPayment excludes the payment from totals and takes the months back", async () => {
    const P = as(F.superAdmin);
    const b = F.A.businessId;
    await P.mutation(api.platformTenants.recordPayment, { businessId: b, planId: F.planId, amountCents: 1000, months: 1, method: "EVC" });
    await P.mutation(api.platformTenants.recordPayment, { businessId: b, planId: F.planId, amountCents: 3000, months: 3, method: "ZAAD" });
    expect((await P.query(api.platformBilling.totals, {})).totalCents).toBe(4000);
    const rows = (await P.query(api.platformBilling.payments, { paginationOpts: page })).page;
    expect(rows[0]).toMatchObject({ businessName: "A", planName: "Pro", isVoid: false });
    const three = rows.find((r) => r.months === 3)!;
    const before = (await t.run((ctx) => ctx.db.get(b)))!.subscriptionEndsAt;

    await P.mutation(api.platformBilling.voidPayment, { paymentId: three._id, reason: "wrong amount" });
    const after = (await t.run((ctx) => ctx.db.get(b)))!.subscriptionEndsAt;
    expect(before - after).toBe(90 * DAY);
    const totals = await P.query(api.platformBilling.totals, {});
    expect(totals).toMatchObject({ totalCents: 1000, count: 1, byMethod: [{ method: "EVC", cents: 1000, count: 1 }] });
    expect((await P.query(api.platformBilling.totals, { method: "ZAAD" })).totalCents).toBe(0);
    const voided = (await P.query(api.platformBilling.payments, { paginationOpts: page })).page.find((r) => r._id === three._id);
    expect(voided).toMatchObject({ isVoid: true, voidReason: "wrong amount", voidedBy: F.superAdmin.memberId });
    // twice is refused, and the audit row has the end-date change
    expect(await code(P.mutation(api.platformBilling.voidPayment, { paymentId: three._id, reason: "again" }))).toBe("NOT_FOUND");
    const row = await t.run((ctx) => ctx.db.query("auditLog").withIndex("by_module", (q) => q.eq("module", "payment")).first());
    expect(row?.changes?.[0].field).toBe("endsAt");
    // the dashboard ignores voided payments too
    const o = await P.query(api.platformStats.overview, { now: Date.now() });
    expect(o.collectedThisMonthCents).toBe(1000);
  });

  it("voidPayment never pushes the end date before yesterday", async () => {
    const P = as(F.superAdmin);
    const now = Date.now();
    await t.run((ctx) => ctx.db.patch(F.A.businessId, { subscriptionEndsAt: now + 10 * DAY }));
    const id = await t.run((ctx) =>
      ctx.db.insert("subscriptionPayments", {
        businessId: F.A.businessId, planId: F.planId, amountCents: 5, months: 2, method: "CASH", recordedBy: F.superAdmin.memberId, createdAt: now,
      }),
    );
    await P.mutation(api.platformBilling.voidPayment, { paymentId: id, reason: "mistake" });
    const ends = (await t.run((ctx) => ctx.db.get(F.A.businessId)))!.subscriptionEndsAt;
    expect(Math.abs(ends - (now - DAY))).toBeLessThan(10_000);
  });
});

describe("platform staff", () => {
  it("the last SUPER_ADMIN cannot be demoted or deactivated", async () => {
    const S = as(F.superAdmin);
    expect(await code(S.mutation(api.platformStaff.setRole, { memberId: F.superAdmin.memberId, role: "PLATFORM_ADMIN" }))).toBe("LAST_SUPER_ADMIN");
    expect(await code(S.mutation(api.platformStaff.setActive, { memberId: F.superAdmin.memberId, isActive: false }))).toBe("FORBIDDEN");
    // promote a second one: now demoting works for the other, but not once only one is left
    expect(await code(S.mutation(api.platformStaff.setRole, { memberId: F.padmin.memberId, role: "SUPER_ADMIN" }))).toBe("OK");
    expect(await code(S.mutation(api.platformStaff.setRole, { memberId: F.padmin.memberId, role: "PLATFORM_ADMIN" }))).toBe("OK");
    expect(await code(S.mutation(api.platformStaff.setRole, { memberId: F.superAdmin.memberId, role: "PLATFORM_ADMIN" }))).toBe("LAST_SUPER_ADMIN");
    const rows = await S.query(api.platformStaff.list, {});
    expect(rows.find((r) => r.username === "padmin")?.role).toBe("PLATFORM_ADMIN");
    expect(rows[0]).toHaveProperty("lastLoginAt");
    const audit = await t.run((ctx) => ctx.db.query("auditLog").withIndex("by_module", (q) => q.eq("module", "platformStaff")).take(10));
    expect(audit.filter((r) => r.action === "platformStaff.setRole")).toHaveLength(2);
  });
});

describe("platform settings", () => {
  it("signupsOpen=false blocks createBusiness with SIGNUPS_CLOSED", async () => {
    const signup = () =>
      asUser(F.loneUser).mutation(api.onboarding.createBusiness, {
        fullName: "Lone", name: "Shop", businessType: "Grocery", phone: "1", address: "a", city: "c", country: "SO", currency: "usd",
      });
    const set = (signupsOpen: boolean) =>
      as(F.superAdmin).mutation(api.platformSettings.update, {
        paymentInstructions: "Send to 61xxxx", supportPhone: " 252 ", supportWhatsApp: "", supportEmail: "", signupsOpen,
      });
    await set(false);
    expect(await t.query(api.platformSettings.get, {})).toMatchObject({ signupsOpen: false, supportPhone: "252", paymentInstructions: "Send to 61xxxx" });
    expect(await code(signup())).toBe("SIGNUPS_CLOSED");
    await set(true);
    expect(await code(signup())).toBe("OK");
    const rows = await t.run((ctx) => ctx.db.query("auditLog").withIndex("by_module", (q) => q.eq("module", "platformSettings")).take(5));
    expect(rows).toHaveLength(2);
    expect(rows[0].changes?.map((c) => c.field)).toContain("signupsOpen");
  });
  it("signup needs only a shop name: phone/address/city empty, owner name = username", async () => {
    expect(await code(asUser(F.loneUser).mutation(api.onboarding.createBusiness, {
      name: "Hodan Shop", businessType: "General shop", country: "Somalia", currency: "USD", email: "h@example.com",
    }))).toBe("OK");
    const biz = await t.run((ctx) => ctx.db.query("businesses").filter((q) => q.eq(q.field("name"), "Hodan Shop")).first());
    expect(biz).toMatchObject({ phone: "", address: "", city: "", email: "h@example.com" });
    const owner = await t.run((ctx) => ctx.db.query("members").withIndex("by_business", (q) => q.eq("businessId", biz!._id)).first());
    expect(owner?.fullName).toBe(owner?.username);
  });
});

describe("announcements", () => {
  it("shows only active, in-window rows that match the plan and business type", async () => {
    const S = as(F.superAdmin);
    const now = Date.now();
    const mk = (title: string, over: Record<string, unknown> = {}) => S.mutation(api.platformAnnouncements.create, announcement({ title, ...over }));
    await mk("everyone");
    await mk("my plan", { audience: { planIds: [F.planId], businessTypes: [] } });
    await mk("other plan", { audience: { planIds: [F.plan2Id], businessTypes: [] } });
    await mk("grocers", { audience: { planIds: [], businessTypes: ["Grocery"] } });
    await mk("pharmacies", { audience: { planIds: [], businessTypes: ["Pharmacy"] } });
    await mk("off", { isActive: false });
    await mk("ended", { startsAt: now - 3 * DAY, endsAt: now - DAY });
    await mk("future", { startsAt: now + DAY });
    const titles = async (who: { userId: Id<"users"> }) => (await as(who).query(api.announcements.active, { now })).map((r) => r.title).sort();
    expect(await titles(F.ownerA)).toEqual(["everyone", "grocers", "my plan"]);
    expect(await titles(F.managerA)).toEqual(["everyone", "grocers", "my plan"]);
    expect(await titles(F.ownerB)).toEqual(["everyone", "my plan", "pharmacies"]);
    expect(await code(as(F.cashierA).query(api.announcements.active, { now }))).toBe("FORBIDDEN");
  });

  it("CRUD is audited and validates the audience", async () => {
    const S = as(F.superAdmin);
    const id = await S.mutation(api.platformAnnouncements.create, announcement());
    await S.mutation(api.platformAnnouncements.update, { announcementId: id, ...announcement({ title: "New title" }) });
    const titles = (await S.query(api.platformAnnouncements.list, {})).map((r) => r.title);
    expect(titles).toContain("New title");
    expect(titles).not.toContain("Hello");
    expect(await code(S.mutation(api.platformAnnouncements.create, announcement({ endsAt: Date.now() - 2 * DAY })))).toBe("INVALID_INPUT");
    await S.mutation(api.platformAnnouncements.remove, { announcementId: id });
    const actions = (await t.run((ctx) => ctx.db.query("auditLog").withIndex("by_module", (q) => q.eq("module", "announcement")).take(10))).map((r) => r.action);
    expect(actions.sort()).toEqual(["announcement.create", "announcement.remove", "announcement.update"]);
  });
});

describe("business stats rollup", () => {
  it("refreshOne computes sales, counts and last login; overview and tenants use it", async () => {
    const now = Date.now();
    const d = new Date(now);
    const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const lastMonthSale = monthStart - 1000;
    await t.run(async (ctx) => {
      const sale = (n: number, totalCents: number, over: object) =>
        ctx.db.insert("sales", {
          businessId: F.A.businessId, clientSaleId: `s${n}`, receiptNo: n, cashierId: F.ownerA.memberId, cashierName: "x", items: [],
          subtotalCents: totalCents, discountCents: 0, taxCents: 0, totalCents, payments: [], changeCents: 0, refundedCents: 0,
          status: "COMPLETED", createdAt: now, syncedAt: now, ...over,
        });
      await sale(1, 1000, {});
      await sale(2, 500, { status: "PARTIALLY_REFUNDED", refundedCents: 200 });
      await sale(3, 9999, { status: "REFUNDED", refundedCents: 9999 });
      await sale(4, 700, { createdAt: lastMonthSale });
      await sale(5, 4000, { createdAt: now - 90 * DAY }); // outside every window, still the oldest
      await ctx.db.insert("authSessions", { userId: F.ownerA.userId, expirationTime: now + DAY });
    });
    await t.mutation(internal.platformStats.refreshOne, { businessId: F.A.businessId });
    const st = (await t.run((ctx) => ctx.db.query("businessStats").withIndex("by_business", (q) => q.eq("businessId", F.A.businessId)).collect()))[0];
    const in30 = lastMonthSale >= now - 30 * DAY;
    expect(st).toMatchObject({
      businessId: F.A.businessId,
      lastSaleAt: now,
      sales30dCents: 1300 + (in30 ? 700 : 0),
      sales30dCount: 2 + (in30 ? 1 : 0),
      gmvThisMonthCents: 1300,
      gmvLastMonthCents: 700,
      products: 1,
      customers: 0,
      staff: 3,
    });
    expect(st.lastLoginAt).toBeGreaterThan(0);
    // running it again updates the same row
    await t.mutation(internal.platformStats.refreshOne, { businessId: F.A.businessId });
    expect(await t.run((ctx) => ctx.db.query("businessStats").collect())).toHaveLength(1);

    const P = as(F.padmin);
    const o = await P.query(api.platformStats.overview, { now });
    expect(o.counts).toMatchObject({ total: 2, active: 2 });
    expect(o.mrrCents).toBe(2000);
    expect(o.arrCents).toBe(24000);
    expect(o.gmvThisMonthCents).toBe(1300);
    expect(o.health).toEqual({ ACTIVE: 1, QUIET: 0, DORMANT: 1, NEW: 0 }); // B never sold
    expect(o.topByGmv.map((x) => x.name)).toEqual(["A"]);
    expect(o.atRisk.map((x) => x.name)).toEqual(["B"]);
    expect(o.series).toHaveLength(12);
    expect(o.series[11].month).toBe(new Date(now).toISOString().slice(0, 7));
    expect(o.openTickets).toBe(1);
    expect(o.oldestWaitingTicketAt).toBe((await t.run((ctx) => ctx.db.get(F.ticketId)))!.lastMessageAt);
    expect(o.byType.map((x) => x.key).sort()).toEqual(["Grocery", "Pharmacy"]);

    const rows = await P.query(api.platformTenants.list, { now, health: "ACTIVE" });
    expect(rows.map((r) => r.name)).toEqual(["A"]);
    expect(rows[0].stats?.sales30dCents).toBe(st.sales30dCents);
    expect((await P.query(api.platformTenants.list, { now, type: "Pharmacy" })).map((r) => r.name)).toEqual(["B"]);
    expect((await P.query(api.platformTenants.list, { now, planId: F.plan2Id })).length).toBe(0);
    const detail = await P.query(api.platformTenants.get, { businessId: F.A.businessId, now });
    expect(detail.health).toBe("ACTIVE");
    expect(detail.usage).toEqual({ users: { used: 3, max: 5 }, products: { used: 1, max: 100 } });
    expect(detail.openTickets).toHaveLength(1);
    const members = await P.query(api.platformTenants.members, { businessId: F.A.businessId });
    expect(members).toHaveLength(3);
    expect(members.find((m) => m.username === "owner-a")?.lastLoginAt).toBeGreaterThan(0);
    expect(members.find((m) => m.username === "cashier-a")?.lastLoginAt).toBeNull();
  });

  it("setMemberActive locks a business member and audits it", async () => {
    await as(F.padmin).mutation(api.platformTenants.setMemberActive, { memberId: F.cashierA.memberId, isActive: false });
    expect(await code(as(F.cashierA).query(api.staff.list, {}))).toBe("ACCOUNT_LOCKED");
    const row = await t.run((ctx) => ctx.db.query("auditLog").withIndex("by_actor", (q) => q.eq("actorMemberId", F.padmin.memberId)).first());
    expect(row).toMatchObject({ action: "business.setMemberActive", businessId: F.A.businessId });
    expect(row?.changes).toEqual([{ field: "isActive", from: "true", to: "false" }]);
  });
});

describe("support", () => {
  it("assign, filters, waitingSince and firstResponseAt", async () => {
    const P = as(F.padmin);
    expect(await code(P.mutation(api.platformSupport.assign, { ticketId: F.ticketId, memberId: F.ownerA.memberId }))).toBe("NOT_FOUND");
    await P.mutation(api.platformSupport.assign, { ticketId: F.ticketId, memberId: F.padmin.memberId });
    const mine = await P.query(api.platformSupport.list, { mine: true });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ assignedToName: "padmin", businessName: "A" });
    expect(mine[0].waitingSince).not.toBeNull();
    expect(await as(F.superAdmin).query(api.platformSupport.list, { mine: true })).toHaveLength(0);
    expect(await as(F.superAdmin).query(api.platformSupport.list, { assignedTo: F.padmin.memberId })).toHaveLength(1);
    expect(await P.query(api.platformSupport.list, { priority: "HIGH" })).toHaveLength(0);
    await P.mutation(api.platformSupport.setPriority, { ticketId: F.ticketId, priority: "HIGH" });
    expect(await P.query(api.platformSupport.list, { priority: "HIGH" })).toHaveLength(1);

    await P.mutation(api.platformSupport.reply, { ticketId: F.ticketId, body: "hi" });
    const first = (await t.run((ctx) => ctx.db.get(F.ticketId)))!.firstResponseAt;
    expect(first).toBeGreaterThan(0);
    await P.mutation(api.platformSupport.reply, { ticketId: F.ticketId, body: "again" });
    expect((await t.run((ctx) => ctx.db.get(F.ticketId)))!.firstResponseAt).toBe(first);
    expect((await P.query(api.platformSupport.list, {}))[0].waitingSince).toBeNull();
    await P.mutation(api.platformSupport.assign, { ticketId: F.ticketId, memberId: null });
    expect((await t.run((ctx) => ctx.db.get(F.ticketId)))!.assignedTo).toBeUndefined();
  });
});

describe("security", () => {
  it("recentLogins joins members and lockouts lists only locked accounts", async () => {
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("authSessions", { userId: F.cashierA.userId, expirationTime: now + DAY });
      const acc = await ctx.db.insert("authAccounts", { userId: F.cashierA.userId, provider: "password", providerAccountId: "cashier-a" });
      await ctx.db.insert("authRateLimits", { identifier: acc, lastAttemptTime: now, attemptsLeft: 0 });
      await ctx.db.insert("authRateLimits", { identifier: "owner-a", lastAttemptTime: now, attemptsLeft: 7 });
      await ctx.db.insert("authRateLimits", { identifier: "old", lastAttemptTime: now - 2 * 3_600_000, attemptsLeft: 0 }); // regenerated
    });
    const P = as(F.padmin);
    const logins = await P.query(api.platformSecurity.recentLogins, { limit: 10 });
    expect(logins[0]).toMatchObject({ username: "cashier-a", role: "CASHIER", businessName: "A" });
    const locked = await P.query(api.platformSecurity.lockouts, { now });
    expect(locked.map((l) => l.identifier)).toEqual(["cashier-a"]); // resolved from the authAccounts id
    expect(locked[0]).toMatchObject({ role: "CASHIER" });
    expect(locked[0].unlocksAt).toBeGreaterThan(now);
  });
});
