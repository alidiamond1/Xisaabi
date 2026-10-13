/// <reference types="vite/client" />
// Tenant-isolation & role-boundary tests. Run: npm test
// Auth is simulated: Convex Auth's getAuthUserId reads identity.subject = "<userId>|<sessionId>".
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { MODULE_KEYS } from "./shared/modules";

const modules = import.meta.glob("./**/*.*s");
const DAY = 86_400_000;

type Role = "OWNER" | "MANAGER" | "CASHIER" | "SUPER_ADMIN" | "PLATFORM_ADMIN";

/** Run a call and return "OK" or the ConvexError code (or the raw message). */
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    const d = (e as { data?: unknown }).data;
    return typeof d === "string" ? d : `RAW:${(e as Error).message}`;
  }
}

const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;
let t: T;
let F: Awaited<ReturnType<typeof build>>;

async function build(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const planId = await ctx.db.insert("plans", {
      name: "Pro", description: "all", priceCents: 0, trialDays: 14, maxUsers: 0, maxProducts: 0,
      modules: MODULE_KEYS, features: [], isDefaultTrial: true, isActive: true, sortOrder: 0,
    });
    const mkBiz = async (name: string, over: Partial<{ status: "ACTIVE" | "SUSPENDED"; ends: number }> = {}) => {
      const ownerUserId = await ctx.db.insert("users", { email: `${name}-owner`, name });
      const businessId = await ctx.db.insert("businesses", {
        name, businessType: "Grocery", phone: "1", address: "a", city: "c", country: "SO", currency: "USD",
        ownerUserId, status: over.status ?? "ACTIVE", planId, subscriptionStatus: "ACTIVE",
        subscriptionEndsAt: over.ends ?? now + 365 * DAY,
        settings: {
          taxRatePercent: 0, lowStockThreshold: 5, allowNegativeStock: false,
          paymentMethods: ["CASH", "EVC", "ZAAD", "EDAHAB", "CREDIT"], maxCashierDiscountPercent: 10,
          defaultCreditLimitCents: 0, expenseCategories: ["Rent", "Other"], discountPresets: [5, 10],
        },
        createdAt: now,
      });
      return { businessId, ownerUserId };
    };
    const mkMember = async (
      role: Role, username: string, businessId?: Id<"businesses">, opts: { userId?: Id<"users">; isActive?: boolean } = {},
    ) => {
      const userId = opts.userId ?? (await ctx.db.insert("users", { email: username, name: username }));
      const memberId = await ctx.db.insert("members", {
        userId, businessId, role, username, fullName: username, isActive: opts.isActive ?? true, createdAt: now,
      });
      return { userId, memberId };
    };
    const A = await mkBiz("A");
    const B = await mkBiz("B");
    const C = await mkBiz("C", { status: "SUSPENDED" });
    const D = await mkBiz("D", { ends: now - 1000 });
    const ownerA = await mkMember("OWNER", "owner-a", A.businessId, { userId: A.ownerUserId });
    const managerA = await mkMember("MANAGER", "manager-a", A.businessId);
    const cashierA = await mkMember("CASHIER", "cashier-a", A.businessId);
    const lockedA = await mkMember("CASHIER", "locked-a", A.businessId, { isActive: false });
    const ownerB = await mkMember("OWNER", "owner-b", B.businessId, { userId: B.ownerUserId });
    const ownerC = await mkMember("OWNER", "owner-c", C.businessId, { userId: C.ownerUserId });
    const ownerD = await mkMember("OWNER", "owner-d", D.businessId, { userId: D.ownerUserId });
    const superAdmin = await mkMember("SUPER_ADMIN", "super");
    const padmin = await mkMember("PLATFORM_ADMIN", "padmin");
    const loneUser = await ctx.db.insert("users", { email: "lone", name: "lone" }); // signed up, no member

    const seed = async (businessId: Id<"businesses">, ownerMember: Id<"members">, tag: string) => {
      const productId = await ctx.db.insert("products", {
        businessId, type: "STOCKABLE", sku: "", barcode: `${tag}-code`, extraBarcodes: [], name: `${tag}-secret-product`,
        brand: "", unit: "pcs", allowDecimal: false, costCents: 300, priceCents: 500, stock: 10, reorderLevel: 5,
        trackExpiry: false, hasVariants: false, isArchived: false, updatedAt: now,
      });
      const batchId = await ctx.db.insert("batches", {
        businessId, productId, batchNo: `${tag}-batch`, qty: 3, costCents: 300, expiryDate: now + 30 * DAY, receivedAt: now,
      });
      const shiftId = await ctx.db.insert("shifts", {
        businessId, memberId: ownerMember, memberName: tag, status: "CLOSED", openingFloatCents: 0, openedAt: now - 5000,
        closedAt: now - 4000, expectedCashCents: 0, countedCashCents: 0,
      });
      const customerId = await ctx.db.insert("customers", {
        businessId, fullName: `${tag}-secret-customer`, phone: `${tag}-555`, whatsapp: "", type: "INDIVIDUAL", companyName: "",
        group: "RETAIL", address: "", district: "", notes: "", creditLimitCents: 1000, creditBlocked: false, balanceCents: 400, createdAt: now,
      });
      const saleId = await ctx.db.insert("sales", {
        businessId, clientSaleId: `${tag}-sale`, receiptNo: 1, cashierId: ownerMember, cashierName: tag,
        items: [{ productId, name: `${tag}-secret-product`, qty: 1, priceCents: 500, discountCents: 0, costCents: 300, refundedQty: 0 }],
        subtotalCents: 500, discountCents: 0, taxCents: 0, totalCents: 500,
        payments: [{ method: "CASH", amountCents: 500 }], changeCents: 0, refundedCents: 0,
        status: "COMPLETED", createdAt: now - 1000, syncedAt: now,
      });
      const expenseId = await ctx.db.insert("expenses", {
        businessId, category: `${tag}-rent`, amountCents: 700, paidVia: "CASH", payee: "", note: "", spentAt: now - 1000, createdBy: ownerMember, createdAt: now,
      });
      const ticketId = await ctx.db.insert("tickets", {
        businessId, subject: `${tag}-secret-ticket`, category: "OTHER", priority: "LOW", status: "OPEN",
        createdBy: ownerMember, unreadByPlatform: true, unreadByBusiness: false, lastMessageAt: now, createdAt: now,
      });
      await ctx.db.insert("ticketMessages", {
        ticketId, businessId, authorMemberId: ownerMember, authorName: tag, fromPlatform: false, body: `${tag}-body`, createdAt: now,
      });
      await ctx.db.insert("ledger", {
        businessId, customerId, type: "DEBT", amountCents: 400, balanceAfterCents: 400, createdBy: ownerMember, createdAt: now,
      });
      return { productId, batchId, shiftId, customerId, saleId, expenseId, ticketId };
    };
    const dataA = await seed(A.businessId, ownerA.memberId, "A");
    const dataB = await seed(B.businessId, ownerB.memberId, "B");
    return { planId, A, B, C, D, ownerA, managerA, cashierA, lockedA, ownerB, ownerC, ownerD, superAdmin, padmin, loneUser, dataA, dataB };
  });
}

const as = (u: { userId: Id<"users"> }) => t.withIdentity({ subject: `${u.userId}|fakesession` });
const asUser = (userId: Id<"users">) => as({ userId });

beforeEach(async () => {
  t = makeT();
  F = await build(t);
});

const productFields = {
  type: "STOCKABLE" as const, name: "x", sku: "", barcode: "", extraBarcodes: [] as string[], brand: "", unit: "pcs",
  allowDecimal: false, costCents: 1, priceCents: 2, reorderLevel: 0, trackExpiry: false,
};
const custFields = {
  type: "INDIVIDUAL" as const, companyName: "", group: "RETAIL" as const, whatsapp: "", address: "", district: "", notes: "",
};
/** sale args: one cash payment covering `total` unless overridden */
const saleArgs = (productId: Id<"products">, over: Record<string, unknown> = {}, qty = 1, total = 500 * qty) => ({
  clientSaleId: "s", items: [{ productId, qty, discountCents: 0 }], orderDiscountCents: 0,
  payments: [{ method: "CASH" as const, amountCents: total }], createdAt: Date.now(), ...over,
});

/** Snapshot of everything B owns, to prove nothing changed. */
const snapB = () =>
  t.run(async (ctx) => {
    const d = F.dataB;
    return JSON.stringify([
      await ctx.db.get(d.productId), await ctx.db.get(d.customerId), await ctx.db.get(d.saleId),
      await ctx.db.get(d.expenseId), await ctx.db.get(d.ticketId), await ctx.db.get(F.ownerB.memberId),
      await ctx.db.get(d.shiftId), await ctx.db.get(d.batchId),
      await ctx.db.query("ledger").collect(), await ctx.db.query("ticketMessages").collect(), await ctx.db.query("refunds").collect(),
    ]);
  });

describe("1. cross-tenant ids are rejected", () => {
  it("A's owner cannot touch B's rows", async () => {
    const A = as(F.ownerA);
    const b = F.dataB;
    const before = await snapB();
    const calls: Record<string, () => Promise<unknown>> = {
      "products.update": () => A.mutation(api.products.update, { productId: b.productId, ...productFields }),
      "products.archive": () => A.mutation(api.products.archive, { productId: b.productId, archived: true }),
      "inventory.adjust": () => A.mutation(api.inventory.adjust, { productId: b.productId, delta: 5, reason: "OTHER" }),
      "expiry.setPrice": () => A.mutation(api.expiry.setPrice, { productId: b.productId, priceCents: 1 }),
      "expiry.writeOff": () => A.mutation(api.expiry.writeOff, { batchId: b.batchId }),
      "customers.get": () => A.query(api.customers.get, { customerId: b.customerId }),
      "customers.update": () => A.mutation(api.customers.update, { customerId: b.customerId, ...custFields, fullName: "pwn", phone: "1", creditLimitCents: 0 }),
      "customers.setCreditBlocked": () => A.mutation(api.customers.setCreditBlocked, { customerId: b.customerId, blocked: true }),
      "customers.adjustBalance": () => A.mutation(api.customers.adjustBalance, { customerId: b.customerId, direction: "UP", amountCents: 100, note: "x" }),
      "customers.writeOff": () => A.mutation(api.customers.writeOff, { customerId: b.customerId, note: "x" }),
      "customers.statement": () => A.query(api.customers.statement, { customerId: b.customerId, from: 0, to: Date.now() + DAY }),
      "shifts.report": () => A.query(api.shifts.report, { shiftId: b.shiftId }),
      "sales.list(B shift)": () => A.query(api.sales.list, { from: 0, to: Date.now() + DAY, shiftId: b.shiftId }),
      "sales.list(B customer)": () => A.query(api.sales.list, { from: 0, to: Date.now() + DAY, customerId: b.customerId }),
      "expenses.update": () => A.mutation(api.expenses.update, { expenseId: b.expenseId, category: "Rent", amountCents: 1, paidVia: "CASH", payee: "", note: "", spentAt: Date.now() }),
      "customers.recordPayment": () => A.mutation(api.customers.recordPayment, { customerId: b.customerId, amountCents: 100, method: "CASH" }),
      "sales.get": () => A.query(api.sales.get, { saleId: b.saleId }),
      "sales.refund": () => A.mutation(api.sales.refund, { saleId: b.saleId, items: [{ productId: b.productId, qty: 1, restock: true }], method: "CASH", reason: "x" }),
      "sales.create(B product)": () => A.mutation(api.sales.create, saleArgs(b.productId, { clientSaleId: "x1" })),
      "sales.create(B customer)": () => A.mutation(api.sales.create, saleArgs(F.dataA.productId, {
        clientSaleId: "x2", customerId: b.customerId, payments: [{ method: "CREDIT", amountCents: 500 }],
      })),
      "sales.list(B cashier)": () => A.query(api.sales.list, { from: 0, to: Date.now() + DAY, cashierId: F.ownerB.memberId }),
      "support.get": () => A.query(api.support.get, { ticketId: b.ticketId }),
      "support.markRead": () => A.mutation(api.support.markRead, { ticketId: b.ticketId }),
      "support.reply": () => A.mutation(api.support.reply, { ticketId: b.ticketId, body: "hi" }),
      "support.close": () => A.mutation(api.support.close, { ticketId: b.ticketId }),
      "expenses.remove": () => A.mutation(api.expenses.remove, { expenseId: b.expenseId }),
      "staff.update": () => A.mutation(api.staff.update, { memberId: F.ownerB.memberId, fullName: "pwn", role: "CASHIER" }),
      "staff.setActive": () => A.mutation(api.staff.setActive, { memberId: F.ownerB.memberId, isActive: false }),
      // action: the internal access-check it runs before touching credentials
      "staff.checkReset": () => A.query(internal.staff.checkReset, { memberId: F.ownerB.memberId }),
    };
    for (const [name, p] of Object.entries(calls)) {
      const c = await code(p());
      expect(["NOT_FOUND", "FORBIDDEN"], `${name} -> ${c}`).toContain(c);
    }
    expect(await snapB()).toBe(before);
  });

  it("staff.resetPassword action is rejected for B's member (before touching credentials)", async () => {
    const c = await code(as(F.ownerA).action(api.staff.resetPassword, { memberId: F.ownerB.memberId, newPassword: "longenough1" }));
    expect(["NOT_FOUND", "FORBIDDEN"]).toContain(c);
  });

  it("platform members are not addressable via business staff functions", async () => {
    const A = as(F.ownerA);
    expect(await code(A.mutation(api.staff.setActive, { memberId: F.superAdmin.memberId, isActive: false }))).toBe("NOT_FOUND");
    expect(await code(A.mutation(api.staff.update, { memberId: F.superAdmin.memberId, fullName: "x", role: "CASHIER" }))).toBe("NOT_FOUND");
  });
});

describe("2. list queries never leak B", () => {
  it("A sees only A rows", async () => {
    const A = as(F.ownerA);
    const now = Date.now();
    const results = {
      products: await A.query(api.products.list, {}),
      productsSearch: await A.query(api.products.list, { search: "A-secret-product" }),
      productsB: await A.query(api.products.list, { search: "B-secret-product" }),
      productsBArchived: await A.query(api.products.list, { search: "B-secret-product", filter: "ARCHIVED" }),
      customersB: await A.query(api.customers.list, { search: "B-secret-customer" }),
      productsBarcode: await A.query(api.products.list, { search: "B-code" }),
      catalog: await A.query(api.products.posCatalog, {}),
      categories: await A.query(api.categories.list, {}),
      shifts: await A.query(api.shifts.list, { from: 0, to: now + DAY }),
      debtors: await A.query(api.reports.debtors, {}),
      customers: await A.query(api.customers.list, {}),
      customersSearch: await A.query(api.customers.list, { search: "A-secret-customer" }),
      customersPhone: await A.query(api.customers.list, { search: "B-5" }),
      sales: await A.query(api.sales.list, { from: 0, to: now + DAY }),
      recent: await A.query(api.sales.recentForCashier, {}),
      expenses: await A.query(api.expenses.list, { from: 0, to: now + DAY }),
      tickets: await A.query(api.support.list, {}),
      staff: await A.query(api.staff.list, {}),
      watch: await A.query(api.expiry.watchlist, {}),
      report: await A.query(api.reports.summary, { from: now - 2 * DAY, to: now + DAY }),
      home: await A.query(api.dashboard.home, {}),
      billing: await A.query(api.billing.current, {}),
      settings: await A.query(api.settings.get, {}),
    };
    const dump = JSON.stringify(results);
    expect(dump).not.toContain("B-secret");
    expect(dump).not.toContain("B-code");
    expect(dump).not.toContain("B-rent");
    expect(dump).not.toContain("owner-b");
    expect(dump).not.toContain(F.dataB.productId);
    expect(dump).not.toContain(F.B.businessId);
    // sanity: A's own data IS there
    expect(results.products.map((p) => p.name)).toEqual(["A-secret-product"]);
    expect(results.productsSearch).toHaveLength(1);
    expect(results.productsB).toHaveLength(0);
    expect(results.customersB).toHaveLength(0);
    expect(results.customersSearch).toHaveLength(1);
    expect(results.report.revenueCents).toBe(500);
    expect(results.report.expensesCents).toBe(700);
    expect(results.report.outstandingDebtCents).toBe(400);
    // no auth internals / password hashes
    expect(dump).not.toMatch(/secret"?:"\$/); // argon/scrypt hashes start with $
    expect(results.staff.every((m) => !("userId" in m))).toBe(true);
  });
});

describe("3. business users cannot reach platform functions", () => {
  const calls = (): Array<[string, (c: ReturnType<typeof as>) => Promise<unknown>]> => {
    const b = F.B.businessId;
    const plan = {
      name: "p", description: "d", priceCents: 1, trialDays: 0, maxUsers: 0, maxProducts: 0, modules: [] as never[],
      features: [], isDefaultTrial: false, isActive: true, sortOrder: 1,
    };
    return [
      ["platformTenants.list", (c) => c.query(api.platformTenants.list, { now: Date.now() })],
      ["platformTenants.get", (c) => c.query(api.platformTenants.get, { businessId: b, now: Date.now() })],
      ["platformTenants.suspend", (c) => c.mutation(api.platformTenants.suspend, { businessId: b, reason: "x" })],
      ["platformTenants.activate", (c) => c.mutation(api.platformTenants.activate, { businessId: b })],
      ["platformTenants.changePlan", (c) => c.mutation(api.platformTenants.changePlan, { businessId: b, planId: F.planId })],
      ["platformTenants.extend", (c) => c.mutation(api.platformTenants.extend, { businessId: b, days: 5 })],
      ["platformTenants.recordPayment", (c) =>
        c.mutation(api.platformTenants.recordPayment, { businessId: b, planId: F.planId, amountCents: 1, months: 1, method: "CASH" })],
      ["platformPlans.list", (c) => c.query(api.platformPlans.list, {})],
      ["platformPlans.create", (c) => c.mutation(api.platformPlans.create, plan)],
      ["platformPlans.update", (c) => c.mutation(api.platformPlans.update, { planId: F.planId, ...plan })],
      ["platformPlans.setActive", (c) => c.mutation(api.platformPlans.setActive, { planId: F.planId, isActive: false })],
      ["platformSupport.list", (c) => c.query(api.platformSupport.list, {})],
      ["platformSupport.get", (c) => c.query(api.platformSupport.get, { ticketId: F.dataB.ticketId })],
      ["platformSupport.reply", (c) => c.mutation(api.platformSupport.reply, { ticketId: F.dataB.ticketId, body: "x" })],
      ["platformSupport.setStatus", (c) => c.mutation(api.platformSupport.setStatus, { ticketId: F.dataB.ticketId, status: "CLOSED" })],
      ["platformSupport.markRead", (c) => c.mutation(api.platformSupport.markRead, { ticketId: F.dataB.ticketId })],
      ["platformStaff.list", (c) => c.query(api.platformStaff.list, {})],
      ["platformStaff.setActive", (c) => c.mutation(api.platformStaff.setActive, { memberId: F.padmin.memberId, isActive: false })],
      ["platformStaff.checkCreate", (c) => c.query(internal.platformStaff.checkCreate, { username: "newadmin" })],
      ["platformStaff.insertMember", (c) =>
        c.mutation(internal.platformStaff.insertMember, { userId: F.loneUser, username: "newadmin", fullName: "x" })],
      ["platformStats.overview", (c) => c.query(api.platformStats.overview, { now: Date.now() })],
      ["platformAudit.list", (c) => c.query(api.platformActivity.list, { paginationOpts: { numItems: 5, cursor: null } })],
    ];
  };

  for (const [label, who] of [["OWNER", () => F.ownerA], ["MANAGER", () => F.managerA], ["CASHIER", () => F.cashierA]] as const) {
    it(`${label} gets FORBIDDEN everywhere`, async () => {
      for (const [name, fn] of calls()) {
        expect(await code(fn(as(who()))), `${label} ${name}`).toBe("FORBIDDEN");
      }
    });
  }

  it("platformStaff.create action is FORBIDDEN for a business owner (before createAccount)", async () => {
    const c = await code(
      as(F.ownerA).action(api.platformStaff.create, { fullName: "evil", username: "evil-admin", password: "longenough1" }),
    );
    expect(c).toBe("FORBIDDEN");
    const n = await t.run(async (ctx) => (await ctx.db.query("members").collect()).filter((m) => m.username === "evil-admin").length);
    expect(n).toBe(0);
  });
});

describe("4. SUPER_ADMIN-only functions", () => {
  const plan = {
    name: "p2", description: "d", priceCents: 1, trialDays: 0, maxUsers: 0, maxProducts: 0, modules: [] as never[],
    features: [], isDefaultTrial: false, isActive: true, sortOrder: 1,
  };
  it("PLATFORM_ADMIN is FORBIDDEN", async () => {
    const P = as(F.padmin);
    expect(await code(P.mutation(api.platformPlans.create, plan))).toBe("FORBIDDEN");
    expect(await code(P.mutation(api.platformPlans.update, { planId: F.planId, ...plan }))).toBe("FORBIDDEN");
    expect(await code(P.mutation(api.platformPlans.setActive, { planId: F.planId, isActive: false }))).toBe("FORBIDDEN");
    expect(await code(P.query(api.platformStaff.list, {}))).toBe("FORBIDDEN");
    expect(await code(P.mutation(api.platformStaff.setActive, { memberId: F.superAdmin.memberId, isActive: false }))).toBe("FORBIDDEN");
    expect(await code(P.query(internal.platformStaff.checkCreate, { username: "zzz" }))).toBe("FORBIDDEN");
    expect(await code(P.mutation(internal.platformStaff.insertMember, { userId: F.loneUser, username: "zzz", fullName: "z" }))).toBe("FORBIDDEN");
    expect(await code(P.action(api.platformStaff.create, { fullName: "z", username: "zzz", password: "longenough1" }))).toBe("FORBIDDEN");
    // but day-to-day platform work is allowed
    expect(await code(P.query(api.platformPlans.list, {}))).toBe("OK");
    expect(await code(P.query(api.platformTenants.list, { now: Date.now() }))).toBe("OK");
    expect(await code(P.mutation(api.platformTenants.extend, { businessId: F.A.businessId, days: 1 }))).toBe("OK");
    expect(await code(P.query(api.platformStats.overview, { now: Date.now() }))).toBe("OK");
  });
  it("SUPER_ADMIN is allowed", async () => {
    const S = as(F.superAdmin);
    expect(await code(S.mutation(api.platformPlans.create, plan))).toBe("OK");
    expect(await code(S.mutation(api.platformPlans.update, { planId: F.planId, ...plan, isDefaultTrial: true }))).toBe("OK");
    expect(await code(S.mutation(api.platformPlans.setActive, { planId: F.planId, isActive: true }))).toBe("OK");
    expect(await code(S.query(api.platformStaff.list, {}))).toBe("OK");
    expect(await code(S.mutation(api.platformStaff.setActive, { memberId: F.padmin.memberId, isActive: false }))).toBe("OK");
    expect(await code(S.mutation(api.platformStaff.setActive, { memberId: F.superAdmin.memberId, isActive: false }))).toBe("FORBIDDEN"); // not self
    expect(await code(S.query(internal.platformStaff.checkCreate, { username: "fresh-admin" }))).toBe("OK");
    expect(await code(S.query(internal.platformStaff.checkCreate, { username: "padmin" }))).toBe("USERNAME_TAKEN");
  });
  it("a deactivated platform admin is locked out", async () => {
    await as(F.superAdmin).mutation(api.platformStaff.setActive, { memberId: F.padmin.memberId, isActive: false });
    expect(await code(as(F.padmin).query(api.platformTenants.list, { now: Date.now() }))).toBe("FORBIDDEN");
  });
  it("platform users cannot use business functions", async () => {
    expect(await code(as(F.superAdmin).query(api.products.list, {}))).toBe("FORBIDDEN");
    expect(await code(as(F.padmin).query(api.staff.list, {}))).toBe("FORBIDDEN");
  });
});

describe("5. CASHIER boundaries", () => {
  it("is FORBIDDEN on manager/owner functions", async () => {
    const C = as(F.cashierA);
    const now = Date.now();
    expect(await code(C.query(api.reports.summary, { from: now - DAY, to: now }))).toBe("FORBIDDEN");
    expect(await code(C.mutation(api.products.create, productFields))).toBe("FORBIDDEN");
    expect(await code(C.mutation(api.inventory.adjust, { productId: F.dataA.productId, delta: 1, reason: "OTHER" }))).toBe("FORBIDDEN");
    expect(await code(C.query(api.products.list, {}))).toBe("FORBIDDEN");
    // cashiers can open POS but have no refund permission
    expect(await code(C.mutation(api.sales.refund, { saleId: F.dataA.saleId, items: [{ productId: F.dataA.productId, qty: 1, restock: true }], method: "CASH", reason: "x" }))).toBe("NO_PERMISSION");
    expect(await code(C.query(api.reports.debtors, {}))).toBe("FORBIDDEN");
    expect(await code(C.query(api.shifts.list, { from: 0, to: now }))).toBe("FORBIDDEN");
    expect(await code(C.query(api.sales.list, { from: 0, to: now }))).toBe("FORBIDDEN");
    expect(await code(C.query(api.staff.list, {}))).toBe("FORBIDDEN");
    expect(await code(C.mutation(api.staff.setActive, { memberId: F.managerA.memberId, isActive: false }))).toBe("FORBIDDEN");
    expect(await code(C.query(api.settings.get, {}))).toBe("FORBIDDEN");
    expect(await code(C.query(api.billing.current, {}))).toBe("FORBIDDEN");
    expect(await code(C.query(api.expenses.list, { from: 0, to: now }))).toBe("FORBIDDEN");
    expect(await code(C.query(api.expiry.watchlist, {}))).toBe("FORBIDDEN");
    expect(await code(C.query(api.support.list, {}))).toBe("FORBIDDEN");
    expect(await code(C.action(api.staff.create, { fullName: "x", username: "newguy", password: "longenough1", role: "CASHIER" }))).toBe("FORBIDDEN");
  });
  it("can use POS and customers; dashboard/alertCount give null", async () => {
    const C = as(F.cashierA);
    expect(await code(C.query(api.products.posCatalog, {}))).toBe("OK");
    expect(await code(C.query(api.customers.list, {}))).toBe("OK");
    expect(await code(C.mutation(api.customers.recordPayment, { customerId: F.dataA.customerId, amountCents: 100, method: "CASH" }))).toBe("OK");
    expect(await C.query(api.dashboard.home, {})).toBeNull();
    expect(await C.query(api.expiry.alertCount, {})).toBeNull();
  });
  it("cannot raise a customer's credit limit", async () => {
    const C = as(F.cashierA);
    const cu = { customerId: F.dataA.customerId, ...custFields, fullName: "A-secret-customer", phone: "A-555" };
    expect(await code(C.mutation(api.customers.update, { ...cu, creditLimitCents: 0 }))).toBe("FORBIDDEN");
    expect(await code(C.mutation(api.customers.update, { ...cu, creditLimitCents: 1000 }))).toBe("OK"); // unchanged limit: allowed
    expect(await code(as(F.managerA).mutation(api.customers.update, { ...cu, creditLimitCents: 5000 }))).toBe("OK");
  });
});

describe("6. MANAGER boundaries", () => {
  it("cannot touch the OWNER or other managers", async () => {
    const M = as(F.managerA);
    expect(await code(M.mutation(api.staff.update, { memberId: F.ownerA.memberId, fullName: "x", role: "CASHIER" }))).toBe("FORBIDDEN");
    expect(await code(M.mutation(api.staff.setActive, { memberId: F.ownerA.memberId, isActive: false }))).toBe("FORBIDDEN");
    expect(await code(M.mutation(api.staff.setActive, { memberId: F.managerA.memberId, isActive: false }))).toBe("FORBIDDEN"); // self
    expect(await code(M.query(internal.staff.checkReset, { memberId: F.ownerA.memberId }))).toBe("FORBIDDEN");
    expect(await code(M.action(api.staff.resetPassword, { memberId: F.ownerA.memberId, newPassword: "longenough1" }))).toBe("FORBIDDEN");
    // cannot create managers / owners
    expect(await code(M.query(internal.staff.checkCreate, { username: "newmgr", role: "MANAGER" }))).toBe("FORBIDDEN");
    expect(await code(M.query(internal.staff.checkCreate, { username: "newcash", role: "CASHIER" }))).toBe("OK");
    // cannot promote a cashier to manager
    expect(await code(M.mutation(api.staff.update, { memberId: F.cashierA.memberId, fullName: "x", role: "MANAGER" }))).toBe("FORBIDDEN");
    // may manage cashiers
    expect(await code(M.mutation(api.staff.update, { memberId: F.cashierA.memberId, fullName: "x", role: "CASHIER" }))).toBe("OK");
    expect(await code(M.mutation(api.staff.setActive, { memberId: F.cashierA.memberId, isActive: false }))).toBe("OK");
  });
  it("cannot use settings / billing", async () => {
    const M = as(F.managerA);
    const p = { name: "x", businessType: "x", phone: "1", address: "a", city: "c", country: "SO", currency: "USD" };
    expect(await code(M.mutation(api.settings.updateProfile, p))).toBe("FORBIDDEN");
    expect(await code(M.mutation(api.settings.updateSettings, { taxRatePercent: 0, lowStockThreshold: 1, allowNegativeStock: true }))).toBe("FORBIDDEN");
    expect(await code(M.mutation(api.settings.generateUploadUrl, {}))).toBe("FORBIDDEN");
    expect(await code(M.query(api.billing.current, {}))).toBe("FORBIDDEN");
    expect(await code(M.mutation(api.billing.requestPlan, { planId: F.planId }))).toBe("FORBIDDEN");
  });
});

describe("OWNER boundaries", () => {
  it("cannot lock self or demote self; can manage managers", async () => {
    const O = as(F.ownerA);
    expect(await code(O.mutation(api.staff.setActive, { memberId: F.ownerA.memberId, isActive: false }))).toBe("FORBIDDEN");
    expect(await code(O.mutation(api.staff.update, { memberId: F.ownerA.memberId, fullName: "x", role: "CASHIER" }))).toBe("FORBIDDEN");
    expect(await code(O.mutation(api.staff.setActive, { memberId: F.managerA.memberId, isActive: false }))).toBe("OK");
    expect(await code(O.query(internal.staff.checkCreate, { username: "newmgr", role: "MANAGER" }))).toBe("OK");
  });
  it("insertMember refuses a user that already has a member (no account hijack/dup membership)", async () => {
    const c = await code(as(F.ownerA).mutation(internal.staff.insertMember, {
      userId: F.ownerB.userId, username: "dup-b", fullName: "x", role: "CASHIER",
    }));
    expect(c).toBe("USERNAME_TAKEN");
  });
});

describe("7. suspended / expired businesses", () => {
  const sale = (productId: Id<"products">) => ({
    ...saleArgs(productId, { clientSaleId: "s-1" }),
  });
  it("C suspended", async () => {
    const C = as(F.ownerC);
    expect(await code(C.mutation(api.sales.create, sale(F.dataA.productId)))).toBe("BUSINESS_SUSPENDED");
    expect(await code(C.query(api.products.list, {}))).toBe("BUSINESS_SUSPENDED");
    expect(await code(C.query(api.staff.list, {}))).toBe("BUSINESS_SUSPENDED");
    expect(await code(C.query(api.reports.summary, { from: 0, to: DAY }))).toBe("BUSINESS_SUSPENDED");
    expect(await C.query(api.dashboard.home, {})).toBeNull();
  });
  it("D expired", async () => {
    const D = as(F.ownerD);
    expect(await code(D.mutation(api.sales.create, sale(F.dataA.productId)))).toBe("SUBSCRIPTION_EXPIRED");
    expect(await code(D.query(api.products.list, {}))).toBe("SUBSCRIPTION_EXPIRED");
    expect(await code(D.mutation(api.products.create, productFields))).toBe("SUBSCRIPTION_EXPIRED");
  });
  it("support, settings and billing still work when locked", async () => {
    for (const o of [F.ownerC, F.ownerD]) {
      const O = as(o);
      expect(await code(O.mutation(api.support.create, { subject: "help", category: "BILLING", priority: "HIGH", body: "pls" }))).toBe("OK");
      expect(await code(O.query(api.support.list, {}))).toBe("OK");
      expect(await code(O.query(api.settings.get, {}))).toBe("OK");
      expect(await code(O.query(api.billing.current, {}))).toBe("OK");
      expect(await code(O.mutation(api.billing.requestPlan, { planId: F.planId }))).toBe("OK");
    }
  });
  it("platform staff can still read a suspended tenant", async () => {
    expect(await code(as(F.padmin).query(api.platformTenants.get, { businessId: F.C.businessId, now: Date.now() }))).toBe("OK");
  });
});

describe("8. locked member", () => {
  it("isActive=false -> ACCOUNT_LOCKED everywhere (incl. support)", async () => {
    const L = as(F.lockedA);
    expect(await code(L.query(api.products.posCatalog, {}))).toBe("ACCOUNT_LOCKED");
    expect(await code(L.mutation(api.customers.create, { ...custFields, fullName: "x", phone: "1", creditLimitCents: 0, openingBalanceCents: 0 }))).toBe("ACCOUNT_LOCKED");
    expect(await code(L.query(api.sales.recentForCashier, {}))).toBe("ACCOUNT_LOCKED");
    expect(await code(L.mutation(api.support.create, { subject: "s", category: "OTHER", priority: "LOW", body: "b" }))).toBe("ACCOUNT_LOCKED");
    expect(await L.query(api.dashboard.home, {})).toBeNull();
  });
  it("owner locking a cashier takes effect immediately", async () => {
    await as(F.ownerA).mutation(api.staff.setActive, { memberId: F.cashierA.memberId, isActive: false });
    expect(await code(as(F.cashierA).query(api.products.posCatalog, {}))).toBe("ACCOUNT_LOCKED");
  });
});

describe("9. sales", () => {
  const stock = async () => (await t.run((ctx) => ctx.db.get(F.dataA.productId)))!.stock;
  const nSales = () => t.run(async (ctx) => (await ctx.db.query("sales").collect()).filter((s) => s.businessId === F.A.businessId).length);

  it("is idempotent on clientSaleId", async () => {
    const C = as(F.cashierA);
    const args = saleArgs(F.dataA.productId, { clientSaleId: "dup-1" }, 2);
    const first = await C.mutation(api.sales.create, args);
    const second = await C.mutation(api.sales.create, args);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.saleId).toEqual(first.saleId);
    expect(await stock()).toBe(8);
    expect(await nSales()).toBe(2); // seeded one + this one
  });
  it("clientSaleId is scoped per business", async () => {
    // B uses the same id as A: must NOT be treated as a duplicate of A's sale or vice versa
    const a = await as(F.cashierA).mutation(api.sales.create, saleArgs(F.dataA.productId, { clientSaleId: "same" }));
    const b = await as(F.ownerB).mutation(api.sales.create, saleArgs(F.dataB.productId, { clientSaleId: "same" }));
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(false);
    expect(a.saleId).not.toEqual(b.saleId);
  });
  it("credit sale updates balance and ledger; refund reverses", async () => {
    const C = as(F.cashierA);
    const r = await C.mutation(api.sales.create, saleArgs(F.dataA.productId, {
      clientSaleId: "cr-1", customerId: F.dataA.customerId, payments: [{ method: "CREDIT", amountCents: 500 }],
    }));
    const cu = await t.run((ctx) => ctx.db.get(F.dataA.customerId));
    expect(cu!.balanceCents).toBe(900); // 400 + 500
    const led = await t.run((ctx) => ctx.db.query("ledger").withIndex("by_customer", (q) => q.eq("customerId", F.dataA.customerId)).collect());
    expect(led.filter((l) => l.type === "DEBT" && l.saleId === r.saleId)).toHaveLength(1);
    const rf = { saleId: r.saleId, items: [{ productId: F.dataA.productId, qty: 1, restock: true }], method: "CREDIT" as const, reason: "returned" };
    await as(F.managerA).mutation(api.sales.refund, rf);
    expect((await t.run((ctx) => ctx.db.get(F.dataA.customerId)))!.balanceCents).toBe(400);
    expect(await stock()).toBe(10);
    expect(await code(as(F.managerA).mutation(api.sales.refund, rf))).toBe("ALREADY_REFUNDED");
    expect(await stock()).toBe(10);
  });
  it("credit sale needs a customer and respects the limit", async () => {
    const C = as(F.cashierA);
    const credit = (clientSaleId: string, qty: number, over = {}) =>
      saleArgs(F.dataA.productId, { clientSaleId, payments: [{ method: "CREDIT", amountCents: 500 * qty }], ...over }, qty);
    expect(await code(C.mutation(api.sales.create, credit("c0", 1)))).toBe("CUSTOMER_REQUIRED");
    // limit 1000, balance 400 -> 2 items = 1000 total => 1400 > 1000
    expect(await code(C.mutation(api.sales.create, credit("c1", 2, { customerId: F.dataA.customerId })))).toBe("CREDIT_LIMIT_EXCEEDED");
    expect(await stock()).toBe(10); // rolled back
    expect((await t.run((ctx) => ctx.db.get(F.dataA.customerId)))!.balanceCents).toBe(400);
  });
  it("rejects expired and archived products", async () => {
    const exp = await t.run(async (ctx) => {
      const id = await ctx.db.insert("products", {
        businessId: F.A.businessId, type: "STOCKABLE", sku: "", barcode: "", extraBarcodes: [], name: "milk", brand: "", unit: "pcs",
        allowDecimal: false, costCents: 1, priceCents: 500, stock: 5, reorderLevel: 0, trackExpiry: true, hasVariants: false,
        isArchived: false, updatedAt: 0,
      });
      await ctx.db.insert("batches", { businessId: F.A.businessId, productId: id, batchNo: "old", qty: 5, costCents: 1, expiryDate: Date.now() - DAY, receivedAt: 0 });
      return id;
    });
    const C = as(F.cashierA);
    expect(await code(C.mutation(api.sales.create, saleArgs(exp, { clientSaleId: "e1" })))).toBe("PRODUCT_EXPIRED");
    await as(F.ownerA).mutation(api.products.archive, { productId: F.dataA.productId, archived: true });
    expect(await code(C.mutation(api.sales.create, saleArgs(F.dataA.productId, { clientSaleId: "e2" })))).toBe("INVALID_INPUT");
  });
  it("blocks overselling when allowNegativeStock is false", async () => {
    expect(await code(as(F.cashierA).mutation(api.sales.create, saleArgs(F.dataA.productId, {
      clientSaleId: "o1", items: [{ productId: F.dataA.productId, qty: 6, discountCents: 0 }, { productId: F.dataA.productId, qty: 6, discountCents: 0 }],
    }, 1, 6000)))).toBe("INSUFFICIENT_STOCK"); // repeated lines are merged before the check
    expect(await stock()).toBe(10);
  });
  it("rejects bad numbers", async () => {
    const C = as(F.cashierA);
    const it1 = (qty: number) => [{ productId: F.dataA.productId, qty, discountCents: 0 }];
    let i = 0;
    const s = (over: object) => code(C.mutation(api.sales.create, saleArgs(F.dataA.productId, { clientSaleId: `bad-${i++}`, ...over })));
    for (const qty of [0, -1, 1.5, NaN, Infinity, 1e12]) expect(await s({ items: it1(qty) }), `qty ${qty}`).toBe("INVALID_INPUT");
    for (const d of [-1, 0.5, NaN, Infinity, 501]) expect(await s({ orderDiscountCents: d }), `discount ${d}`).toBe("INVALID_INPUT");
    for (const d of [-1, 0.5, NaN, 501]) expect(await s({ items: [{ productId: F.dataA.productId, qty: 1, discountCents: d }] }), `line discount ${d}`).toBe("INVALID_INPUT");
    expect(await s({ items: [] })).toBe("INVALID_INPUT");
    expect(await s({ clientSaleId: "" })).toBe("INVALID_INPUT");
    expect(await s({ createdAt: -5 })).toBe("INVALID_INPUT");
    expect(await stock()).toBe(10);
  });
  it("rejects absurd totals (precision overflow)", async () => {
    const big = await as(F.ownerA).mutation(api.products.create, { ...productFields, name: "gold", barcode: "g", priceCents: 1e12, openingStock: 1e6 });
    expect(await code(as(F.cashierA).mutation(api.sales.create, saleArgs(big, { clientSaleId: "huge" }, 1e6, 1e9)))).toBe("INVALID_INPUT");
  });
  it("future createdAt is clamped to now", async () => {
    const r = await as(F.cashierA).mutation(api.sales.create, saleArgs(F.dataA.productId, { clientSaleId: "fut", createdAt: Date.now() + 100 * DAY }));
    const s = await t.run((ctx) => ctx.db.get(r.saleId));
    expect(s!.createdAt).toBeLessThanOrEqual(Date.now());
  });
  it("customer payments: no overpay, no negative/float", async () => {
    const C = as(F.cashierA);
    const pay = (amountCents: number) => code(C.mutation(api.customers.recordPayment, { customerId: F.dataA.customerId, amountCents, method: "CASH" }));
    expect(await pay(401)).toBe("PAYMENT_EXCEEDS_BALANCE");
    for (const n of [0, -5, 1.5, NaN, Infinity]) expect(await pay(n), `pay ${n}`).toBe("INVALID_INPUT");
    expect(await pay(400)).toBe("OK");
    expect(await pay(1)).toBe("PAYMENT_EXCEEDS_BALANCE");
    expect((await t.run((ctx) => ctx.db.get(F.dataA.customerId)))!.balanceCents).toBe(0);
  });
  it("money fields reject negatives/NaN/floats", async () => {
    const O = as(F.ownerA);
    for (const n of [-1, 1.5, NaN, Infinity, 1e13]) {
      expect(await code(O.mutation(api.products.create, { ...productFields, barcode: "z", priceCents: n })), `price ${n}`).toBe("INVALID_INPUT");
      expect(await code(O.mutation(api.expenses.create, { category: "Rent", amountCents: n, paidVia: "CASH", payee: "", note: "", spentAt: Date.now() })), `expense ${n}`).toBe("INVALID_INPUT");
      expect(await code(O.mutation(api.customers.create, { ...custFields, fullName: "x", phone: "1", creditLimitCents: n, openingBalanceCents: 0 })), `limit ${n}`).toBe("INVALID_INPUT");
    }
    expect(await code(O.mutation(api.products.create, { ...productFields, barcode: "z", openingStock: NaN }))).toBe("INVALID_INPUT");
    expect(await code(O.mutation(api.inventory.adjust, { productId: F.dataA.productId, delta: 0.5, reason: "OTHER" }))).toBe("INVALID_INPUT");
    expect(await code(O.mutation(api.settings.updateSettings, { taxRatePercent: NaN, lowStockThreshold: 1, allowNegativeStock: true }))).toBe("INVALID_INPUT");
    expect(await code(O.mutation(api.settings.updateSettings, { taxRatePercent: 101, lowStockThreshold: 1, allowNegativeStock: true }))).toBe("INVALID_INPUT");
  });
  it("barcode is unique per business, but two businesses can share one", async () => {
    const O = as(F.ownerA);
    expect(await code(O.mutation(api.products.create, { ...productFields, barcode: "A-code" }))).toBe("BARCODE_EXISTS");
    expect(await code(O.mutation(api.products.create, { ...productFields, barcode: "B-code" }))).toBe("OK"); // B's code is not a conflict
  });
});

describe("10. unauthenticated", () => {
  it("everything is UNAUTHENTICATED", async () => {
    const now = Date.now();
    const calls: Record<string, () => Promise<unknown>> = {
      "products.list": () => t.query(api.products.list, {}),
      "products.posCatalog": () => t.query(api.products.posCatalog, {}),
      "sales.create": () => t.mutation(api.sales.create, saleArgs(F.dataA.productId, { clientSaleId: "x", createdAt: now })),
      "shifts.open": () => t.mutation(api.shifts.open, { openingFloatCents: 0 }),
      "shifts.current": () => t.query(api.shifts.current, {}),
      "customers.statement": () => t.query(api.customers.statement, { customerId: F.dataA.customerId, from: 0, to: now }),
      "reports.profitAndLoss": () => t.query(api.reports.profitAndLoss, { from: 0, to: now }),
      "customers.list": () => t.query(api.customers.list, {}),
      "staff.list": () => t.query(api.staff.list, {}),
      "staff.create": () => t.action(api.staff.create, { fullName: "x", username: "newguy", password: "longenough1", role: "CASHIER" }),
      "staff.resetPassword": () => t.action(api.staff.resetPassword, { memberId: F.ownerA.memberId, newPassword: "longenough1" }),
      "settings.get": () => t.query(api.settings.get, {}),
      "billing.current": () => t.query(api.billing.current, {}),
      "support.list": () => t.query(api.support.list, {}),
      "reports.summary": () => t.query(api.reports.summary, { from: 0, to: now }),
      "expenses.list": () => t.query(api.expenses.list, { from: 0, to: now }),
      "platformTenants.list": () => t.query(api.platformTenants.list, { now: Date.now() }),
      "platformPlans.create": () => t.mutation(api.platformPlans.create, { name: "p", description: "d", priceCents: 1, trialDays: 0, maxUsers: 0, maxProducts: 0, modules: [], features: [], isDefaultTrial: false, isActive: true, sortOrder: 1 }),
      "platformStaff.list": () => t.query(api.platformStaff.list, {}),
      "platformStaff.create": () => t.action(api.platformStaff.create, { fullName: "x", username: "newadm", password: "longenough1" }),
      "platformStats.overview": () => t.query(api.platformStats.overview, { now: Date.now() }),
      "platformAudit.list": () => t.query(api.platformActivity.list, { paginationOpts: { numItems: 5, cursor: null } }),
      "onboarding.generateUploadUrl": () => t.mutation(api.onboarding.generateUploadUrl, {}),
      "onboarding.createBusiness": () => t.mutation(api.onboarding.createBusiness, { fullName: "x", name: "x", businessType: "x", phone: "1", address: "a", city: "c", country: "SO", currency: "USD" }),
    };
    for (const [name, p] of Object.entries(calls)) expect(await code(p()), name).toBe("UNAUTHENTICATED");
    expect(await t.query(api.members.me, {})).toBeNull();
    expect(await t.query(api.dashboard.home, {})).toBeNull();
    expect(await t.query(api.plans.publicList, {})).toHaveLength(1); // intentionally public
  });
  it("a user whose member row is missing gets UNAUTHENTICATED/needs_onboarding, not data", async () => {
    const L = asUser(F.loneUser);
    expect(await code(L.query(api.products.list, {}))).toBe("UNAUTHENTICATED");
    expect(await L.query(api.members.me, {})).toEqual({ kind: "needs_onboarding" });
  });
});

describe("11. onboarding", () => {
  const biz = { fullName: "New Owner", name: "Shop", businessType: "Grocery", phone: "1", address: "a", city: "c", country: "SO", currency: "usd" };
  it("a user that already has a member cannot create another business", async () => {
    for (const u of [F.ownerA, F.managerA, F.cashierA, F.ownerB, F.superAdmin, F.padmin]) {
      expect(await code(as(u).mutation(api.onboarding.createBusiness, biz))).toBe("ALREADY_ONBOARDED");
    }
    const n = await t.run(async (ctx) => (await ctx.db.query("businesses").collect()).length);
    expect(n).toBe(4);
  });
  it("a fresh user can onboard exactly once, as OWNER of a new tenant on the trial plan", async () => {
    const L = asUser(F.loneUser);
    const id = await L.mutation(api.onboarding.createBusiness, biz);
    const m = await t.run((ctx) => ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", F.loneUser)).unique());
    expect(m!.role).toBe("OWNER");
    expect(m!.businessId).toBe(id);
    expect(await code(L.mutation(api.onboarding.createBusiness, biz))).toBe("ALREADY_ONBOARDED");
    expect(await code(L.query(api.products.list, {}))).toBe("OK");
    expect(await L.query(api.products.list, {})).toEqual([]); // sees nothing of A or B
  });
  it("cannot attach a logo that another business already uses (MIME check not testable: convex-test stores no contentType)", async () => {
    const png = await t.run((ctx) => ctx.storage.store(new Blob(["x"], { type: "image/png" })));
    await t.run((ctx) => ctx.db.patch(F.B.businessId, { logoId: png }));
    const L = asUser(F.loneUser);
    expect(await code(L.mutation(api.onboarding.createBusiness, { ...biz, logoId: png }))).toBe("INVALID_INPUT"); // B's logo
    // settings.updateProfile has the same rules
    const p = { name: "x", businessType: "x", phone: "1", address: "a", city: "c", country: "SO", currency: "USD" };
    expect(await code(as(F.ownerA).mutation(api.settings.updateProfile, { ...p, logoId: png }))).toBe("INVALID_INPUT");
    // B's logo file survives all of that
    expect(await t.run((ctx) => ctx.storage.getUrl(png))).not.toBeNull();
  });
  it("owner can set a valid logo; replacing deletes only their own old file", async () => {
    const [l1, l2] = await t.run(async (ctx) => [
      await ctx.storage.store(new Blob(["1"], { type: "image/png" })),
      await ctx.storage.store(new Blob(["2"], { type: "image/png" })),
    ]);
    const p = { name: "x", businessType: "x", phone: "1", address: "a", city: "c", country: "SO", currency: "USD" };
    const O = as(F.ownerA);
    expect(await code(O.mutation(api.settings.updateProfile, { ...p, logoId: l1 }))).toBe("OK");
    expect(await code(O.mutation(api.settings.updateProfile, { ...p, logoId: l1 }))).toBe("OK"); // same logo again
    expect(await t.run((ctx) => ctx.storage.getUrl(l1))).not.toBeNull();
    expect(await code(O.mutation(api.settings.updateProfile, { ...p, logoId: l2 }))).toBe("OK");
    expect(await t.run((ctx) => ctx.storage.getUrl(l1))).toBeNull();
  });
  it("upload urls are only for users who still need onboarding (or owners via settings)", async () => {
    expect(await code(asUser(F.loneUser).mutation(api.onboarding.generateUploadUrl, {}))).toBe("OK");
    expect(await code(as(F.cashierA).mutation(api.onboarding.generateUploadUrl, {}))).toBe("ALREADY_ONBOARDED");
    expect(await code(as(F.ownerA).mutation(api.settings.generateUploadUrl, {}))).toBe("OK");
  });
});

describe("internal functions are not public", () => {
  it("internal-only functions are absent from the generated public api", async () => {
    // generated api.d.ts only lists public functions; check the source of truth: registered visibility
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./_generated/api.d.ts", import.meta.url), "utf8");
    const publicBlock = src.slice(src.indexOf("export declare const api"), src.indexOf("export declare const internal"));
    for (const n of ["checkCreate", "insertMember", "checkReset", "logReset", "createSuperAdmin", "insertPlatformMember"]) {
      expect(publicBlock.includes(`${n}`), n).toBe(false);
    }
  });
});

describe("organizer decisions", () => {
  const sale = (over: Record<string, unknown> & { clientSaleId: string }) => saleArgs(F.dataA.productId, over);

  it("cashier-created customers get no credit; limit 0 means no credit", async () => {
    const C = as(F.cashierA);
    const customerId = await C.mutation(api.customers.create, { ...custFields, fullName: "New", phone: "1", creditLimitCents: 999999, openingBalanceCents: 0 });
    expect((await t.run((ctx) => ctx.db.get(customerId)))!.creditLimitCents).toBe(0);
    expect(await code(C.mutation(api.sales.create, sale({ clientSaleId: "nc", payments: [{ method: "CREDIT", amountCents: 500 }], customerId })))).toBe("CREDIT_LIMIT_EXCEEDED");
  });

  it("backdated createdAt is clamped to 30 days ago", async () => {
    const r = await as(F.cashierA).mutation(api.sales.create, sale({ clientSaleId: "old", createdAt: 0 }));
    const s = await t.run((ctx) => ctx.db.get(r.saleId));
    expect(s!.createdAt).toBeGreaterThanOrEqual(Date.now() - 30 * DAY - 1000);
  });

  it("the default trial plan cannot be unset or deactivated", async () => {
    const S = as(F.superAdmin);
    const p = await t.run(async (ctx) => (await ctx.db.query("plans").collect()).find((x) => x.isDefaultTrial)!);
    expect(await code(S.mutation(api.platformPlans.setActive, { planId: p._id, isActive: false }))).toBe("INVALID_INPUT");
    const { _id, _creationTime, ...fields } = p;
    expect(await code(S.mutation(api.platformPlans.update, { planId: _id, ...fields, isDefaultTrial: false }))).toBe("INVALID_INPUT");
  });

  it("a locked member sees ACCOUNT_LOCKED in members.me", async () => {
    await t.run((ctx) => ctx.db.patch(F.cashierA.memberId, { isActive: false }));
    const me = await as(F.cashierA).query(api.members.me, {});
    expect(me && "lockReason" in me ? me.lockReason : null).toBe("ACCOUNT_LOCKED");
  });
});

it("refunding a partly-repaid credit sale leaves store credit, not a lost payment", async () => {
  const C = as(F.cashierA);
  const cid = F.dataA.customerId;
  const before = (await t.run((ctx) => ctx.db.get(cid)))!.balanceCents;
  const r = await C.mutation(api.sales.create, saleArgs(F.dataA.productId, { customerId: cid, clientSaleId: "rf", payments: [{ method: "CREDIT", amountCents: 500 }] }));
  const total = (await t.run((ctx) => ctx.db.get(r.saleId)))!.totalCents;
  await C.mutation(api.customers.recordPayment, { customerId: cid, amountCents: before + total, method: "CASH" });
  await as(F.ownerA).mutation(api.sales.refund, { saleId: r.saleId, items: [{ productId: F.dataA.productId, qty: 1, restock: true }], method: "CREDIT", reason: "returned" });
  expect((await t.run((ctx) => ctx.db.get(cid)))!.balanceCents).toBe(-total);
});
