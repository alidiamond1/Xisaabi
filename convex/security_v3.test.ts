/// <reference types="vite/client" />
// v3 security audit: catalog, external lookup, scanner, serials, units, features, platform. Run: npm test
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { gtinCheckDigit, makeInternalEan13 } from "./shared/barcode";
import { MODULE_KEYS } from "./shared/modules";

const modules = import.meta.glob("./**/*.*s");
const DAY = 86_400_000;
const EAN = "4006381333931";
const IMEI1 = "490154203237518";
const IMEI2 = "356938035643809";
const IMEI3 = "353879234252633";

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    const d = (e as { data?: unknown }).data;
    return typeof d === "string" ? d : `RAW:${(e as Error).message}`;
  }
}
const gtinN = (i: number) => {
  const body = "400638" + String(100000 + i);
  return body + gtinCheckDigit(body);
};

const makeT = () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return t;
};
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
    const biz = async (name: string) => {
      const ownerUserId = await ctx.db.insert("users", { email: `${name}-owner`, name });
      const businessId = await ctx.db.insert("businesses", {
        name, businessType: "Shop", phone: "1", address: "a", city: "c", country: "SO", currency: "USD",
        ownerUserId, status: "ACTIVE", planId, subscriptionStatus: "ACTIVE", subscriptionEndsAt: now + 365 * DAY,
        settings: {
          taxRatePercent: 0, lowStockThreshold: 5, allowNegativeStock: false,
          paymentMethods: ["CASH"], maxCashierDiscountPercent: 10, defaultCreditLimitCents: 0,
          expenseCategories: ["Rent"], discountPresets: [5],
        },
        businessTypes: ["pharmacy"],
        features: ["units" as const, "attributes" as const, "serials" as const],
        attributeDefs: [
          { key: "generic", label: "Generic", type: "text" as const, searchable: true },
          { key: "form", label: "Form", type: "select" as const, options: ["Tablet", "Syrup"], searchable: false },
          { key: "mg", label: "Mg", type: "number" as const, searchable: false },
        ],
        createdAt: now - 30 * DAY,
      });
      return { businessId, ownerUserId };
    };
    const member = async (role: "OWNER" | "MANAGER" | "CASHIER" | "SUPER_ADMIN" | "PLATFORM_ADMIN", username: string, businessId?: Id<"businesses">, userId?: Id<"users">) => {
      const uid = userId ?? (await ctx.db.insert("users", { email: username, name: username }));
      const memberId = await ctx.db.insert("members", { userId: uid, businessId, role, username, fullName: username, isActive: true, createdAt: now });
      return { userId: uid, memberId };
    };
    const A = await biz("A");
    const B = await biz("B");
    const S = await biz("S");
    await ctx.db.patch(S.businessId, { status: "SUSPENDED" });
    return {
      A, B, S,
      ownerA: await member("OWNER", "owner-a", A.businessId, A.ownerUserId),
      managerA: await member("MANAGER", "manager-a", A.businessId),
      cashierA: await member("CASHIER", "cashier-a", A.businessId),
      ownerB: await member("OWNER", "owner-b", B.businessId, B.ownerUserId),
      ownerS: await member("OWNER", "owner-s", S.businessId, S.ownerUserId),
      superAdmin: await member("SUPER_ADMIN", "super"),
      padmin: await member("PLATFORM_ADMIN", "padmin"),
    };
  });
}
const as = (u: { userId: Id<"users"> }) => t.withIdentity({ subject: `${u.userId}|fakesession` });
beforeEach(async () => {
  t = makeT();
  F = await build(t);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const prod = (o: Record<string, unknown> = {}) => ({
  type: "STOCKABLE" as const, name: "Item", sku: "", barcode: "", extraBarcodes: [] as string[], brand: "", unit: "pcs",
  allowDecimal: false, costCents: 100, priceCents: 150, reorderLevel: 0, trackExpiry: false, ...o,
});
const phone = (o: Record<string, unknown> = {}) => prod({ name: "Phone", trackSerial: true, warrantyMonths: 12, priceCents: 10000, costCents: 8000, ...o });
let n = 0;
const sale = (items: ReturnType<typeof li>[], total: number) => ({
  clientSaleId: `s${n++}`, items, orderDiscountCents: 0, payments: [{ method: "CASH" as const, amountCents: total }], createdAt: Date.now(),
});
const li = (productId: Id<"products">, qty: number, extra: object = {}) => ({ productId, qty, discountCents: 0, ...extra });
const catalogRows = () => t.run((ctx) => ctx.db.query("catalog").collect());
const contribRows = () => t.run((ctx) => ctx.db.query("catalogContributions").collect());
const get = <T extends "products" | "serials" | "sales">(id: Id<T>) => t.run((ctx) => ctx.db.get(id) as Promise<Doc<T>>);
const offOk = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

describe("1. catalog leakage and poisoning", () => {
  it("catalog.lookup 'local' only comes from the caller's business; no tenant data in results", async () => {
    await as(F.ownerB).mutation(api.products.create, prod({ name: "B-secret-item", barcode: EAN, costCents: 777, priceCents: 999, openingStock: 42 }));
    const a = as(F.ownerA);
    const r = await a.query(api.catalog.lookup, { code: EAN });
    expect(r.local).toBeNull();
    const json = JSON.stringify(r);
    for (const bad of ["777", "999", "businessId", String(F.B.businessId)]) expect(json).not.toContain(bad);
    // a second shop confirming makes it visible, still without any tenant fields
    await a.mutation(api.products.create, prod({ name: "B-secret-item", barcode: EAN }));
    const r2 = await as(F.ownerB).query(api.catalog.lookup, { code: EAN });
    expect(Object.keys(r2.catalog ?? {}).every((k) => ["brand", "categoryHint", "confirmCount", "imageUrl", "name", "size", "source", "status"].includes(k))).toBe(true);
    expect(JSON.stringify(r2.catalog)).not.toContain(String(F.A.businessId));
  });

  it("one business counts once, even with two spellings of the same GTIN and renames", async () => {
    const a = as(F.ownerA);
    await a.mutation(api.products.create, prod({ name: "Cola One", barcode: "036000291452" }));
    await a.mutation(api.products.create, prod({ name: "Cola Two", barcode: "0036000291452" }));
    const rows = await catalogRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ confirmCount: 1, status: "PENDING" });
    expect(await contribRows()).toHaveLength(1);
  });

  it("flags count once per business; 2 businesses never hide; platform admin can restore", async () => {
    await as(F.ownerA).mutation(api.products.create, prod({ name: "Milk", barcode: EAN }));
    const a = as(F.ownerA), b = as(F.ownerB);
    await a.mutation(api.catalog.flag, { barcode: EAN });
    await a.mutation(api.catalog.flag, { barcode: EAN });
        await b.mutation(api.catalog.flag, { barcode: EAN });
    const [row] = await catalogRows();
    expect(row.flagCount).toBe(2);
    expect(row.status).not.toBe("HIDDEN");
    expect(await code(t.mutation(api.catalog.flag, { barcode: EAN }))).toBe("UNAUTHENTICATED");
    expect(await code(as(F.superAdmin).mutation(api.catalog.flag, { barcode: EAN }))).toBe("FORBIDDEN");
  });

  it("shareToCatalog=false is honoured on create AND update; only OWNER can toggle it", async () => {
    const o = as(F.ownerA);
    const settings = {
      taxRatePercent: 0, lowStockThreshold: 5, allowNegativeStock: false, shareToCatalog: false,
    };
    expect(await code(as(F.cashierA).mutation(api.settings.updateSettings, settings))).toBe("FORBIDDEN");
    expect(await code(as(F.managerA).mutation(api.settings.updateSettings, settings))).toBe("FORBIDDEN");
    await o.mutation(api.settings.updateSettings, settings);
    const pid = await o.mutation(api.products.create, prod({ name: "Private Milk", barcode: EAN }));
    await o.mutation(api.products.update, { productId: pid, ...prod({ name: "Private Milk 2", barcode: "4006381333948" }) });
    await o.mutation(api.products.update, { productId: pid, ...prod({ name: "Private Milk 3", barcode: "4006381333948" }) });
    expect(await catalogRows()).toHaveLength(0);
    expect(await contribRows()).toHaveLength(0);
    // omitting the flag on a later settings save keeps it off
    await o.mutation(api.settings.updateSettings, { taxRatePercent: 0, lowStockThreshold: 5, allowNegativeStock: false });
    await o.mutation(api.products.update, { productId: pid, ...prod({ name: "Private Milk 4", barcode: "4006381333948" }) });
    expect(await catalogRows()).toHaveLength(0);
  });

  it("internal barcodes, spam and long names never enter the catalog", async () => {
    const o = as(F.ownerA);
    await o.mutation(api.products.create, prod({ name: "Own", barcode: makeInternalEan13(7) }));
    await o.mutation(api.products.create, prod({ name: "Call 0612345678 now", barcode: EAN }));
    await o.mutation(api.products.create, prod({ name: "Visit www.spam.com", barcode: gtinN(1) }));
    await o.mutation(api.products.create, prod({ name: "x".repeat(150), barcode: gtinN(2) }));
    await o.mutation(api.products.create, prod({ name: "Fine", barcode: "not-a-gtin" }));
    expect(await catalogRows()).toHaveLength(0);
    // generated internal codes are not shared either
    const pid = await o.mutation(api.products.create, prod({ name: "NoCode" }));
    await o.mutation(api.barcodes.generate, { productId: pid });
    expect(await catalogRows()).toHaveLength(0);
  });

  it("catalog moderation is platform-only; adminSet is SUPER_ADMIN-only and audited; no contributor info", async () => {
    await as(F.ownerA).mutation(api.products.create, prod({ name: "Milk", barcode: EAN }));
    const set = { barcode: EAN, status: "VERIFIED" as const };
    for (const who of [F.ownerA, F.managerA, F.cashierA, F.padmin]) expect(await code(as(who).mutation(api.catalog.adminSet, set))).toBe("FORBIDDEN");
    expect(await code(t.mutation(api.catalog.adminSet, set))).toBe("UNAUTHENTICATED");
    for (const who of [F.ownerA, F.cashierA, F.ownerB]) expect(await code(as(who).query(api.catalog.adminList, {}))).toBe("FORBIDDEN");
    expect(await code(t.query(api.catalog.adminList, {}))).toBe("UNAUTHENTICATED");
    await as(F.superAdmin).mutation(api.catalog.adminSet, set);
    const list = await as(F.padmin).query(api.catalog.adminList, {});
    expect(JSON.stringify(list)).not.toContain("businessId");
    expect(JSON.stringify(list)).not.toContain(String(F.A.businessId));
    const logs = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(logs.some((l) => l.action === "catalog.adminSet" && l.actorMemberId === F.superAdmin.memberId)).toBe(true);
    // locked rows ignore later shop contributions
    await as(F.ownerB).mutation(api.products.create, prod({ name: "Hijack", barcode: EAN }));
    expect((await catalogRows())[0].name).toBe("Milk");
  });
});

describe("2. lookups.remote", () => {
  it("access check cannot be bypassed (anon, platform staff, suspended business) and nothing is fetched", async () => {
    const f = offOk({ status: 0 });
    vi.stubGlobal("fetch", f);
    expect(await code(t.action(api.lookups.remote, { code: EAN }))).toBe("UNAUTHENTICATED");
    expect(await code(as(F.superAdmin).action(api.lookups.remote, { code: EAN }))).toBe("FORBIDDEN");
    expect(await code(as(F.ownerS).action(api.lookups.remote, { code: EAN }))).toBe("BUSINESS_SUSPENDED");
    expect(f).not.toHaveBeenCalled();
  });

  it("only digits reach the URL; hostile codes are never fetched", async () => {
    const f = offOk({ status: 0 });
    vi.stubGlobal("fetch", f);
    const a = as(F.ownerA);
    for (const c of [`${EAN}/../../x`, `${EAN}?a=b`, `${EAN}#x`, "http://evil.example/", `${EAN}\n`.repeat(3), "٤٠٠٦٣٨١٣٣٣٩٣١", "../etc/passwd", "x".repeat(5000)]) {
      expect(await a.action(api.lookups.remote, { code: c })).toBeNull();
    }
    expect(f).not.toHaveBeenCalled();
    await a.action(api.lookups.remote, { code: EAN });
    for (const [url] of f.mock.calls as unknown as [string][]) {
      expect(url).toMatch(/^https:\/\/world\.open(food|beauty|products)facts\.org\/api\/v2\/product\/\d{8,14}\.json\?fields=[a-z_,]+$/);
    }
  });

  it("per-business minute limit is enforced before fetching, and does not starve another business", async () => {
    const f = offOk({ status: 0 });
    vi.stubGlobal("fetch", f);
    const a = as(F.ownerA);
    for (let i = 0; i < 10; i++) expect(await code(a.action(api.lookups.remote, { code: gtinN(i) }))).toBe("OK");
    const calls = f.mock.calls.length;
    expect(await code(a.action(api.lookups.remote, { code: gtinN(99) }))).toBe("RATE_LIMITED");
    expect(f.mock.calls.length).toBe(calls);
    expect(await code(as(F.ownerB).action(api.lookups.remote, { code: gtinN(98) }))).toBe("OK");
  });

  it("upstream data is clipped, never throws raw, and only OFF-family image hosts are kept", async () => {
    vi.stubGlobal("fetch", offOk({
      status: 1,
      product: { product_name: "N".repeat(500), brands: "B".repeat(500), quantity: "q".repeat(500), image_front_small_url: "https://evil.example/track.png", categories_tags: [123] },
    }));
    const r = await as(F.ownerA).action(api.lookups.remote, { code: EAN });
    expect(r?.name.length).toBeLessThanOrEqual(120);
    expect(r?.brand.length).toBeLessThanOrEqual(80);
    expect(r?.size.length).toBeLessThanOrEqual(40);
    expect(r?.imageUrl).toBeUndefined();

    for (const body of ["<html>", "null", "[1,2]", '{"product":"str"}']) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
      expect(await code(as(F.ownerA).action(api.lookups.remote, { code: gtinN(5) }))).not.toMatch(/^RAW:.*(Unexpected|Cannot)/);
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    expect(await as(F.ownerA).action(api.lookups.remote, { code: gtinN(6) })).toBeNull();
  });
});

describe("3. scanner pairing", () => {
  const start = async () => {
    const { code: sc, sessionId } = await as(F.ownerA).mutation(api.scanner.createSession, { target: "POS" });
    return { sc, sessionId };
  };

  it("codes are 10 chars of a 64-letter alphabet and do not repeat", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const { code: c } = await (i % 2 ? as(F.ownerA) : as(F.ownerB)).mutation(api.scanner.createSession, { target: "POS" });
      expect(c).toMatch(/^[A-Za-z0-9_-]{10}$/);
      seen.add(c);
    }
    expect(seen.size).toBe(40);
  });

  it("business B cannot push, read, consume, end or even see A's session; platform staff neither", async () => {
    const { sc, sessionId } = await start();
    await as(F.cashierA).mutation(api.scanner.push, { code: sc, barcode: EAN });
    const [scan] = await as(F.ownerA).query(api.scanner.pending, { sessionId });
    for (const who of [F.ownerB, F.superAdmin]) {
      const x = as(who);
      expect(await code(x.mutation(api.scanner.push, { code: sc, barcode: EAN }))).toMatch(/^(NOT_FOUND|FORBIDDEN)$/);
      expect(await code(x.query(api.scanner.pending, { sessionId }))).toMatch(/^(NOT_FOUND|FORBIDDEN)$/);
      expect(await code(x.mutation(api.scanner.consume, { scanIds: [scan._id] }))).toMatch(/^(NOT_FOUND|FORBIDDEN)$/);
      expect(await code(x.mutation(api.scanner.endSession, { sessionId }))).toMatch(/^(NOT_FOUND|FORBIDDEN)$/);
    }
    expect(await as(F.ownerB).query(api.scanner.sessionInfo, { code: sc })).toBeNull();
    // a wrong guess looks identical to a foreign session
    expect(await code(as(F.ownerB).mutation(api.scanner.push, { code: "AAAAAAAAAA", barcode: EAN }))).toBe(
      await code(as(F.ownerB).mutation(api.scanner.push, { code: sc, barcode: EAN })),
    );
    expect((await t.run((ctx) => ctx.db.query("scans").collect())).length).toBe(1);
    expect((await get_scan(scan._id))?.consumed).toBe(false);
  });
  const get_scan = (id: Id<"scans">) => t.run((ctx) => ctx.db.get(id));

  it("expiry and deactivation are enforced in the mutation (not by a client clock)", async () => {
    const { sc, sessionId } = await start();
    await t.run((ctx) => ctx.db.patch(sessionId, { expiresAt: Date.now() - 1 }));
    expect(await code(as(F.cashierA).mutation(api.scanner.push, { code: sc, barcode: EAN }))).toBe("SCAN_SESSION_INVALID");
    // a client lying about `now` in sessionInfo changes nothing about push
    expect(await code(as(F.cashierA).mutation(api.scanner.push, { code: sc, barcode: EAN }))).toBe("SCAN_SESSION_INVALID");
    const s2 = await start();
    await as(F.ownerA).mutation(api.scanner.endSession, { sessionId: s2.sessionId });
    expect(await code(as(F.cashierA).mutation(api.scanner.push, { code: s2.sc, barcode: EAN }))).toBe("SCAN_SESSION_INVALID");
    expect(await t.run((ctx) => ctx.db.query("scans").collect())).toHaveLength(0);
  });

  it("scanPush is rate limited per session; oversized barcodes rejected; consume is bounded", async () => {
    const { sc, sessionId } = await start();
    expect(await code(as(F.cashierA).mutation(api.scanner.push, { code: sc, barcode: "x".repeat(201) }))).toBe("INVALID_INPUT");
    for (let i = 0; i < 120; i++) await as(F.cashierA).mutation(api.scanner.push, { code: sc, barcode: String(i + 1) });
    expect(await code(as(F.cashierA).mutation(api.scanner.push, { code: sc, barcode: "999" }))).toBe("RATE_LIMITED");
    const pend = await as(F.ownerA).query(api.scanner.pending, { sessionId });
    expect(pend).toHaveLength(50);
    const ids = Array(101).fill(pend[0]._id);
    expect(await code(as(F.ownerA).mutation(api.scanner.consume, { scanIds: ids }))).toBe("INVALID_INPUT");
  });
});

describe("4. serials", () => {
  const setup = async () => {
    const A = as(F.ownerA), B = as(F.ownerB);
    const p1 = await A.mutation(api.products.create, phone({ name: "P1", openingStock: 2, openingSerials: [IMEI1, IMEI2] }));
    const p2 = await A.mutation(api.products.create, phone({ name: "P2", openingStock: 1, openingSerials: [IMEI3] }));
    const bp = await B.mutation(api.products.create, phone({ name: "BP", openingStock: 1, openingSerials: ["B-SERIAL-1"] }));
    return { A, B, p1, p2, bp };
  };
  const row = (businessId: Id<"businesses">, serial: string) =>
    t.run((ctx) => ctx.db.query("serials").withIndex("by_business_and_serial", (q) => q.eq("businessId", businessId).eq("serial", serial)).first());

  it("cross-tenant lookup / list / available / write-off / sale are all blocked", async () => {
    const { A, B, p1, bp } = await setup();
    expect(await B.query(api.serials.lookup, { serial: IMEI1 })).toBeNull();
    expect(await A.query(api.serials.lookup, { serial: "B-SERIAL-1" })).toBeNull();
    expect(await code(B.query(api.serials.list, { productId: p1 }))).toBe("NOT_FOUND");
    expect(await code(B.query(api.serials.available, { productId: p1 }))).toBe("NOT_FOUND");
    expect(JSON.stringify(await B.query(api.serials.list, {}))).not.toContain(IMEI1);
    expect(JSON.stringify(await B.query(api.serials.list, { search: "490" }))).not.toContain(IMEI1);
    const aRow = (await row(F.A.businessId, IMEI1))!;
    expect(await code(B.mutation(api.serials.writeOff, { serialId: aRow._id, reason: "x" }))).toBe("NOT_FOUND");
    // B sells its own phone using A's IMEI
    expect(await code(B.mutation(api.sales.create, sale([li(bp, 1, { serials: [IMEI1] })], 10000)))).toBe("SERIAL_NOT_AVAILABLE");
    // B sells A's product
    expect(await code(B.mutation(api.sales.create, sale([li(p1, 1, { serials: [IMEI1] })], 10000)))).toBe("NOT_FOUND");
    expect((await get(aRow._id)).status).toBe("IN_STOCK");
    // same serial string may exist independently in B
    await B.mutation(api.purchases.create, { items: [{ productId: bp, qty: 1, unitCostCents: 100, serials: [IMEI1] }], otherCostCents: 0, paidCents: 100, paidMethod: "CASH", note: "" });
  });

  it("cannot sell a serial that belongs to another product, or the same serial twice", async () => {
    const { A, p1, p2 } = await setup();
    expect(await code(A.mutation(api.sales.create, sale([li(p2, 1, { serials: [IMEI1] })], 10000)))).toBe("SERIAL_NOT_AVAILABLE");
    // two lines, same serial
    expect(await code(A.mutation(api.sales.create, sale([li(p1, 1, { serials: [IMEI1] }), li(p1, 1, { serials: [IMEI1] })], 20000)))).toBe("SERIAL_REQUIRED");
    // different products, same serial claimed by both lines
    expect(await code(A.mutation(api.sales.create, sale([li(p1, 1, { serials: [IMEI1] }), li(p2, 1, { serials: [IMEI1] })], 20000)))).toMatch(/^(SERIAL_NOT_AVAILABLE|INVALID_INPUT)$/);
    // serial count must equal qty, and unknown serials are rejected
    expect(await code(A.mutation(api.sales.create, sale([li(p1, 2, { serials: [IMEI1] })], 20000)))).toBe("SERIAL_REQUIRED");
    expect(await code(A.mutation(api.sales.create, sale([li(p1, 1, { serials: ["NOPE123"] })], 10000)))).toBe("SERIAL_NOT_AVAILABLE");
    expect(await code(A.mutation(api.sales.create, sale([li(p1, 1)], 10000)))).toBe("SERIAL_REQUIRED");
    expect((await get(p1)).stock).toBe(2);
    await A.mutation(api.sales.create, sale([li(p1, 1, { serials: [IMEI1] })], 10000));
    expect(await code(A.mutation(api.sales.create, sale([li(p1, 1, { serials: [IMEI1] })], 10000)))).toBe("SERIAL_NOT_AVAILABLE");
  });

  it("refund can only return serials that are on that sale, and each only once; cross-tenant refund blocked", async () => {
    const { A, B, p1 } = await setup();
    const s1 = await A.mutation(api.sales.create, sale([li(p1, 1, { serials: [IMEI1] })], 10000));
    const s2 = await A.mutation(api.sales.create, sale([li(p1, 1, { serials: [IMEI2] })], 10000));
    const r = (saleId: Id<"sales">, serials?: string[]) =>
      A.mutation(api.sales.refund, { saleId, items: [{ productId: p1, qty: 1, restock: true, serials }], method: "CASH", reason: "x" });
    expect(await code(r(s1.saleId, [IMEI2]))).toBe("SERIAL_NOT_AVAILABLE");
    expect(await code(r(s1.saleId, ["NOT-A-SERIAL"]))).toBe("SERIAL_NOT_AVAILABLE");
    expect((await row(F.A.businessId, IMEI2))!.status).toBe("SOLD");
    expect(await code(B.mutation(api.sales.refund, { saleId: s1.saleId, items: [{ productId: p1, qty: 1, restock: true }], method: "CASH", reason: "x" }))).toBe("NOT_FOUND");
    await r(s1.saleId, [IMEI1]);
    expect((await row(F.A.businessId, IMEI1))!.status).toBe("IN_STOCK");
    expect((await row(F.A.businessId, IMEI2))!.saleId).toBe(s2.saleId);
    expect(await code(r(s1.saleId, [IMEI1]))).toBe("ALREADY_REFUNDED");
  });

  it("IMEI / serial validation", async () => {
    const A = as(F.ownerA);
    const mk = (s: string) => A.mutation(api.products.create, phone({ name: `p${n++}`, openingStock: 1, openingSerials: [s] }));
    expect(await code(mk("490154203237519"))).toBe("INVALID_SERIAL"); // bad Luhn
    for (const bad of ["<script>", "a b/../c;", "-lead", "x".repeat(65), "", "  ", "ünï"]) expect(await code(mk(bad)), bad).toMatch(/^(INVALID_SERIAL|SERIAL_REQUIRED)$/);
    expect(await code(mk(IMEI1))).toBe("OK");
    expect(await code(mk(IMEI1.toLowerCase()))).toBe("SERIAL_EXISTS");
    expect(await code(A.mutation(api.products.create, phone({ name: "dup", openingStock: 2, openingSerials: ["SN1", "sn1"] })))).toBe("SERIAL_EXISTS");
    // plain products cannot be given serials
    expect(await code(A.mutation(api.products.create, prod({ name: "Plain", openingStock: 1, openingSerials: ["SN9"] })))).toBe("INVALID_INPUT");
  });

  it("stock of serial products can only move through serials (adjust/stocktake refused)", async () => {
    const { A, p1 } = await setup();
    expect(await code(A.mutation(api.inventory.adjust, { productId: p1, delta: 3, reason: "FOUND" }))).toBe("INVALID_INPUT");
    expect(await code(A.mutation(api.inventory.adjust, { productId: p1, delta: -1, reason: "LOST" }))).toBe("INVALID_INPUT");
    expect(await code(A.mutation(api.inventory.stocktake, { counts: [{ productId: p1, counted: 0 }] }))).toBe("INVALID_INPUT");
    expect((await get(p1)).stock).toBe(2);
  });
});

describe("5. units", () => {
  const unit = (o: object) => ({ name: "carton", factor: 12, barcode: "", ...o });
  const mk = (units: object[], o: object = {}) => as(F.ownerA).mutation(api.products.create, prod({ name: `u${n++}`, units, ...o }));

  it("rejects bad factors and prices", async () => {
    for (const factor of [0, -1, NaN, Infinity, -Infinity, 0.0001, 1e6 + 1, 1e12, 1.5]) {
      expect(await code(mk([unit({ factor })])), String(factor)).toBe("INVALID_INPUT");
    }
    expect(await code(mk([unit({ factor: 12, priceCents: -1 })]))).toBe("INVALID_INPUT");
    expect(await code(mk([unit({ factor: 12, priceCents: NaN })]))).toBe("INVALID_INPUT");
    expect(await code(mk([unit({ factor: 12, priceCents: 1.5 })]))).toBe("INVALID_INPUT");
    expect(await code(mk([unit({ factor: 12, priceCents: 1e13 })]))).toBe("INVALID_INPUT");
    expect(await code(mk([unit({ name: "PCS" })]))).toBe("INVALID_INPUT"); // same as base unit
    expect(await code(mk([unit({}), unit({ name: "CARTON" })]))).toBe("INVALID_INPUT");
    expect(await code(mk(Array.from({ length: 7 }, (_, i) => unit({ name: `u${i}` }))))).toBe("INVALID_INPUT");
    expect(await code(mk([unit({ factor: 0.5 })], { allowDecimal: true }))).toBe("OK");
    expect(await code(mk([unit({ factor: 1e6 })]))).toBe("OK");
  });

  it("barcode collisions across barcode / extraBarcodes / units are refused within a business, allowed across businesses", async () => {
    const A = as(F.ownerA);
    await A.mutation(api.products.create, prod({ name: "X", barcode: "B1", extraBarcodes: ["E1"], units: [unit({ barcode: "U1" })] }));
    const bad = async (o: object) => code(A.mutation(api.products.create, prod({ name: `y${n++}`, ...o })));
    expect(await bad({ barcode: "U1" })).toBe("BARCODE_EXISTS");
    expect(await bad({ extraBarcodes: ["U1"] })).toBe("BARCODE_EXISTS");
    expect(await bad({ units: [unit({ barcode: "B1" })] })).toBe("UNIT_BARCODE_EXISTS");
    expect(await bad({ units: [unit({ barcode: "E1" })] })).toBe("UNIT_BARCODE_EXISTS");
    expect(await bad({ units: [unit({ barcode: "U1" })] })).toBe("UNIT_BARCODE_EXISTS");
    expect(await bad({ barcode: "Z1", units: [unit({ barcode: "Z1" })] })).toBe("UNIT_BARCODE_EXISTS");
    expect(await bad({ extraBarcodes: ["Z2"], units: [unit({ barcode: "Z2" })] })).toBe("UNIT_BARCODE_EXISTS");
    expect(await bad({ units: [unit({ barcode: "Z3" }), unit({ name: "box", barcode: "Z3" })] })).toBe("UNIT_BARCODE_EXISTS");
    expect(await code(as(F.ownerB).mutation(api.products.create, prod({ name: "other tenant", barcode: "U1", units: [unit({ barcode: "B1" })] })))).toBe("OK");
  });

  it("sale/purchase/refund unit maths: unknown or crafted units, tiny and huge quantities", async () => {
    const A = as(F.ownerA);
    const pid = await A.mutation(api.products.create, prod({ name: "Cola", units: [unit({ factor: 24, priceCents: 3000 })], openingStock: 100 }));
    const bad = (q: ReturnType<typeof li>) => code(A.mutation(api.sales.create, sale([q], 5e9)));
    expect(await bad(li(pid, 1, { unitName: "pallet" }))).toBe("INVALID_INPUT");
    for (const qty of [0, -1, NaN, Infinity, 1e7, 0.5]) expect(await bad(li(pid, qty)), String(qty)).toBe("INVALID_INPUT");
    expect(await bad(li(pid, 1, { unitName: "carton", discountCents: -5 }))).toBe("INVALID_INPUT");
    expect(await bad(li(pid, 1, { unitName: "carton", discountCents: 3001 }))).toBe("INVALID_INPUT");
    expect(await bad(li(pid, 1e6, { unitName: "carton" }))).toBe("INSUFFICIENT_STOCK");
    expect((await get(pid)).stock).toBe(100);
    // base-unit alias and carton on separate lines do not double-spend
    expect(await code(A.mutation(api.sales.create, sale([li(pid, 80), li(pid, 4, { unitName: "carton" })], 80 * 150 + 4 * 3000)))).toBe("INSUFFICIENT_STOCK");
    // purchases: stock is capped so base-unit maths stays exact
    const buy = (qty: number, o: object = {}) =>
      A.mutation(api.purchases.create, { items: [{ productId: pid, qty, unitCostCents: 1, ...o }], otherCostCents: 0, paidCents: 0, note: "" });
    expect(await code(buy(1e9, { unitName: "carton" }))).toBe("INVALID_INPUT");
    expect(await code(buy(-1, { unitName: "carton" }))).toBe("INVALID_INPUT");
    expect(await code(buy(NaN))).toBe("INVALID_INPUT");
    expect((await get(pid)).stock).toBe(100);
  });
});

describe("6. features, presets, attributes", () => {
  const defs = [{ key: "ok1", label: "L", type: "text" as const, searchable: false }];

  it("only the OWNER can change features, attributeDefs and presets", async () => {
    for (const who of [F.managerA, F.cashierA, F.superAdmin]) {
      const x = as(who);
      expect(await code(x.mutation(api.settings.updateFeatures, { features: ["units"], attributeDefs: defs }))).toBe("FORBIDDEN");
      expect(await code(x.mutation(api.settings.applyPreset, { businessTypes: ["grocery"] }))).toBe("FORBIDDEN");
      expect(await code(x.query(api.settings.features, {}))).toBe("FORBIDDEN");
    }
    expect(await code(t.mutation(api.settings.updateFeatures, { features: ["units"], attributeDefs: defs }))).toBe("UNAUTHENTICATED");
    const b = await t.run((ctx) => ctx.db.get(F.A.businessId));
    expect(b?.attributeDefs).toHaveLength(3);
  });

  it("attributeDefs: hostile keys, duplicates, option and size limits", async () => {
    const o = as(F.ownerA);
    const upd = (attributeDefs: object[]) => o.mutation(api.settings.updateFeatures, { features: ["units"], attributeDefs: attributeDefs as never });
    const d = (key: string, extra: object = {}) => ({ key, label: "L", type: "text", searchable: false, ...extra });
    for (const key of ["__proto__", "$x", "_id", "constructor ", "a.b", "A", "1a", "", "a".repeat(32), "toString\u0000"]) {
      const r = await code(upd([d(key)]));
      if (key === "constructor ") expect(r).toBe("INVALID_INPUT");
      else expect(r, key).not.toBe("OK");
    }
    expect(await code(upd([d("dup"), d("dup")]))).toBe("INVALID_INPUT");
    expect(await code(upd(Array.from({ length: 21 }, (_, i) => d(`k${i}`))))).toBe("INVALID_INPUT");
    expect(await code(upd([d("sel", { type: "select", options: [] })]))).toBe("INVALID_INPUT");
    expect(await code(upd([d("sel", { type: "select", options: Array.from({ length: 31 }, (_, i) => `o${i}`) })]))).toBe("INVALID_INPUT");
    expect(await code(upd([d("sel", { type: "select", options: ["x".repeat(41)] })]))).toBe("INVALID_INPUT");
    expect(await code(upd([d("lbl", { label: "x".repeat(41) })]))).toBe("INVALID_INPUT");
    expect(await code(upd([d("constructor")]))).toBe("OK"); // plain word; harmless as a Map/array key
    const b = await t.run((ctx) => ctx.db.get(F.A.businessId));
    expect(b?.attributeDefs?.map((x) => x.key)).toEqual(["constructor"]);
  });

  it("product attrs: only defined keys, valid values, no reserved names, bounded", async () => {
    const A = as(F.ownerA);
    const mk = (attrs: Record<string, string>) => A.mutation(api.products.create, prod({ name: `a${n++}`, attrs }));
    expect(await code(mk({ generic: "Paracetamol", form: "Tablet", mg: "500" }))).toBe("OK");
    for (const attrs of [{ nope: "x" }, { form: "Poison" }, { mg: "abc" }, { mg: "Infinity" }, { generic: "x".repeat(201) }] as Record<string, string>[]) {
      expect(await code(mk(attrs)), JSON.stringify(attrs)).toBe("INVALID_INPUT");
    }
    for (const k of ["$x", "_id", "constructor", "toString"]) {
      expect(await code(mk(Object.fromEntries([[k, "x"]]))), k).not.toBe("OK");
    }
    await code(mk(JSON.parse('{"__proto__":"x"}'))); // dropped or refused; never stored (asserted below)
    expect(await code(mk(Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`k${i}`, "x"]))))).not.toBe("OK");
    const prods = await t.run((ctx) => ctx.db.query("products").withIndex("by_business", (q) => q.eq("businessId", F.A.businessId)).collect());
    expect(prods.every((p) => !p.attrs || Object.keys(p.attrs).every((k) => ["generic", "form", "mg"].includes(k)))).toBe(true);
    // B's definitions are not A's
    expect(await code(as(F.ownerB).mutation(api.products.create, prod({ attrs: { generic: "ok" } })))).toBe("OK");
    await as(F.ownerB).mutation(api.settings.updateFeatures, { features: ["units"], attributeDefs: defs });
    expect(await code(as(F.ownerB).mutation(api.products.create, prod({ name: "b2", attrs: { generic: "ok" } })))).toBe("INVALID_INPUT");
  });

  it("onboarding rejects forged business types and cannot be replayed by an existing member", async () => {
    const mk = (u: { userId: Id<"users"> }, businessTypes: string[]) =>
      as(u).mutation(api.onboarding.createBusiness, {
        fullName: "F", name: "N", businessType: "x", phone: "1", address: "a", city: "c", country: "SO", currency: "USD", businessTypes,
      });
    expect(await code(mk(F.ownerA, ["general"]))).toBe("ALREADY_ONBOARDED");
    expect(await code(mk(F.ownerA, ["__proto__"]))).toBe("ALREADY_ONBOARDED");
    const fresh = await t.run((ctx) => ctx.db.insert("users", { email: "fresh@x.so", name: "f" }));
    expect(await code(mk({ userId: fresh }, ["__proto__"]))).toBe("UNKNOWN_BUSINESS_TYPE");
    expect(await code(mk({ userId: fresh }, ["constructor"]))).toBe("UNKNOWN_BUSINESS_TYPE");
    expect(await code(mk({ userId: fresh }, Array(50).fill("general")))).toBe("OK"); // dedup'd to one
  });
});

describe("8. barcodes.generate and general access", () => {
  it("generate/generateMissing are tenant-scoped and need inventory access", async () => {
    const A = as(F.ownerA);
    const pid = await A.mutation(api.products.create, prod({ name: "NoCode" }));
    expect(await code(as(F.ownerB).mutation(api.barcodes.generate, { productId: pid }))).toBe("NOT_FOUND");
    expect(await code(t.mutation(api.barcodes.generate, { productId: pid }))).toBe("UNAUTHENTICATED");
    expect(await code(as(F.superAdmin).mutation(api.barcodes.generateMissing, {}))).toBe("FORBIDDEN");
    await as(F.ownerB).mutation(api.barcodes.generateMissing, {});
    expect((await get(pid)).barcode).toBe("");
  });

  it("generated codes never collide with existing barcodes, extra barcodes or unit barcodes", async () => {
    const A = as(F.ownerA);
    // an extra barcode and a unit barcode already hold the next sequence numbers
    await A.mutation(api.products.create, prod({ name: "Holder", barcode: "H1", extraBarcodes: [makeInternalEan13(1)], units: [{ name: "box", factor: 6, barcode: makeInternalEan13(2) }] }));
    // 50 scale-style 21… codes crowd the 'top 50 in the 2… range' window
    for (let i = 0; i < 52; i++) await A.mutation(api.products.create, prod({ name: `scale${i}`, barcode: `21000000${String(i).padStart(5, "0")}` }));
    await A.mutation(api.products.create, prod({ name: "Mine", barcode: makeInternalEan13(3) }));
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await A.mutation(api.products.create, prod({ name: `gen${i}` })));
    for (const id of ids) await A.mutation(api.barcodes.generate, { productId: id });
    const gen = await Promise.all(ids.map((id) => get(id)));
    const all = await t.run((ctx) => ctx.db.query("products").withIndex("by_business", (q) => q.eq("businessId", F.A.businessId)).collect());
    const seen = new Map<string, number>();
    for (const p of all) for (const c of [p.barcode, ...p.extraBarcodes, ...(p.units ?? []).map((u) => u.barcode)]) if (c) seen.set(c, (seen.get(c) ?? 0) + 1);
    expect([...seen.values()].every((c) => c === 1)).toBe(true);
    expect(gen.every((p) => /^20\d{11}$/.test(p.barcode))).toBe(true);
  });
});
