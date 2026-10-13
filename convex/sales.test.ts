/// <reference types="vite/client" />
// POS / shifts / sales / refunds / customer credit tests. Run: npx vitest run convex/sales.test.ts
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { MODULE_KEYS } from "./shared/modules";

const modules = import.meta.glob("./**/*.*s");
const DAY = 86_400_000;

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
let t: ReturnType<typeof makeT>;
let F: Awaited<ReturnType<typeof build>>;

type Perms = NonNullable<Doc<"members">["permissions"]>;

async function build(t: ReturnType<typeof makeT>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const planId = await ctx.db.insert("plans", {
      name: "Pro", description: "all", priceCents: 0, trialDays: 14, maxUsers: 0, maxProducts: 0,
      modules: MODULE_KEYS, features: [], isDefaultTrial: true, isActive: true, sortOrder: 0,
    });
    const mkBiz = async (name: string) => {
      const ownerUserId = await ctx.db.insert("users", { email: `${name}-owner`, name });
      const businessId = await ctx.db.insert("businesses", {
        name, businessType: "Grocery", phone: "1", address: "a", city: "c", country: "SO", currency: "USD",
        ownerUserId, status: "ACTIVE", planId, subscriptionStatus: "ACTIVE", subscriptionEndsAt: now + 365 * DAY,
        settings: {
          taxRatePercent: 0, lowStockThreshold: 5, allowNegativeStock: false,
          paymentMethods: ["CASH", "EVC", "ZAAD", "EDAHAB", "CREDIT"], maxCashierDiscountPercent: 10,
          defaultCreditLimitCents: 0, expenseCategories: ["Rent", "Other"], discountPresets: [5, 10],
        },
        createdAt: now,
      });
      return { businessId, ownerUserId };
    };
    const mkMember = async (role: "OWNER" | "MANAGER" | "CASHIER", username: string, businessId: Id<"businesses">, o: { userId?: Id<"users">; permissions?: Perms } = {}) => {
      const userId = o.userId ?? (await ctx.db.insert("users", { email: username, name: username }));
      const memberId = await ctx.db.insert("members", { userId, businessId, role, username, fullName: username, permissions: o.permissions, isActive: true, createdAt: now });
      return { userId, memberId };
    };
    const A = await mkBiz("A");
    const B = await mkBiz("B");
    const ownerA = await mkMember("OWNER", "owner-a", A.businessId, { userId: A.ownerUserId });
    const managerA = await mkMember("MANAGER", "manager-a", A.businessId);
    const cashierA = await mkMember("CASHIER", "cashier-a", A.businessId);
    const cashier2 = await mkMember("CASHIER", "cashier-2", A.businessId);
    const noDisc = await mkMember("CASHIER", "no-disc", A.businessId, { permissions: { seeCost: false, giveDiscount: false, refund: false, adjustStock: false, editPrice: false } });
    const refunder = await mkMember("CASHIER", "refunder", A.businessId, { permissions: { seeCost: false, giveDiscount: true, refund: true, adjustStock: false, editPrice: false } });
    const blindMgr = await mkMember("MANAGER", "blind-mgr", A.businessId, { permissions: { seeCost: false, giveDiscount: true, refund: true, adjustStock: true, editPrice: true } });
    const ownerB = await mkMember("OWNER", "owner-b", B.businessId, { userId: B.ownerUserId });

    const mkProduct = async (businessId: Id<"businesses">, name: string, o: Partial<Doc<"products">> = {}) =>
      ctx.db.insert("products", {
        businessId, type: "STOCKABLE", name, sku: "", barcode: name, extraBarcodes: [], brand: "", unit: "pcs", allowDecimal: false,
        costCents: 300, priceCents: 500, stock: 20, reorderLevel: 5, trackExpiry: false, hasVariants: false, isArchived: false,
        updatedAt: now, ...o,
      });
    const mkCustomer = (businessId: Id<"businesses">, name: string, o: Partial<Doc<"customers">> = {}) =>
      ctx.db.insert("customers", {
        businessId, fullName: name, phone: name, whatsapp: "", type: "INDIVIDUAL", companyName: "", group: "RETAIL", address: "",
        district: "", notes: "", creditLimitCents: 5000, creditBlocked: false, balanceCents: 0, createdAt: now, ...o,
      });
    const p1 = await mkProduct(A.businessId, "p1", { wholesalePriceCents: 400 });
    const odd = await mkProduct(A.businessId, "odd", { priceCents: 333, costCents: 100 });
    const milk = await mkProduct(A.businessId, "milk", { trackExpiry: true, stock: 12 });
    const b1 = await ctx.db.insert("batches", { businessId: A.businessId, productId: milk, batchNo: "b1", qty: 2, costCents: 300, expiryDate: now + 10 * DAY, receivedAt: now });
    const b2 = await ctx.db.insert("batches", { businessId: A.businessId, productId: milk, batchNo: "b2", qty: 10, costCents: 300, expiryDate: now + 40 * DAY, receivedAt: now });
    const retail = await mkCustomer(A.businessId, "retail");
    const wholesale2 = await mkCustomer(A.businessId, "debtor2", { balanceCents: 1000 });
    const wholesale = await mkCustomer(A.businessId, "wholesale", { group: "WHOLESALE" });
    const blocked = await mkCustomer(A.businessId, "blocked", { creditBlocked: true });
    const bProduct = await mkProduct(B.businessId, "bp");
    const bCustomer = await mkCustomer(B.businessId, "bc", { balanceCents: 100 });
    const bShift = await ctx.db.insert("shifts", { businessId: B.businessId, memberId: ownerB.memberId, memberName: "owner-b", status: "OPEN", openingFloatCents: 0, openedAt: now });
    const bSale = await ctx.db.insert("sales", {
      businessId: B.businessId, clientSaleId: "b1", receiptNo: 1, cashierId: ownerB.memberId, cashierName: "owner-b", shiftId: bShift,
      items: [{ productId: bProduct, name: "bp", qty: 1, priceCents: 500, discountCents: 0, costCents: 300, refundedQty: 0 }],
      subtotalCents: 500, discountCents: 0, taxCents: 0, totalCents: 500, payments: [{ method: "CASH", amountCents: 500 }],
      changeCents: 0, refundedCents: 0, status: "COMPLETED", createdAt: now, syncedAt: now,
    });
    return { A, B, ownerA, managerA, cashierA, cashier2, noDisc, refunder, blindMgr, ownerB, p1, odd, milk, b1, b2, retail, wholesale2, wholesale, blocked, bProduct, bCustomer, bShift, bSale };
  });
}

const as = (u: { userId: Id<"users"> }) => t.withIdentity({ subject: `${u.userId}|fakesession` });
beforeEach(async () => {
  t = makeT();
  F = await build(t);
});

let n = 0;
const line = (productId: Id<"products">, qty = 1, discountCents = 0) => ({ productId, qty, discountCents });
const cash = (amountCents: number) => ({ method: "CASH" as const, amountCents });
const sale = (items: ReturnType<typeof line>[], payments: { method: "CASH" | "EVC" | "ZAAD" | "EDAHAB" | "BANK" | "CREDIT"; amountCents: number; reference?: string }[], over: Record<string, unknown> = {}) => ({
  clientSaleId: `s${n++}`, items, orderDiscountCents: 0, payments, createdAt: Date.now(), ...over,
});
const get = <T extends "sales" | "customers" | "products" | "batches" | "shifts">(id: Id<T>) => t.run((ctx) => ctx.db.get(id) as Promise<Doc<T>>);
const ledgerOf = (customerId: Id<"customers">) =>
  t.run((ctx) => ctx.db.query("ledger").withIndex("by_customer", (q) => q.eq("customerId", customerId)).collect());

describe("create", () => {
  it("split payment CASH+EVC+CREDIT with change", async () => {
    const r = await as(F.cashierA).mutation(api.sales.create, sale([line(F.p1, 2)], [
      { method: "EVC", amountCents: 300, reference: "EVC-1" }, { method: "CREDIT", amountCents: 200 }, cash(600),
    ], { customerId: F.retail }));
    const s = await get(r.saleId);
    expect(s.totalCents).toBe(1000);
    expect(s.changeCents).toBe(100);
    expect(s.payments).toHaveLength(3);
    expect(s.customerName).toBe("retail");
    expect((await get(F.p1)).stock).toBe(18);
    expect((await get(F.retail)).balanceCents).toBe(200);
    expect((await ledgerOf(F.retail)).filter((l) => l.type === "DEBT" && l.amountCents === 200)).toHaveLength(1);
  });

  it("PAYMENT_MISMATCH when short, or when non-cash exceeds the total", async () => {
    const C = as(F.cashierA);
    expect(await code(C.mutation(api.sales.create, sale([line(F.p1)], [cash(499)])))).toBe("PAYMENT_MISMATCH");
    expect(await code(C.mutation(api.sales.create, sale([line(F.p1)], [{ method: "EVC", amountCents: 600 }])))).toBe("PAYMENT_MISMATCH");
    expect(await code(C.mutation(api.sales.create, sale([line(F.p1)], [{ method: "EVC", amountCents: 300 }, cash(100)])))).toBe("PAYMENT_MISMATCH");
    expect((await get(F.p1)).stock).toBe(20);
  });

  it("disabled payment methods are rejected", async () => {
    expect(await code(as(F.cashierA).mutation(api.sales.create, sale([line(F.p1)], [{ method: "BANK", amountCents: 500 }])))).toBe("INVALID_INPUT");
  });

  it("discounts: cashier limit, permission, owner unlimited", async () => {
    const C = as(F.cashierA);
    // 10% of 500 = 50 is allowed, 100 (20%) is not; line and order discounts count together
    expect(await code(C.mutation(api.sales.create, sale([line(F.p1)], [cash(450)], { orderDiscountCents: 50 })))).toBe("OK");
    expect(await code(C.mutation(api.sales.create, sale([line(F.p1)], [cash(400)], { orderDiscountCents: 100 })))).toBe("DISCOUNT_TOO_HIGH");
    expect(await code(C.mutation(api.sales.create, sale([line(F.p1, 1, 100)], [cash(400)])))).toBe("DISCOUNT_TOO_HIGH");
    expect(await code(C.mutation(api.sales.create, sale([line(F.p1, 1, 30)], [cash(460)], { orderDiscountCents: 30 })))).toBe("DISCOUNT_TOO_HIGH");
    expect(await code(as(F.noDisc).mutation(api.sales.create, sale([line(F.p1)], [cash(490)], { orderDiscountCents: 10 })))).toBe("NO_PERMISSION");
    expect(await code(as(F.noDisc).mutation(api.sales.create, sale([line(F.p1)], [cash(500)])))).toBe("OK");
    expect(await code(as(F.ownerA).mutation(api.sales.create, sale([line(F.p1)], [cash(250)], { orderDiscountCents: 250 })))).toBe("OK");
  });

  it("wholesale price applies for WHOLESALE customers only", async () => {
    const C = as(F.cashierA);
    const w = await C.mutation(api.sales.create, sale([line(F.p1, 2)], [cash(800)], { customerId: F.wholesale }));
    const r = await C.mutation(api.sales.create, sale([line(F.p1, 2)], [cash(1000)], { customerId: F.retail }));
    expect((await get(w.saleId)).items[0].priceCents).toBe(400);
    expect((await get(w.saleId)).totalCents).toBe(800);
    expect((await get(r.saleId)).items[0].priceCents).toBe(500);
  });

  it("CREDIT_BLOCKED, limit, customer required", async () => {
    const C = as(F.cashierA);
    const credit = (c?: Id<"customers">) => sale([line(F.p1)], [{ method: "CREDIT", amountCents: 500 }], c ? { customerId: c } : {});
    expect(await code(C.mutation(api.sales.create, credit(F.blocked)))).toBe("CREDIT_BLOCKED");
    expect(await code(C.mutation(api.sales.create, credit()))).toBe("CUSTOMER_REQUIRED");
    expect(await code(C.mutation(api.sales.create, credit(F.retail)))).toBe("OK");
    expect((await get(F.p1)).stock).toBe(19);
  });

  it("works offline-style: no shift needed, idempotent, backdated sale", async () => {
    const C = as(F.cashierA);
    const args = sale([line(F.p1)], [cash(500)], { createdAt: Date.now() - 2 * DAY });
    const a = await C.mutation(api.sales.create, args);
    const b = await C.mutation(api.sales.create, args);
    expect(b.duplicate).toBe(true);
    expect((await get(a.saleId)).shiftId).toBeUndefined();
    expect((await get(F.p1)).stock).toBe(19);
  });

  it("templates and zero-line decimals are rejected; decimals only when allowed", async () => {
    const C = as(F.cashierA);
    expect(await code(C.mutation(api.sales.create, sale([line(F.p1, 1.5)], [cash(750)])))).toBe("INVALID_INPUT");
    const kg = await t.run((ctx) => ctx.db.insert("products", {
      businessId: F.A.businessId, type: "STOCKABLE", name: "rice", sku: "", barcode: "rice", extraBarcodes: [], brand: "", unit: "kg",
      allowDecimal: true, costCents: 100, priceCents: 400, stock: 10, reorderLevel: 0, trackExpiry: false, hasVariants: false, isArchived: false, updatedAt: 0,
    }));
    const r = await C.mutation(api.sales.create, sale([line(kg, 1.25)], [cash(500)]));
    expect((await get(r.saleId)).totalCents).toBe(500);
    expect((await get(kg)).stock).toBe(8.75);
  });
});

describe("refunds", () => {
  const rf = (saleId: Id<"sales">, productId: Id<"products">, qty: number, over: Record<string, unknown> = {}) => ({
    saleId, items: [{ productId, qty, restock: true }], method: "CASH" as const, reason: "customer returned", ...over,
  });

  it("partial refund twice, then REFUND_TOO_MUCH; status moves along", async () => {
    const M = as(F.managerA);
    const s = await as(F.cashierA).mutation(api.sales.create, sale([line(F.p1, 3)], [cash(1500)]));
    await M.mutation(api.sales.refund, rf(s.saleId, F.p1, 1));
    expect((await get(s.saleId)).status).toBe("PARTIALLY_REFUNDED");
    await M.mutation(api.sales.refund, rf(s.saleId, F.p1, 1));
    expect(await code(M.mutation(api.sales.refund, rf(s.saleId, F.p1, 2)))).toBe("REFUND_TOO_MUCH");
    expect((await get(F.p1)).stock).toBe(19); // 20 - 3 + 2
    const last = await M.mutation(api.sales.refund, rf(s.saleId, F.p1, 1));
    expect(last.status).toBe("REFUNDED");
    const done = await get(s.saleId);
    expect(done.refundedCents).toBe(1500);
    expect(done.items[0].refundedQty).toBe(3);
    expect(await code(M.mutation(api.sales.refund, rf(s.saleId, F.p1, 1)))).toBe("ALREADY_REFUNDED");
    expect((await get(F.p1)).stock).toBe(20);
  });

  it("refunds of a discounted sale add up to exactly the total (cumulative rounding)", async () => {
    // 3 x 333 = 999, order discount 100 (owner) => total 899; 899/3 does not divide
    const s = await as(F.ownerA).mutation(api.sales.create, sale([line(F.odd, 3)], [cash(899)], { orderDiscountCents: 100 }));
    const M = as(F.managerA);
    const amounts: number[] = [];
    for (let i = 0; i < 3; i++) amounts.push((await M.mutation(api.sales.refund, rf(s.saleId, F.odd, 1))).amountCents);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(899);
    expect(amounts).toEqual([299, 300, 300]);
    expect((await get(s.saleId)).refundedCents).toBe(899);
  });

  it("restock puts stock back into the same batches, pro-rata; restock=false does not", async () => {
    const C = as(F.cashierA);
    const s = await C.mutation(api.sales.create, sale([line(F.milk, 5)], [cash(2500)]));
    // FEFO: 2 from b1 (earlier expiry), 3 from b2
    expect(await get(F.b1)).toMatchObject({ qty: 0 });
    expect(await get(F.b2)).toMatchObject({ qty: 7 });
    expect((await get(s.saleId)).items[0].batches).toHaveLength(2);
    const M = as(F.managerA);
    await M.mutation(api.sales.refund, rf(s.saleId, F.milk, 1, { items: [{ productId: F.milk, qty: 1, restock: false }] }));
    expect((await get(F.milk)).stock).toBe(7);
    await M.mutation(api.sales.refund, rf(s.saleId, F.milk, 2));
    expect(await get(F.b1)).toMatchObject({ qty: 0.8 });
    expect(await get(F.b2)).toMatchObject({ qty: 8.2 });
    expect((await get(F.milk)).stock).toBe(9);
    await M.mutation(api.sales.refund, rf(s.saleId, F.milk, 2));
    expect((await get(F.b1)).qty + (await get(F.b2)).qty).toBeCloseTo(11, 6); // 12 minus the 1 unit not restocked
    expect((await get(F.milk)).stock).toBe(11);
    const moves = await t.run((ctx) => ctx.db.query("stockMovements").collect());
    expect(moves.filter((m) => m.type === "REFUND").every((m) => m.qty > 0)).toBe(true);
  });

  it("credit refund reduces debt and may leave store credit; needs the sale's customer", async () => {
    const C = as(F.cashierA);
    const s = await C.mutation(api.sales.create, sale([line(F.p1)], [{ method: "CREDIT", amountCents: 500 }], { customerId: F.retail }));
    await C.mutation(api.customers.recordPayment, { customerId: F.retail, amountCents: 500, method: "CASH" });
    await as(F.ownerA).mutation(api.sales.refund, rf(s.saleId, F.p1, 1, { method: "CREDIT" }));
    expect((await get(F.retail)).balanceCents).toBe(-500);
    expect((await ledgerOf(F.retail)).some((l) => l.type === "REVERSAL" && l.amountCents === 500)).toBe(true);
    const walkIn = await C.mutation(api.sales.create, sale([line(F.p1)], [cash(500)]));
    expect(await code(as(F.ownerA).mutation(api.sales.refund, rf(walkIn.saleId, F.p1, 1, { method: "CREDIT" })))).toBe("CUSTOMER_REQUIRED");
  });

  it("permissions and validation", async () => {
    const s = await as(F.cashierA).mutation(api.sales.create, sale([line(F.p1, 2)], [cash(1000)]));
    expect(await code(as(F.cashierA).mutation(api.sales.refund, rf(s.saleId, F.p1, 1)))).toBe("NO_PERMISSION");
    expect(await code(as(F.managerA).mutation(api.sales.refund, rf(s.saleId, F.p1, 1, { reason: "  " })))).toBe("REASON_REQUIRED");
    expect(await code(as(F.managerA).mutation(api.sales.refund, rf(s.saleId, F.p1, 0)))).toBe("INVALID_INPUT");
    expect(await code(as(F.managerA).mutation(api.sales.refund, rf(s.saleId, F.p1, 1.5)))).toBe("INVALID_INPUT");
    expect(await code(as(F.managerA).mutation(api.sales.refund, rf(s.saleId, F.odd, 1)))).toBe("INVALID_INPUT");
    expect(await code(as(F.refunder).mutation(api.sales.refund, rf(s.saleId, F.p1, 1)))).toBe("OK"); // cashier granted refund
    expect((await get(s.saleId)).refundedCents).toBe(500);
  });
});

describe("shifts", () => {
  it("expected cash = float + cash sales - change + cash repayments + in - out - cash refunds - cash expenses", async () => {
    const M = as(F.managerA);
    await M.mutation(api.shifts.open, { openingFloatCents: 1000 });
    expect(await code(M.mutation(api.shifts.open, { openingFloatCents: 1 }))).toBe("SHIFT_ALREADY_OPEN");
    const s1 = await M.mutation(api.sales.create, sale([line(F.p1)], [cash(1000)])); // +500 net of change
    await M.mutation(api.sales.create, sale([line(F.p1)], [{ method: "EVC", amountCents: 500 }])); // not cash
    await M.mutation(api.shifts.cashMove, { type: "IN", amountCents: 200, reason: "float top up" });
    await M.mutation(api.shifts.cashMove, { type: "OUT", amountCents: 50, reason: "bought bags" });
    await M.mutation(api.sales.refund, { saleId: s1.saleId, items: [{ productId: F.p1, qty: 1, restock: true }], method: "CASH", reason: "return" }); // -500
    await M.mutation(api.expenses.create, { category: "Rent", amountCents: 120, paidVia: "CASH", payee: "", note: "", spentAt: Date.now() }); // -120
    await M.mutation(api.expenses.create, { category: "Rent", amountCents: 999, paidVia: "EVC", payee: "", note: "", spentAt: Date.now() }); // not cash
    expect((await get(s1.saleId)).shiftId).toBeDefined();

    await M.mutation(api.customers.recordPayment, { customerId: F.wholesale2, amountCents: 300, method: "CASH" }); // +300
    await M.mutation(api.customers.recordPayment, { customerId: F.wholesale2, amountCents: 100, method: "EVC" }); // not cash
    const cur = (await M.query(api.shifts.current, {}))!;
    expect(cur).toMatchObject({ cashSalesCents: 500, cashRefundsCents: 500, cashInCents: 200, cashOutCents: 50, cashExpensesCents: 120, cashRepaymentsCents: 300, salesCount: 2, expectedCashCents: 1330 });
    expect(cur.byMethod).toMatchObject({ CASH: 500, EVC: 500 });

    const z = await M.mutation(api.shifts.close, { countedCashCents: 1000, note: "short" });
    expect(z).toMatchObject({ expectedCashCents: 1330, countedCashCents: 1000, differenceCents: -330 });
    expect(z.shift.status).toBe("CLOSED");
    expect(await M.query(api.shifts.current, {})).toBeNull();
    expect(await code(M.mutation(api.shifts.close, { countedCashCents: 0 }))).toBe("SHIFT_REQUIRED");
    expect(await code(M.mutation(api.shifts.cashMove, { type: "IN", amountCents: 5, reason: "x" }))).toBe("SHIFT_REQUIRED");
    const rep = await M.query(api.shifts.report, { shiftId: z.shift._id });
    expect(rep).toMatchObject({ expectedCashCents: 1330, differenceCents: -330, refundsCents: 500, cashRepaymentsCents: 300 });
    const list = await as(F.ownerA).query(api.shifts.list, { from: 0, to: Date.now() + DAY });
    expect(list.map((x) => x.differenceCents)).toEqual([-330]);
    // a new shift can be opened after closing
    expect(await code(M.mutation(api.shifts.open, { openingFloatCents: 0 }))).toBe("OK");
  });

  it("expectedByMethod: EVC sale + EVC repayment - EVC refund - EVC expense; counted EVC stores difference", async () => {
    const M = as(F.managerA);
    await M.mutation(api.shifts.open, { openingFloatCents: 100 });
    const s1 = await M.mutation(api.sales.create, sale([line(F.p1, 2)], [{ method: "EVC", amountCents: 1000 }])); // +1000
    await M.mutation(api.sales.create, sale([line(F.p1)], [{ method: "CREDIT", amountCents: 500 }], { customerId: F.retail })); // deen
    await M.mutation(api.customers.recordPayment, { customerId: F.wholesale2, amountCents: 300, method: "EVC" }); // +300
    await M.mutation(api.sales.refund, { saleId: s1.saleId, items: [{ productId: F.p1, qty: 1, restock: true }], method: "EVC", reason: "return" }); // -500
    await M.mutation(api.expenses.create, { category: "Rent", amountCents: 50, paidVia: "EVC", payee: "", note: "", spentAt: Date.now() }); // -50
    const cur = (await M.query(api.shifts.current, {}))!;
    expect(cur.expectedByMethod).toEqual({ EVC: 750, ZAAD: 0, EDAHAB: 0, CASH: 100, BANK: 0 });
    expect(cur).toMatchObject({ creditGivenCents: 500, expensesCents: 50, expectedCashCents: 100 });
    expect(cur.repaymentsByMethod.EVC).toBe(300);
    expect(cur.refundsByMethod.EVC).toBe(500);
    expect(cur.itemsSold[0]).toMatchObject({ name: "p1", qty: 3, totalCents: 1500 });

    expect(await code(M.mutation(api.shifts.close, { countedCashCents: 100, counted: [{ method: "CASH", amountCents: 1 }] }))).toBe("INVALID_INPUT");
    const z = await M.mutation(api.shifts.close, { countedCashCents: 100, counted: [{ method: "EVC", amountCents: 700 }] });
    expect(z.methods).toEqual([
      { method: "EVC", expected: 750, counted: 700, difference: -50 },
      { method: "CASH", expected: 100, counted: 100, difference: 0 },
    ]);
    const list = await as(F.ownerA).query(api.shifts.list, { from: 0, to: Date.now() + DAY });
    expect(list[0]).toMatchObject({ totalDifferenceCents: -50, differenceCents: 0 });
  });

  it("cashiers see only their own Z-report; other tenants see nothing", async () => {
    const id = await as(F.cashierA).mutation(api.shifts.open, { openingFloatCents: 0 });
    expect(await code(as(F.cashierA).query(api.shifts.report, { shiftId: id }))).toBe("OK");
    expect(await code(as(F.cashier2).query(api.shifts.report, { shiftId: id }))).toBe("FORBIDDEN");
    expect(await code(as(F.ownerA).query(api.shifts.report, { shiftId: id }))).toBe("OK");
    expect(await code(as(F.ownerA).query(api.shifts.report, { shiftId: F.bShift }))).toBe("NOT_FOUND");
    expect(await code(as(F.cashierA).query(api.shifts.report, { shiftId: F.bShift }))).toBe("NOT_FOUND");
  });
});

describe("customers & credit", () => {
  it("ADJUST_UP / ADJUST_DOWN / WRITE_OFF: roles, notes, balances", async () => {
    const M = as(F.managerA);
    const adj = (direction: "UP" | "DOWN", amountCents: number, note = "agreed") => ({ customerId: F.retail, direction, amountCents, note });
    expect((await M.mutation(api.customers.adjustBalance, adj("UP", 700))).balanceAfterCents).toBe(700);
    expect((await M.mutation(api.customers.adjustBalance, adj("DOWN", 200))).balanceAfterCents).toBe(500);
    expect(await code(M.mutation(api.customers.adjustBalance, adj("UP", 100, " ")))).toBe("REASON_REQUIRED");
    expect(await code(M.mutation(api.customers.adjustBalance, adj("UP", 0)))).toBe("INVALID_INPUT");
    expect(await code(as(F.cashierA).mutation(api.customers.adjustBalance, adj("UP", 100)))).toBe("FORBIDDEN");
    expect(await code(as(F.cashierA).mutation(api.customers.writeOff, { customerId: F.retail, note: "x" }))).toBe("FORBIDDEN");
    expect(await code(M.mutation(api.customers.writeOff, { customerId: F.retail, note: "x" }))).toBe("FORBIDDEN");
    expect(await code(as(F.ownerA).mutation(api.customers.writeOff, { customerId: F.retail, note: "" }))).toBe("REASON_REQUIRED");
    const w = await as(F.ownerA).mutation(api.customers.writeOff, { customerId: F.retail, note: "bad debt" });
    expect(w.balanceAfterCents).toBe(0);
    expect(await code(as(F.ownerA).mutation(api.customers.writeOff, { customerId: F.retail, note: "again" }))).toBe("INVALID_INPUT");
    const types = (await ledgerOf(F.retail)).map((l) => [l.type, l.amountCents, l.balanceAfterCents]);
    expect(types).toEqual([["ADJUST_UP", 700, 700], ["ADJUST_DOWN", 200, 500], ["WRITE_OFF", 500, 0]]);
  });

  it("create: cashier gets no credit, group or opening balance; owner opening balance writes OPENING", async () => {
    const f = { type: "INDIVIDUAL" as const, companyName: "", whatsapp: "", address: "", district: "", notes: "", phone: "5", fullName: "N" };
    const C = as(F.cashierA);
    expect(await code(C.mutation(api.customers.create, { ...f, group: "RETAIL", creditLimitCents: 0, openingBalanceCents: 100 }))).toBe("FORBIDDEN");
    const cid = await C.mutation(api.customers.create, { ...f, group: "WHOLESALE", creditLimitCents: 9999, openingBalanceCents: 0 });
    expect(await get(cid)).toMatchObject({ group: "RETAIL", creditLimitCents: 0, balanceCents: 0 });
    expect(await code(C.mutation(api.customers.update, { customerId: cid, ...f, group: "VIP", creditLimitCents: 0 }))).toBe("FORBIDDEN");
    const oid = await as(F.ownerA).mutation(api.customers.create, { ...f, fullName: "Debtor", group: "WHOLESALE", creditLimitCents: 5000, openingBalanceCents: -300 });
    expect(await get(oid)).toMatchObject({ group: "WHOLESALE", balanceCents: -300 }); // store credit
    expect((await ledgerOf(oid)).map((l) => l.type)).toEqual(["OPENING"]);
    expect(await code(as(F.managerA).mutation(api.customers.setCreditBlocked, { customerId: oid, blocked: true }))).toBe("OK");
    expect(await code(C.mutation(api.customers.setCreditBlocked, { customerId: oid, blocked: false }))).toBe("FORBIDDEN");
  });

  it("payment returns the new balance; list filters", async () => {
    const C = as(F.cashierA);
    await t.run((ctx) => ctx.db.patch(F.retail, { balanceCents: 900, creditLimitCents: 500 }));
    const r = await C.mutation(api.customers.recordPayment, { customerId: F.retail, amountCents: 100, method: "EVC", reference: "r1" });
    expect(r.balanceAfterCents).toBe(800);
    expect(await code(C.mutation(api.customers.recordPayment, { customerId: F.retail, amountCents: 100, method: "CREDIT" as never }))).toMatch(/RAW|INVALID/);
    const names = async (filter?: "DEBT" | "OVER_LIMIT" | "OVERDUE" | "BLOCKED") => (await C.query(api.customers.list, { filter })).map((c) => c.fullName).sort();
    expect(await names("DEBT")).toEqual(["debtor2", "retail"]);
    expect(await names("OVER_LIMIT")).toEqual(["retail"]);
    expect(await names("BLOCKED")).toEqual(["blocked"]);
    expect(await names("OVERDUE")).toEqual([]); // paid just now
    expect((await C.query(api.customers.list, { group: "WHOLESALE" })).map((c) => c.fullName)).toEqual(["wholesale"]);
    expect((await C.query(api.customers.list, { search: "retail" }))[0].daysSinceLastPayment).toBe(0);
  });

  it("statement: opening and closing balances", async () => {
    const id = await as(F.ownerA).mutation(api.customers.create, {
      type: "INDIVIDUAL", companyName: "", whatsapp: "", address: "", district: "", notes: "", phone: "9", fullName: "S", group: "RETAIL",
      creditLimitCents: 5000, openingBalanceCents: 0,
    });
    const rows: [Doc<"ledger">["type"], number, number, number][] = [
      ["DEBT", 500, 500, 1000], ["PAYMENT", 200, 300, 2000], ["ADJUST_UP", 100, 400, 3000],
    ];
    await t.run(async (ctx) => {
      for (const [type, amountCents, balanceAfterCents, createdAt] of rows)
        await ctx.db.insert("ledger", { businessId: F.A.businessId, customerId: id, type, amountCents, balanceAfterCents, createdBy: F.ownerA.memberId, createdAt });
    });
    const st = (from: number, to: number) => as(F.cashierA).query(api.customers.statement, { customerId: id, from, to });
    const mid = await st(1500, 2500);
    expect([mid.openingBalanceCents, mid.rows.map((r) => [r.type, r.deltaCents]), mid.closingBalanceCents]).toEqual([500, [["PAYMENT", -200]], 300]);
    const all = await st(0, 5000);
    expect([all.openingBalanceCents, all.rows.map((r) => r.deltaCents), all.closingBalanceCents]).toEqual([0, [500, -200, 100], 400]);
    const after = await st(3500, 9000);
    expect([after.openingBalanceCents, after.rows.length, after.closingBalanceCents]).toEqual([400, 0, 400]);
    expect(all.business.name).toBe("A");
    expect(await code(as(F.ownerA).query(api.customers.statement, { customerId: F.bCustomer, from: 0, to: 9 }))).toBe("NOT_FOUND");
    expect(await code(as(F.ownerA).query(api.customers.statement, { customerId: id, from: 9, to: 0 }))).toBe("INVALID_INPUT");
  });

  it("importCsv skips bad and duplicate rows", async () => {
    const r = await as(F.managerA).mutation(api.customers.importCsv, {
      rows: [
        { fullName: "Ok One", phone: "111", openingBalanceCents: 250 },
        { fullName: "Dup", phone: "111" },
        { fullName: "", phone: "222" },
        { fullName: "Bad", phone: "333", creditLimitCents: -5 },
      ],
    });
    expect(r.created).toBe(1);
    expect(r.skipped.map((s) => s.row)).toEqual([2, 3, 4]);
    expect(await code(as(F.cashierA).mutation(api.customers.importCsv, { rows: [] }))).toBe("FORBIDDEN");
  });
});

describe("cross-tenant & views", () => {
  it("A cannot refund, view, or list B's sale", async () => {
    const O = as(F.ownerA);
    expect(await code(O.mutation(api.sales.refund, { saleId: F.bSale, items: [{ productId: F.bProduct, qty: 1, restock: true }], method: "CASH", reason: "x" }))).toBe("NOT_FOUND");
    expect(await code(O.query(api.sales.get, { saleId: F.bSale }))).toBe("NOT_FOUND");
    expect(await code(O.query(api.sales.list, { from: 0, to: Date.now() + DAY, shiftId: F.bShift }))).toBe("NOT_FOUND");
    expect(await O.query(api.sales.findByReceipt, { receiptNo: 1 })).toBeNull(); // A has no receipt 1 yet; B's is invisible
    expect(await code(O.mutation(api.sales.create, sale([line(F.p1)], [cash(500)], { customerId: F.bCustomer })))).toBe("NOT_FOUND");
    expect((await get(F.bSale)).status).toBe("COMPLETED");
  });

  it("cost is stripped without seeCost; get/list/findByReceipt/recent agree", async () => {
    const s = await as(F.cashierA).mutation(api.sales.create, sale([line(F.p1)], [cash(500)]));
    const costOf = (x: { items: object[] }) => (x.items[0] as { costCents?: number }).costCents;
    expect(costOf(await as(F.cashierA).query(api.sales.get, { saleId: s.saleId }))).toBeUndefined();
    expect(costOf((await as(F.cashierA).query(api.sales.recentForCashier, {}))[0])).toBeUndefined();
    expect(costOf((await as(F.cashierA).query(api.sales.findByReceipt, { receiptNo: s.receiptNo }))!)).toBeUndefined();
    expect(costOf((await as(F.blindMgr).query(api.sales.list, { from: 0, to: Date.now() + DAY })).sales[0])).toBeUndefined();
    expect(costOf(await as(F.ownerA).query(api.sales.get, { saleId: s.saleId }))).toBe(300);
    const l = await as(F.ownerA).query(api.sales.list, { from: 0, to: Date.now() + DAY, method: "CASH", status: "COMPLETED" });
    expect(l.totals).toMatchObject({ count: 1, totalCents: 500 });
  });

  it("reports: refunds are netted, profit needs seeCost", async () => {
    const M = as(F.managerA);
    const s = await as(F.cashierA).mutation(api.sales.create, sale([line(F.p1, 2)], [cash(1000)]));
    await M.mutation(api.sales.refund, { saleId: s.saleId, items: [{ productId: F.p1, qty: 1, restock: true }], method: "CASH", reason: "r" });
    await M.mutation(api.expenses.create, { category: "Rent", amountCents: 100, paidVia: "CASH", payee: "", note: "", spentAt: Date.now() });
    const range = { from: Date.now() - DAY, to: Date.now() + DAY };
    const sum = await M.query(api.reports.summary, range);
    expect(sum).toMatchObject({ revenueCents: 1000, refundsCents: 500, costCents: 300, grossProfitCents: 200, netProfitCents: 100, refundsCount: 1, salesCount: 1 });
    expect(sum.byPaymentMethod).toMatchObject({ CASH: 500, EVC: 0 });
    const pl = await M.query(api.reports.profitAndLoss, range);
    expect(pl).toMatchObject({ revenueCents: 1000, refundsCents: 500, netSalesCents: 500, cogsCents: 300, grossProfitCents: 200, totalExpensesCents: 100, netProfitCents: 100 });
    const by = await M.query(api.reports.salesBy, { ...range, dimension: "product" });
    expect(by).toEqual([{ key: F.p1, label: "p1", qty: 1, revenueCents: 500, profitCents: 200 }]);
    const blind = as(F.blindMgr);
    expect(await code(blind.query(api.reports.profitAndLoss, range))).toBe("NO_PERMISSION");
    expect(await blind.query(api.reports.summary, range)).toMatchObject({ revenueCents: 1000, costCents: null, grossProfitCents: null, netProfitCents: null });
    expect((await blind.query(api.reports.salesBy, { ...range, dimension: "cashier" }))[0].profitCents).toBeNull();
    expect(await code(as(F.cashierA).query(api.reports.salesBy, { ...range, dimension: "hour" }))).toBe("FORBIDDEN");
  });
});
