/// <reference types="vite/client" />
// Inventory / purchases / expiry tests. Run: npx vitest run convex/inventory.test.ts
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { stockOut } from "./lib/stock";
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
          taxRatePercent: 0, lowStockThreshold: 5, allowNegativeStock: false, paymentMethods: ["CASH"],
          maxCashierDiscountPercent: 10, defaultCreditLimitCents: 0, expenseCategories: ["Rent"], discountPresets: [5],
        },
        createdAt: now,
      });
      return { businessId, ownerUserId };
    };
    const mkMember = async (
      role: "OWNER" | "MANAGER" | "CASHIER", username: string, businessId: Id<"businesses">,
      opts: { userId?: Id<"users">; permissions?: Doc<"members">["permissions"] } = {},
    ) => {
      const userId = opts.userId ?? (await ctx.db.insert("users", { email: username, name: username }));
      const memberId = await ctx.db.insert("members", {
        userId, businessId, role, username, fullName: username, isActive: true, createdAt: now, permissions: opts.permissions,
      });
      return { userId, memberId };
    };
    const A = await mkBiz("A");
    const B = await mkBiz("B");
    const ownerA = await mkMember("OWNER", "owner-a", A.businessId, { userId: A.ownerUserId });
    const managerA = await mkMember("MANAGER", "manager-a", A.businessId);
    const noAdjustA = await mkMember("MANAGER", "noadjust-a", A.businessId, {
      permissions: { seeCost: false, giveDiscount: true, refund: true, adjustStock: false, editPrice: false },
    });
    const cashierA = await mkMember("CASHIER", "cashier-a", A.businessId);
    const ownerB = await mkMember("OWNER", "owner-b", B.businessId, { userId: B.ownerUserId });
    return { A, B, ownerA, managerA, noAdjustA, cashierA, ownerB };
  });
}

const as = (u: { userId: Id<"users"> }) => t.withIdentity({ subject: `${u.userId}|fakesession` });

beforeEach(async () => {
  t = makeT();
  F = await build(t);
});

const pf = {
  type: "STOCKABLE" as const, name: "Milk", sku: "", barcode: "", extraBarcodes: [] as string[], brand: "", unit: "pcs",
  allowDecimal: false, costCents: 100, priceCents: 150, reorderLevel: 5, trackExpiry: false,
};
const mkProduct = (o: Partial<typeof pf> & { categoryId?: Id<"categories">; openingStock?: number; openingBatch?: { batchNo: string; expiryDate: number } } = {}) =>
  as(F.ownerA).mutation(api.products.create, { ...pf, ...o });
const product = (id: Id<"products">) => t.run((ctx) => ctx.db.get(id));
const batchesOf = (id: Id<"products">) => t.run((ctx) => ctx.db.query("batches").withIndex("by_product_expiry", (q) => q.eq("productId", id)).collect());
const mkSupplier = (u = F.ownerA) =>
  as(u).mutation(api.suppliers.create, { name: "Sup", company: "", phone: "", whatsapp: "", address: "", notes: "", openingBalanceCents: 0 });
const buy = (productId: Id<"products">, qty: number, unit: number, extra: Record<string, unknown> = {}) =>
  as(F.ownerA).mutation(api.purchases.create, {
    items: [{ productId, qty, unitCostCents: unit, ...(extra.item as object) }],
    otherCostCents: 0, paidCents: qty * unit, paidMethod: "CASH", note: "", ...(extra.top as object),
  });
const sale = (id: Id<"products">, qty: number) =>
  t.run(async (ctx) => {
    const member = (await ctx.db.get(F.ownerA.memberId))!;
    return await stockOut(ctx, member, (await ctx.db.get(id))!, qty, "SALE", { allowNegative: false });
  });

describe("FEFO and expiry", () => {
  it("sells the earliest non-expired batch first and skips expired ones", async () => {
    const id = await mkProduct({ trackExpiry: true });
    const now = Date.now();
    await buy(id, 5, 100, { item: { batchNo: "OLD", expiryDate: now - DAY } });
    await buy(id, 5, 100, { item: { batchNo: "LATE", expiryDate: now + 60 * DAY } });
    await buy(id, 5, 100, { item: { batchNo: "SOON", expiryDate: now + 10 * DAY } });
    const used = await sale(id, 7);
    const bs = await batchesOf(id);
    const by = Object.fromEntries(bs.map((b) => [b.batchNo, b.qty]));
    expect(by).toEqual({ OLD: 5, SOON: 0, LATE: 3 });
    expect(used.map((u) => u.qty)).toEqual([5, 2]);
    expect((await product(id))!.stock).toBe(8);
  });

  it("PRODUCT_EXPIRED when everything left is expired", async () => {
    const id = await mkProduct({ trackExpiry: true });
    await buy(id, 4, 100, { item: { batchNo: "OLD", expiryDate: Date.now() - DAY } });
    expect(await code(sale(id, 1))).toBe("PRODUCT_EXPIRED");
  });

  it("writeOff removes one batch via WRITE_OFF movement; needs adjustStock", async () => {
    const id = await mkProduct({ trackExpiry: true });
    await buy(id, 4, 100, { item: { batchNo: "OLD", expiryDate: Date.now() - DAY } });
    await buy(id, 6, 100, { item: { batchNo: "OK", expiryDate: Date.now() + 40 * DAY } });
    const old = (await batchesOf(id)).find((b) => b.batchNo === "OLD")!;
    expect(await code(as(F.noAdjustA).mutation(api.expiry.writeOff, { batchId: old._id }))).toBe("NO_PERMISSION");
    await as(F.managerA).mutation(api.expiry.writeOff, { batchId: old._id, note: "bin" });
    expect((await product(id))!.stock).toBe(6);
    const mv = await t.run((ctx) => ctx.db.query("stockMovements").withIndex("by_product", (q) => q.eq("productId", id)).collect());
    expect(mv.some((m) => m.type === "WRITE_OFF" && m.qty === -4 && m.batchId === old._id)).toBe(true);
    const w = await as(F.managerA).query(api.expiry.watchlist, {});
    expect(w.expired.length).toBe(0);
    expect(w.threeMonths.length).toBe(1);
    expect(await as(F.cashierA).query(api.expiry.alertCount, {})).toBeNull();
  });
});

describe("purchases and suppliers", () => {
  it("increases stock, creates a batch, weighted cost incl. other cost, supplier balance + ledger", async () => {
    const id = await mkProduct({ trackExpiry: true, openingStock: 10, openingBatch: { batchNo: "O", expiryDate: Date.now() + 90 * DAY } });
    const supplierId = await mkSupplier();
    const exp = Date.now() + 30 * DAY;
    const r = await as(F.ownerA).mutation(api.purchases.create, {
      supplierId, items: [{ productId: id, qty: 10, unitCostCents: 200, batchNo: "B1", expiryDate: exp }],
      otherCostCents: 100, paidCents: 500, paidMethod: "CASH", note: "n",
    });
    expect(r.number).toBe(1);
    const p = (await product(id))!;
    expect(p.stock).toBe(20);
    expect(p.costCents).toBe(155); // landed 210, avg of 10@100 and 10@210
    expect(p.supplierId).toBe(supplierId);
    const b = (await batchesOf(id)).find((x) => x.batchNo === "B1")!;
    expect(b.qty).toBe(10);
    expect(b.expiryDate).toBe(exp);
    expect(b.purchaseId).toBe(r.purchaseId);
    const s = await as(F.ownerA).query(api.suppliers.get, { supplierId });
    expect(s.supplier.balanceCents).toBe(1600); // 2100 total - 500 paid
    expect(s.ledger[0]).toMatchObject({ type: "PURCHASE", amountCents: 1600, balanceAfterCents: 1600 });
    expect(s.purchases).toHaveLength(1);
    // pay more than owed, then pay part
    expect(await code(as(F.ownerA).mutation(api.suppliers.pay, { supplierId, amountCents: 1700, method: "CASH" }))).toBe("PAYMENT_EXCEEDS_BALANCE");
    const pay = await as(F.ownerA).mutation(api.suppliers.pay, { supplierId, amountCents: 600, method: "EVC", reference: "x" });
    expect(pay.balanceAfterCents).toBe(1000);
    expect(await code(as(F.ownerA).mutation(api.suppliers.adjust, { supplierId, direction: "UP", amountCents: 5, note: " " }))).toBe("REASON_REQUIRED");
  });

  it("EXPIRY_REQUIRED for a tracked product without expiry; credit needs a supplier", async () => {
    const id = await mkProduct({ trackExpiry: true });
    expect(await code(buy(id, 2, 100))).toBe("EXPIRY_REQUIRED");
    expect((await product(id))!.stock).toBe(0); // rolled back
    const plain = await mkProduct({ name: "Rice" });
    expect(await code(buy(plain, 2, 100, { top: { paidCents: 0 } }))).toBe("INVALID_INPUT");
    expect(await code(buy(plain, 0.5, 100))).toBe("INVALID_INPUT"); // decimal on integer product
  });

  it("a manager can receive stock; a cashier cannot open purchases", async () => {
    const id = await mkProduct();
    await as(F.managerA).mutation(api.purchases.create, { items: [{ productId: id, qty: 3, unitCostCents: 50 }], otherCostCents: 0, paidCents: 150, paidMethod: "CASH", note: "" });
    expect((await product(id))!.stock).toBe(3);
    expect(await code(as(F.cashierA).query(api.suppliers.list, {}))).toBe("FORBIDDEN");
  });
});

describe("adjust, stocktake, valuation", () => {
  it("adjust requires adjustStock (cashier and permission-less manager rejected)", async () => {
    const id = await mkProduct({ openingStock: 10 });
    const args = { productId: id, delta: -2, reason: "DAMAGED" as const };
    expect(await code(as(F.cashierA).mutation(api.inventory.adjust, args))).toBe("FORBIDDEN");
    expect(await code(as(F.noAdjustA).mutation(api.inventory.adjust, args))).toBe("NO_PERMISSION");
    await as(F.managerA).mutation(api.inventory.adjust, args);
    await as(F.ownerA).mutation(api.inventory.adjust, { productId: id, delta: 1, reason: "FOUND" });
    expect((await product(id))!.stock).toBe(9);
    expect(await code(as(F.ownerA).mutation(api.inventory.adjust, { productId: id, delta: -50, reason: "LOST" }))).toBe("INSUFFICIENT_STOCK");
    expect(await code(as(F.ownerA).mutation(api.inventory.adjust, { productId: id, delta: 0.5, reason: "LOST" }))).toBe("INVALID_INPUT");
    const mv = await as(F.ownerA).query(api.inventory.movements, { productId: id, from: 0, to: Date.now() + DAY });
    expect(mv.map((m) => m.type).sort()).toEqual(["ADJUSTMENT", "ADJUSTMENT", "OPENING"]);
  });

  it("stocktake applies differences and reports variance value", async () => {
    const a = await mkProduct({ name: "A", openingStock: 10, costCents: 100 });
    const b = await mkProduct({ name: "B", openingStock: 5, costCents: 300 });
    const c = await mkProduct({ name: "C", openingStock: 2 });
    const r = await as(F.ownerA).mutation(api.inventory.stocktake, {
      counts: [{ productId: a, counted: 8 }, { productId: b, counted: 6 }, { productId: c, counted: 2 }],
    });
    expect(r).toEqual({ adjusted: 2, varianceValueCents: -2 * 100 + 1 * 300 });
    expect((await product(a))!.stock).toBe(8);
    expect((await product(b))!.stock).toBe(6);
    const mv = await as(F.ownerA).query(api.inventory.movements, { type: "STOCKTAKE", from: 0, to: Date.now() + DAY });
    expect(mv).toHaveLength(2);
    expect(await code(as(F.noAdjustA).mutation(api.inventory.stocktake, { counts: [{ productId: a, counted: 1 }] }))).toBe("NO_PERMISSION");
  });

  it("valuation needs seeCost; lowStock suggests a reorder quantity", async () => {
    await mkProduct({ openingStock: 2, reorderLevel: 5, costCents: 100, priceCents: 150 });
    const v = await as(F.ownerA).query(api.inventory.valuation, {});
    expect(v).toMatchObject({ totalCostCents: 200, totalRetailCents: 300 });
    expect(await code(as(F.noAdjustA).query(api.inventory.valuation, {}))).toBe("NO_PERMISSION");
    const low = await as(F.ownerA).query(api.inventory.lowStock, {});
    expect(low[0].suggestedQty).toBe(8);
  });
});

describe("products", () => {
  it("barcode/SKU unique across primary and extra barcodes", async () => {
    await mkProduct({ name: "A", barcode: "111", extraBarcodes: ["222"], sku: "S1" });
    expect(await code(mkProduct({ name: "B", barcode: "222" }))).toBe("BARCODE_EXISTS");
    expect(await code(mkProduct({ name: "C", extraBarcodes: ["111"] }))).toBe("BARCODE_EXISTS");
    expect(await code(mkProduct({ name: "D", sku: "S1" }))).toBe("SKU_EXISTS");
    await mkProduct({ name: "E", barcode: "333" });
  });

  it("variants: template has no stock, children carry opening stock; posCatalog hides the template", async () => {
    const parent = await as(F.ownerA).mutation(api.products.create, {
      ...pf, name: "Shirt", variants: [
        { label: "Red", sku: "R", barcode: "", priceCents: 500, costCents: 200, openingStock: 4 },
        { label: "Blue", sku: "B", barcode: "", priceCents: 500, costCents: 200, openingStock: 6 },
      ],
    });
    expect((await product(parent))!.hasVariants).toBe(true);
    const cat = await as(F.cashierA).query(api.products.posCatalog, {});
    expect(cat.map((c) => c.name).sort()).toEqual(["Shirt (Blue)", "Shirt (Red)"]);
    const d = await as(F.ownerA).query(api.products.get, { productId: parent });
    expect(d.variants).toHaveLength(2);
  });

  it("price changes need editPrice; stock is not editable through update", async () => {
    const id = await mkProduct({ openingStock: 3 });
    const cur = (await as(F.ownerA).query(api.products.get, { productId: id })).product;
    const args = { ...pf, productId: id, name: "Milk2", costCents: 100, priceCents: 999 };
    expect(await code(as(F.noAdjustA).mutation(api.products.update, args))).toBe("NO_PERMISSION");
    await as(F.managerA).mutation(api.products.update, args);
    expect((await product(id))!.stock).toBe(3);
    expect(cur.name).toBe("Milk");
  });

  it("importCsv creates categories and skips bad rows", async () => {
    const row = { name: "N", sku: "", barcode: "", category: "Drinks", brand: "", unit: "pcs", costCents: 1, priceCents: 2, stock: 5, reorderLevel: 1 };
    const r = await as(F.ownerA).mutation(api.products.importCsv, {
      rows: [row, { ...row, name: "M", barcode: "9" }, { ...row, name: "" }, { ...row, name: "Dup", barcode: "9" }],
    });
    expect(r.created).toBe(2);
    expect(r.skipped).toEqual([{ row: 3, reason: "INVALID_INPUT" }, { row: 4, reason: "BARCODE_EXISTS" }]);
    expect(await as(F.ownerA).query(api.categories.list, {})).toHaveLength(1);
  });
});

describe("cost visibility", () => {
  it("cost is stripped for members without seeCost", async () => {
    const id = await mkProduct({ openingStock: 3 });
    const own = await as(F.ownerA).query(api.products.list, {});
    expect(own[0].costCents).toBe(100);
    const noCostList = await as(F.noAdjustA).query(api.products.list, {});
    expect(noCostList[0]).not.toHaveProperty("costCents");
    const d = await as(F.noAdjustA).query(api.products.get, { productId: id });
    expect(d.product).not.toHaveProperty("costCents");
    expect(d.movements[0]).not.toHaveProperty("unitCostCents");
    const cat = await as(F.cashierA).query(api.products.posCatalog, {});
    expect(JSON.stringify(cat)).not.toContain("costCents");
    expect(await as(F.noAdjustA).query(api.products.exportCsv, {})).toSatisfy((rows: object[]) => !("costCents" in rows[0]));
    await buy(id, 1, 100);
    const ps = await as(F.noAdjustA).query(api.purchases.list, { from: 0, to: Date.now() + DAY });
    expect(ps[0].items[0]).not.toHaveProperty("unitCostCents");
  });
});

describe("tenant isolation", () => {
  it("business B cannot read or modify A's product, supplier, purchase, batch or category", async () => {
    const pid = await mkProduct({ trackExpiry: true });
    const supplierId = await mkSupplier();
    const { purchaseId } = await as(F.ownerA).mutation(api.purchases.create, {
      supplierId, items: [{ productId: pid, qty: 2, unitCostCents: 10, batchNo: "x", expiryDate: Date.now() + 20 * DAY }],
      otherCostCents: 0, paidCents: 0, note: "",
    });
    const batchId = (await batchesOf(pid))[0]._id;
    const categoryId = await as(F.ownerA).mutation(api.categories.create, { name: "Food" });
    const b = as(F.ownerB);
    const NF = "NOT_FOUND";
    expect(await code(b.query(api.products.get, { productId: pid }))).toBe(NF);
    expect(await code(b.mutation(api.products.update, { ...pf, productId: pid }))).toBe(NF);
    expect(await code(b.mutation(api.products.archive, { productId: pid, archived: true }))).toBe(NF);
    expect(await code(b.mutation(api.inventory.adjust, { productId: pid, delta: 1, reason: "FOUND", batch: { batchNo: "a", expiryDate: Date.now() + DAY } }))).toBe(NF);
    expect(await code(b.mutation(api.inventory.stocktake, { counts: [{ productId: pid, counted: 1 }] }))).toBe(NF);
    expect(await code(b.mutation(api.expiry.writeOff, { batchId }))).toBe(NF);
    expect(await code(b.mutation(api.expiry.setPrice, { productId: pid, priceCents: 1 }))).toBe(NF);
    expect(await code(b.query(api.suppliers.get, { supplierId }))).toBe(NF);
    expect(await code(b.mutation(api.suppliers.pay, { supplierId, amountCents: 1, method: "CASH" }))).toBe(NF);
    expect(await code(b.mutation(api.suppliers.adjust, { supplierId, direction: "DOWN", amountCents: 1, note: "x" }))).toBe(NF);
    expect(await code(b.query(api.purchases.get, { purchaseId }))).toBe(NF);
    expect(await code(b.query(api.purchases.list, { from: 0, to: Date.now() + DAY, supplierId }))).toBe(NF);
    expect(await code(b.mutation(api.purchases.create, { supplierId, items: [{ productId: pid, qty: 1, unitCostCents: 1 }], otherCostCents: 0, paidCents: 0, note: "" }))).toBe(NF);
    expect(await code(b.mutation(api.purchases.create, { items: [{ productId: pid, qty: 1, unitCostCents: 1 }], otherCostCents: 0, paidCents: 0, note: "" }))).toBe(NF);
    expect(await code(b.mutation(api.categories.rename, { categoryId, name: "x" }))).toBe(NF);
    expect(await code(b.mutation(api.categories.remove, { categoryId }))).toBe(NF);
    expect(await code(b.mutation(api.products.create, { ...pf, categoryId }))).toBe(NF);
    expect(await code(b.mutation(api.products.create, { ...pf, supplierId }))).toBe(NF);
    // lists are scoped
    expect(await b.query(api.products.list, {})).toHaveLength(0);
    expect(await b.query(api.suppliers.list, {})).toHaveLength(0);
    expect(await b.query(api.categories.list, {})).toHaveLength(0);
    expect(await b.query(api.purchases.list, { from: 0, to: Date.now() + DAY })).toHaveLength(0);
    expect(await b.query(api.inventory.movements, { from: 0, to: Date.now() + DAY })).toHaveLength(0);
    expect((await b.query(api.expiry.watchlist, {})).threeMonths).toHaveLength(0);
    // same barcode in another tenant is fine
    await mkProduct({ barcode: "777" });
    await b.mutation(api.products.create, { ...pf, barcode: "777" });
  });

  it("category in use cannot be removed", async () => {
    const categoryId = await as(F.ownerA).mutation(api.categories.create, { name: "Food" });
    await mkProduct({ categoryId });
    expect(await code(as(F.ownerA).mutation(api.categories.remove, { categoryId }))).toBe("CATEGORY_IN_USE");
  });
});
