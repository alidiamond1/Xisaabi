/// <reference types="vite/client" />
// v3: business types, packs/units, attributes, serials (IMEI). Run: npm test
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { MODULE_KEYS } from "./shared/modules";

const modules = import.meta.glob("./**/*.*s");
const DAY = 86_400_000;
const IMEI1 = "490154203237518"; // valid Luhn
const IMEI2 = "356938035643809"; // valid Luhn
const IMEI3 = "353879234252633"; // valid Luhn

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
    const mkBiz = async (name: string, v3: boolean) => {
      const ownerUserId = await ctx.db.insert("users", { email: `${name}-owner`, name });
      const businessId = await ctx.db.insert("businesses", {
        name, businessType: "Shop", phone: "1", address: "a", city: "c", country: "SO", currency: "USD",
        ownerUserId, status: "ACTIVE", planId, subscriptionStatus: "ACTIVE", subscriptionEndsAt: now + 365 * DAY,
        settings: {
          taxRatePercent: 0, lowStockThreshold: 5, allowNegativeStock: false,
          paymentMethods: ["CASH", "EVC", "ZAAD", "EDAHAB", "CREDIT"], maxCashierDiscountPercent: 10,
          defaultCreditLimitCents: 0, expenseCategories: ["Rent"], discountPresets: [5, 10],
        },
        ...(v3
          ? {
              businessTypes: ["pharmacy"],
              features: ["units" as const, "attributes" as const, "serials" as const],
              attributeDefs: [
                { key: "generic", label: "Generic name", type: "text" as const, searchable: true },
                { key: "form", label: "Form", type: "select" as const, options: ["Tablet", "Syrup"], searchable: false },
              ],
            }
          : {}),
        createdAt: now,
      });
      const userId = await ctx.db.insert("users", { email: `${name}-user`, name });
      await ctx.db.insert("members", { userId, businessId, role: "OWNER", username: `${name}-user`, fullName: name, isActive: true, createdAt: now });
      return { businessId, userId };
    };
    const A = await mkBiz("A", true);
    const B = await mkBiz("B", true);
    const V2 = await mkBiz("V2", false);
    const newUser = await ctx.db.insert("users", { email: "fresh@x.so", name: "fresh" });
    return { A, B, V2, newUser };
  });
}

const as = (u: { userId: Id<"users"> }) => t.withIdentity({ subject: `${u.userId}|fakesession` });
beforeEach(async () => {
  t = makeT();
  F = await build(t);
});

const prod = (o: Record<string, unknown> = {}) => ({
  type: "STOCKABLE" as const, name: "Item", sku: "", barcode: "", extraBarcodes: [] as string[], brand: "", unit: "pcs",
  allowDecimal: false, costCents: 100, priceCents: 150, reorderLevel: 0, trackExpiry: false, ...o,
});
let n = 0;
const sale = (items: ReturnType<typeof li>[], total: number) => ({
  clientSaleId: `s${n++}`, items, orderDiscountCents: 0, payments: [{ method: "CASH" as const, amountCents: total }], createdAt: Date.now(),
});
const li = (productId: Id<"products">, qty: number, extra: object = {}) => ({ productId, qty, discountCents: 0, ...extra });
const get = <T extends "sales" | "products" | "serials" | "purchases">(id: Id<T>) => t.run((ctx) => ctx.db.get(id) as Promise<Doc<T>>);
const serialRow = (businessId: Id<"businesses">, serial: string) =>
  t.run((ctx) => ctx.db.query("serials").withIndex("by_business_and_serial", (q) => q.eq("businessId", businessId).eq("serial", serial)).first());

describe("business types", () => {
  it("onboarding with types seeds features, attributes, categories", async () => {
    const u = as({ userId: F.newUser });
    const id = await u.mutation(api.onboarding.createBusiness, {
      fullName: "Fresh", name: "Fresh Pharma", businessType: "Pharmacy", phone: "1", address: "a", city: "c", country: "SO", currency: "usd",
      businessTypes: ["pharmacy", "electronics"],
    });
    const b = await get(id as never as Id<"purchases">) as unknown as Doc<"businesses">;
    expect(b.businessTypes).toEqual(["pharmacy", "electronics"]);
    expect(b.features).toEqual(expect.arrayContaining(["units", "expiry", "attributes", "serials", "variants", "services"]));
    expect(b.attributeDefs?.map((d) => d.key)).toEqual(expect.arrayContaining(["generic", "model", "condition"]));
    const cats = await t.run((ctx) => ctx.db.query("categories").withIndex("by_business", (q) => q.eq("businessId", id)).collect());
    expect(cats.map((c) => c.name)).toEqual(expect.arrayContaining(["Antibiotics", "Phones"]));
    const me = await u.query(api.members.me, {});
    expect(me?.kind === "business" && me.business.features.includes("serials")).toBe(true);
  });

  it("empty types → general; unknown or >3 rejected", async () => {
    const mk = (businessTypes: string[]) =>
      as({ userId: F.newUser }).mutation(api.onboarding.createBusiness, {
        fullName: "F", name: "N", businessType: "x", phone: "1", address: "a", city: "c", country: "SO", currency: "USD", businessTypes,
      });
    expect(await code(mk(["nope"]))).toBe("UNKNOWN_BUSINESS_TYPE");
    expect(await code(mk(["general", "grocery", "pharmacy", "bakery"]))).toBe("UNKNOWN_BUSINESS_TYPE");
    expect(await code(mk([]))).toBe("OK");
    const b = await t.run((ctx) => ctx.db.query("businesses").withIndex("by_owner", (q) => q.eq("ownerUserId", F.newUser)).unique());
    expect(b?.businessTypes).toEqual(["general"]);
  });

  it("applyPreset unions features/attributes and seeds missing categories; updateFeatures validates", async () => {
    const A = as(F.A);
    await A.mutation(api.settings.applyPreset, { businessTypes: ["electronics", "auto_parts"] });
    const f = await A.query(api.settings.features, {});
    expect(f.businessTypes).toEqual(["pharmacy", "electronics", "auto_parts"]);
    expect(f.features).toEqual(expect.arrayContaining(["units", "attributes", "serials", "variants", "services"]));
    const keys = f.attributeDefs.map((d) => d.key);
    expect(keys).toEqual(expect.arrayContaining(["generic", "form", "model", "partNo"]));
    expect(keys.filter((k) => k === "condition")).toHaveLength(1);
    await A.mutation(api.settings.applyPreset, { businessTypes: ["electronics"] });
    const cats = await t.run((ctx) => ctx.db.query("categories").withIndex("by_business", (q) => q.eq("businessId", F.A.businessId)).collect());
    expect(cats.filter((c) => c.name === "Phones")).toHaveLength(1);
    expect(await code(A.mutation(api.settings.applyPreset, { businessTypes: ["zzz"] }))).toBe("UNKNOWN_BUSINESS_TYPE");
    const bad = (key: string) => A.mutation(api.settings.updateFeatures, { features: ["units"], attributeDefs: [{ key, label: "L", type: "text", searchable: false }] });
    expect(await code(bad("Bad key"))).toBe("INVALID_INPUT");
    expect(await code(bad("ok1"))).toBe("OK");
  });

  it("v2 business without features still works", async () => {
    const V = as(F.V2);
    const me = await V.query(api.members.me, {});
    expect(me?.kind === "business" && me.business.features.includes("expiry")).toBe(true);
    const pid = await V.mutation(api.products.create, prod({ openingStock: 5 }));
    const r = await V.mutation(api.sales.create, sale([li(pid, 2)], 300));
    expect((await get(r.saleId)).totalCents).toBe(300);
    expect((await get(pid)).stock).toBe(3);
    expect((await V.query(api.products.posCatalog, {}))[0].units).toEqual([]);
  });
});

describe("units (packs)", () => {
  const withCarton = (o: Record<string, unknown> = {}) =>
    prod({
      name: "Cola", barcode: "111", units: [{ name: "carton", factor: 24, barcode: "222" }, { name: "dozen", factor: 12, barcode: "", priceCents: 1500 }],
      openingStock: 100, ...o,
    });

  it("sale of cartons moves factor × qty; default vs override price; refund restocks base units", async () => {
    const A = as(F.A);
    const pid = await A.mutation(api.products.create, withCarton());
    const r = await A.mutation(api.sales.create, sale([li(pid, 2, { unitName: "carton" })], 7200)); // 2 × 24 × 150
    expect((await get(pid)).stock).toBe(52);
    const s = await get(r.saleId);
    expect(s.items[0]).toMatchObject({ qty: 2, priceCents: 3600, unitName: "carton", unitFactor: 24, costCents: 2400 });
    const r2 = await A.mutation(api.sales.create, sale([li(pid, 1, { unitName: "dozen" })], 1500)); // override price
    expect((await get(r2.saleId)).items[0].priceCents).toBe(1500);
    expect((await get(pid)).stock).toBe(40);
    // base unit line and carton line for the same product coexist
    await A.mutation(api.sales.create, sale([li(pid, 1), li(pid, 1, { unitName: "carton" })], 3750));
    expect((await get(pid)).stock).toBe(15);
    await A.mutation(api.sales.refund, { saleId: r.saleId, items: [{ productId: pid, qty: 1, restock: true, unitName: "carton" }], method: "CASH", reason: "dmg" });
    expect((await get(pid)).stock).toBe(39);
    expect(await code(A.mutation(api.sales.create, sale([li(pid, 1, { unitName: "crate" })], 150)))).toBe("INVALID_INPUT");
  });

  it("unit barcode lookup and uniqueness", async () => {
    const A = as(F.A);
    const pid = await A.mutation(api.products.create, withCarton());
    const hit = await A.query(api.products.lookupLocal, { code: "222" });
    expect(hit?.product._id).toBe(pid);
    expect(hit?.unit).toMatchObject({ name: "carton", factor: 24 });
    expect((await A.query(api.products.lookupLocal, { code: "111" }))?.unit).toBeUndefined();
    expect(await A.query(api.products.lookupLocal, { code: "nope" })).toBeNull();
    expect(await code(A.mutation(api.products.create, prod({ name: "X", barcode: "222" })))).toBe("BARCODE_EXISTS");
    expect(await code(A.mutation(api.products.create, prod({ name: "Y", units: [{ name: "box", factor: 6, barcode: "111" }] })))).toBe("UNIT_BARCODE_EXISTS");
    expect(await code(A.mutation(api.products.create, prod({ name: "Z", units: [{ name: "box", factor: 6, barcode: "222" }] })))).toBe("UNIT_BARCODE_EXISTS");
    // another business may reuse it; and cannot see A's
    expect(await code(as(F.B).mutation(api.products.create, prod({ name: "Z", barcode: "222" })))).toBe("OK");
    expect(await as(F.V2).query(api.products.lookupLocal, { code: "111" })).toBeNull();
  });

  it("purchase in cartons converts qty and per-base cost", async () => {
    const A = as(F.A);
    const pid = await A.mutation(api.products.create, withCarton({ openingStock: 0 }));
    const r = await A.mutation(api.purchases.create, {
      items: [{ productId: pid, qty: 3, unitCostCents: 2400, unitName: "carton" }], otherCostCents: 0, paidCents: 7200, paidMethod: "CASH", note: "",
    });
    const p = await get(r.purchaseId);
    expect(p.items[0]).toMatchObject({ qty: 72, unitCostCents: 100, unitName: "carton", unitQty: 3 });
    expect(p.totalCents).toBe(7200);
    const prodDoc = await get(pid);
    expect(prodDoc.stock).toBe(72);
    expect(prodDoc.costCents).toBe(100);
  });
});

describe("attributes", () => {
  it("only defined keys, select options, search by generic name", async () => {
    const A = as(F.A);
    const pid = await A.mutation(api.products.create, prod({ name: "Panadol", attrs: { generic: "paracetamol", form: "Tablet" } }));
    expect(await code(A.mutation(api.products.create, prod({ name: "Bad", attrs: { colour: "red" } })))).toBe("INVALID_INPUT");
    expect(await code(A.mutation(api.products.create, prod({ name: "Bad2", attrs: { form: "Gas" } })))).toBe("INVALID_INPUT");
    expect(await code(A.mutation(api.products.create, prod({ name: "Bad3", attrs: { generic: "x".repeat(201) } })))).toBe("INVALID_INPUT");
    const found = await A.query(api.products.list, { search: "paracetamol" });
    expect(found.map((p) => p._id)).toEqual([pid]);
    expect((await get(pid)).attrsText).toBe("paracetamol"); // only searchable attrs
    const cat = await A.query(api.products.posCatalog, {});
    expect(cat[0].attrs).toEqual({ generic: "paracetamol" });
    // update without attrs keeps them
    await A.mutation(api.products.update, { productId: pid, ...prod({ name: "Panadol 2" }) });
    expect((await get(pid)).attrs).toEqual({ generic: "paracetamol", form: "Tablet" });
    expect(await as(F.B).query(api.products.list, { search: "paracetamol" })).toHaveLength(0);
  });
});

describe("serials", () => {
  const phone = (o: Record<string, unknown> = {}) =>
    prod({ name: "Phone", trackSerial: true, warrantyMonths: 12, priceCents: 10000, costCents: 8000, ...o });

  it("receiving: count, Luhn and duplicates are enforced; opening serials", async () => {
    const A = as(F.A);
    expect(await code(A.mutation(api.products.create, phone({ openingStock: 2, openingSerials: [IMEI1] })))).toBe("SERIAL_REQUIRED");
    expect(await code(A.mutation(api.products.create, phone({ openingStock: 1, openingSerials: ["490154203237519"] })))).toBe("INVALID_SERIAL");
    expect(await code(A.mutation(api.products.create, phone({ allowDecimal: true })))).toBe("INVALID_INPUT");
    const pid = await A.mutation(api.products.create, phone({ openingStock: 1, openingSerials: [` ${IMEI3.toLowerCase()} `] }));
    expect((await serialRow(F.A.businessId, IMEI3))?.status).toBe("IN_STOCK");

    const buy = (serials: string[], qty = serials.length) =>
      A.mutation(api.purchases.create, { items: [{ productId: pid, qty, unitCostCents: 8000, serials }], otherCostCents: 0, paidCents: 8000 * qty, paidMethod: "CASH", note: "" });
    expect(await code(buy(["490154203237519", IMEI2]))).toBe("INVALID_SERIAL");
    expect(await code(buy([IMEI1], 2))).toBe("SERIAL_REQUIRED");
    expect(await code(buy([IMEI1, IMEI1]))).toBe("SERIAL_EXISTS");
    expect(await code(buy([IMEI3]))).toBe("SERIAL_EXISTS");
    expect((await get(pid)).stock).toBe(1); // nothing partially written
    await buy([IMEI1, IMEI2]);
    expect((await get(pid)).stock).toBe(3);
    const row = await serialRow(F.A.businessId, IMEI1);
    expect(row).toMatchObject({ status: "IN_STOCK", costCents: 8000 });
  });

  it("sell with serial → SOLD + warranty; bad/unknown/sold serials and qty mismatch rejected; refund restock", async () => {
    const A = as(F.A);
    const pid = await A.mutation(api.products.create, phone({ openingStock: 2, openingSerials: [IMEI1, IMEI2] }));
    expect(await code(A.mutation(api.sales.create, sale([li(pid, 1)], 10000)))).toBe("SERIAL_REQUIRED");
    expect(await code(A.mutation(api.sales.create, sale([li(pid, 2, { serials: [IMEI1] })], 20000)))).toBe("SERIAL_REQUIRED");
    expect(await code(A.mutation(api.sales.create, sale([li(pid, 1, { serials: [IMEI3] })], 10000)))).toBe("SERIAL_NOT_AVAILABLE");
    const r = await A.mutation(api.sales.create, sale([li(pid, 1, { serials: [IMEI1] })], 10000));
    const s = await get(r.saleId);
    const row = await serialRow(F.A.businessId, IMEI1);
    expect(row).toMatchObject({ status: "SOLD", saleId: r.saleId });
    expect(row?.warrantyUntil).toBeGreaterThan(Date.now() + 300 * DAY);
    expect(s.items[0].serials).toEqual([IMEI1]);
    expect(s.items[0].warrantyUntil).toBe(row?.warrantyUntil);
    expect((await get(pid)).stock).toBe(1);
    expect(await code(A.mutation(api.sales.create, sale([li(pid, 1, { serials: [IMEI1] })], 10000)))).toBe("SERIAL_NOT_AVAILABLE");

    // available picker only shows IN_STOCK
    const av = await as(F.A).query(api.serials.available, { productId: pid });
    expect(av.map((x) => x.serial)).toEqual([IMEI2]);

    await A.mutation(api.sales.refund, { saleId: r.saleId, items: [{ productId: pid, qty: 1, restock: true }], method: "CASH", reason: "back" });
    const back = await serialRow(F.A.businessId, IMEI1);
    expect(back?.status).toBe("IN_STOCK");
    expect(back?.saleId).toBeUndefined();
    expect(back?.warrantyUntil).toBeUndefined();
    expect((await get(pid)).stock).toBe(2);

    // refund without restock: RETURNED stays out of stock
    const r2 = await A.mutation(api.sales.create, sale([li(pid, 1, { serials: [IMEI2] })], 10000));
    await A.mutation(api.sales.refund, { saleId: r2.saleId, items: [{ productId: pid, qty: 1, restock: false }], method: "CASH", reason: "junk" });
    expect((await serialRow(F.A.businessId, IMEI2))?.status).toBe("RETURNED");
    expect((await get(pid)).stock).toBe(1);
  });

  it("lookup gives warranty status; writeOff removes from stock", async () => {
    const A = as(F.A);
    const pid = await A.mutation(api.products.create, phone({ openingStock: 2, openingSerials: [IMEI1, IMEI2] }));
    const cust = await t.run((ctx) =>
      ctx.db.insert("customers", {
        businessId: F.A.businessId, fullName: "Ali", phone: "5", whatsapp: "", type: "INDIVIDUAL", companyName: "", group: "RETAIL", address: "",
        district: "", notes: "", creditLimitCents: 0, creditBlocked: false, balanceCents: 0, createdAt: Date.now(),
      }),
    );
    const r = await A.mutation(api.sales.create, { ...sale([li(pid, 1, { serials: [IMEI1] })], 10000), customerId: cust });
    const l = await A.query(api.serials.lookup, { serial: ` ${IMEI1} ` });
    expect(l).toMatchObject({ warrantyStatus: "ACTIVE", customer: { fullName: "Ali" }, sale: { _id: r.saleId }, serial: { status: "SOLD" } });
    expect(l!.daysLeft).toBeGreaterThan(360);
    // expired warranty
    await t.run(async (ctx) => { const s = await ctx.db.query("serials").withIndex("by_business_and_serial", (q) => q.eq("businessId", F.A.businessId).eq("serial", IMEI1)).first(); await ctx.db.patch(s!._id, { warrantyUntil: Date.now() - DAY }); });
    expect((await A.query(api.serials.lookup, { serial: IMEI1 }))?.warrantyStatus).toBe("EXPIRED");
    expect((await A.query(api.serials.lookup, { serial: IMEI2 }))?.warrantyStatus).toBe("NONE");
    expect(await A.query(api.serials.lookup, { serial: "000" })).toBeNull();

    const sr = await serialRow(F.A.businessId, IMEI2);
    expect(await code(A.mutation(api.serials.writeOff, { serialId: sr!._id, reason: " " }))).toBe("REASON_REQUIRED");
    await A.mutation(api.serials.writeOff, { serialId: sr!._id, reason: "stolen" });
    expect((await serialRow(F.A.businessId, IMEI2))?.status).toBe("WRITTEN_OFF");
    expect((await get(pid)).stock).toBe(0);
    expect(await code(A.mutation(api.serials.writeOff, { serialId: sr!._id, reason: "again" }))).toBe("SERIAL_NOT_AVAILABLE");
    expect((await A.query(api.serials.list, { productId: pid, status: "SOLD" })).map((x) => x.serial)).toEqual([IMEI1]);
    expect((await A.query(api.serials.list, { search: "49015" })).map((x) => x.serial)).toEqual([IMEI1]);
  });

  it("cross-tenant: B cannot see or sell A's serials", async () => {
    const A = as(F.A), B = as(F.B);
    const pid = await A.mutation(api.products.create, phone({ openingStock: 1, openingSerials: [IMEI1] }));
    const bpid = await B.mutation(api.products.create, phone({ name: "BPhone", openingStock: 1, openingSerials: [IMEI2] }));
    expect(await B.query(api.serials.lookup, { serial: IMEI1 })).toBeNull();
    expect(await B.query(api.serials.list, { search: "49015" })).toEqual([]);
    expect(await code(B.query(api.serials.list, { productId: pid }))).toBe("NOT_FOUND");
    expect(await code(B.query(api.serials.available, { productId: pid }))).toBe("NOT_FOUND");
    expect(await code(B.mutation(api.sales.create, sale([li(pid, 1, { serials: [IMEI1] })], 10000)))).toBe("NOT_FOUND");
    expect(await code(B.mutation(api.sales.create, sale([li(bpid, 1, { serials: [IMEI1] })], 10000)))).toBe("SERIAL_NOT_AVAILABLE");
    const sr = await serialRow(F.A.businessId, IMEI1);
    expect(await code(B.mutation(api.serials.writeOff, { serialId: sr!._id, reason: "x" }))).toBe("NOT_FOUND");
    // the same IMEI can be registered by another business independently
    expect(await code(B.mutation(api.products.create, phone({ name: "P3", openingStock: 1, openingSerials: [IMEI1] })))).toBe("OK");
    expect((await serialRow(F.A.businessId, IMEI1))?.status).toBe("IN_STOCK");
  });
});
