/// <reference types="vite/client" />
// Barcode helpers, shared catalog, scanner sessions, lookups. Run: npm test
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { contribute, isSpammy, resolveLocal } from "./lib/catalog";
import schema from "./schema";
import { gtinCheckDigit, isInternal, isValidGtin, isValidImei, makeInternalEan13, normalizeGtin, parseGs1 } from "./shared/barcode";
import { MODULE_KEYS } from "./shared/modules";

const modules = import.meta.glob("./**/*.*s");
const DAY = 86_400_000;
const EAN = "4006381333931";
const COLA = "5449000000996";

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    const d = (e as { data?: unknown }).data;
    return typeof d === "string" ? d : `RAW:${(e as Error).message}`;
  }
}

describe("barcode helpers", () => {
  it("validates GTINs", () => {
    expect(isValidGtin(EAN)).toBe(true);
    expect(isValidGtin(COLA)).toBe(true);
    expect(isValidGtin("4006381333932")).toBe(false);
    expect(isValidGtin("96385074")).toBe(true); // EAN-8
    expect(isValidGtin("96385075")).toBe(false);
    expect(isValidGtin("036000291452")).toBe(true); // UPC-A
    expect(isValidGtin("036000291453")).toBe(false);
    expect(isValidGtin("12345")).toBe(false);
    expect(isValidGtin("40063813339a1")).toBe(false);
  });
  it("normalizes UPC-A to EAN-13", () => {
    expect(normalizeGtin("036000291452")).toBe("0036000291452");
    expect(normalizeGtin(" " + EAN + " ")).toBe(EAN);
    expect(normalizeGtin("96385074")).toBe("96385074");
    expect(normalizeGtin("0" + EAN)).toBe(EAN); // GTIN-14
    expect(normalizeGtin("bad")).toBeNull();
  });
  it("expands UPC-E", () => {
    expect(isValidGtin("042100005264")).toBe(true);
    expect(isValidGtin("04252614")).toBe(true); // UPC-E of 042100005264 (not a valid EAN-8)
    expect(normalizeGtin("04252614")).toBe("0042100005264");
    expect(isValidGtin("04252615")).toBe(false);
  });
  it("generates unique internal barcodes with check digit", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const c = makeInternalEan13(i);
      expect(c).toHaveLength(13);
      expect(c.startsWith("20")).toBe(true);
      expect(isInternal(c)).toBe(true);
      expect(isValidGtin(c)).toBe(true);
      expect(gtinCheckDigit(c.slice(0, 12))).toBe(Number(c[12]));
      seen.add(c);
    }
    expect(seen.size).toBe(500);
    expect(isInternal(EAN)).toBe(false);
    expect(() => makeInternalEan13(-1)).toThrow();
  });
  it("parses GS1 element strings", () => {
    const gtin14 = "0" + EAN;
    const GS = "\u001d";
    expect(parseGs1(`]d2${"01" + gtin14}17250900${"10"}AB12${GS}21XYZ9`)).toEqual({
      gtin: EAN, expiry: "2025-09-30", batch: "AB12", serial: "XYZ9",
    });
    expect(parseGs1(`01${gtin14}1726022810LOT-1`)).toEqual({ gtin: EAN, expiry: "2026-02-28", batch: "LOT-1" });
    expect(parseGs1(`]C101${gtin14}17240215`).expiry).toBe("2024-02-15");
    expect(parseGs1(`01${gtin14}17240200`).expiry).toBe("2024-02-29"); // day 00 = last day, leap year
    expect(parseGs1(`(01)${gtin14}(17)271231(10)B7`)).toEqual({ gtin: EAN, expiry: "2027-12-31", batch: "B7" });
    expect(parseGs1(EAN)).toEqual({});
    expect(parseGs1("hello")).toEqual({});
  });
  it("checks IMEI Luhn", () => {
    expect(isValidImei("490154203237518")).toBe(true);
    expect(isValidImei("490154203237519")).toBe(false);
    expect(isValidImei("49015420323751")).toBe(false);
  });
  it("detects spammy names", () => {
    for (const s of ["Visit www.shop.com", "call +252 61 555 1234", "Cola 5$", "Cola 2 usd", "http://x"]) expect(isSpammy(s), s).toBe(true);
    for (const s of ["Coca-Cola 330 ml", "Milk 1L", "Rice 25 kg bag"]) expect(isSpammy(s), s).toBe(false);
  });
});

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
    const biz = async (name: string, share?: boolean) => {
      const ownerUserId = await ctx.db.insert("users", { email: `${name}-owner`, name });
      const businessId = await ctx.db.insert("businesses", {
        name, businessType: "Grocery", phone: "1", address: "a", city: "c", country: "SO", currency: "USD",
        ownerUserId, status: "ACTIVE", planId, subscriptionStatus: "ACTIVE", subscriptionEndsAt: now + 365 * DAY,
        settings: {
          taxRatePercent: 0, lowStockThreshold: 5, allowNegativeStock: false,
          paymentMethods: ["CASH"], maxCashierDiscountPercent: 10, defaultCreditLimitCents: 0,
          expenseCategories: ["Rent"], discountPresets: [5], shareToCatalog: share,
        },
        createdAt: now - 30 * DAY,
      });
      return { businessId, ownerUserId };
    };
    const member = async (
      role: "OWNER" | "MANAGER" | "CASHIER" | "SUPER_ADMIN" | "PLATFORM_ADMIN",
      username: string,
      businessId?: Id<"businesses">,
      userId?: Id<"users">,
    ) => {
      const uid = userId ?? (await ctx.db.insert("users", { email: username, name: username }));
      const memberId = await ctx.db.insert("members", { userId: uid, businessId, role, username, fullName: username, isActive: true, createdAt: now });
      return { userId: uid, memberId };
    };
    const A = await biz("A");
    const B = await biz("B");
    const C = await biz("C");
    const D = await biz("D");
    const P = await biz("P", false);
    return {
      A, B, C, D, P,
      ownerA: await member("OWNER", "owner-a", A.businessId, A.ownerUserId),
      cashierA: await member("CASHIER", "cashier-a", A.businessId),
      ownerB: await member("OWNER", "owner-b", B.businessId, B.ownerUserId),
      ownerC: await member("OWNER", "owner-c", C.businessId, C.ownerUserId),
      superAdmin: await member("SUPER_ADMIN", "super"),
      padmin: await member("PLATFORM_ADMIN", "padmin"),
    };
  });
}
const as = (u: { userId: Id<"users"> }) => t.withIdentity({ subject: `${u.userId}|fakesession` });
const contrib = (businessId: Id<"businesses">, name: string, barcode = EAN) =>
  t.run((ctx) => contribute(ctx, businessId, { barcode, name, brand: "Br", size: "1L", categoryHint: "drinks" }));
const catalogRows = () => t.run((ctx) => ctx.db.query("catalog").collect());

beforeEach(async () => {
  t = makeT();
  F = await build(t);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("contribute", () => {
  it("PENDING, then VERIFIED only at the 3rd distinct business; same business twice does not double count", async () => {
    await contrib(F.A.businessId, "Fresh Milk");
    await contrib(F.A.businessId, "fresh   milk");
    let rows = await catalogRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "PENDING", confirmCount: 1, source: "COMMUNITY" });
    await contrib(F.B.businessId, "FRESH MILK");
    rows = await catalogRows();
    expect(rows[0]).toMatchObject({ status: "PENDING", confirmCount: 2 });
    await contrib(F.C.businessId, "Fresh Milk");
    rows = await catalogRows();
    expect(rows[0]).toMatchObject({ status: "VERIFIED", confirmCount: 3 });
    expect(await t.run((ctx) => ctx.db.query("catalogContributions").collect())).toHaveLength(3);
  });
  it("contributions from shops younger than 7 days do not count", async () => {
    await contrib(F.A.businessId, "Milk");
    await t.run((ctx) => ctx.db.patch(F.B.businessId, { createdAt: Date.now() - DAY }));
    await contrib(F.B.businessId, "Milk");
    expect((await catalogRows())[0]).toMatchObject({ confirmCount: 1 });
    expect(await t.run((ctx) => ctx.db.query("catalogContributions").collect())).toHaveLength(2); // still saved
  });
  it("most-confirmed name wins", async () => {
    await contrib(F.A.businessId, "Milk A");
    await contrib(F.B.businessId, "Milk B");
    await contrib(F.C.businessId, "Milk B");
    const [r] = await catalogRows();
    expect(r.name).toBe("Milk B");
    expect(r.confirmCount).toBe(2);
  });
  it("skips opted-out shops, internal/invalid barcodes and spam", async () => {
    await contrib(F.P.businessId, "Fresh Milk");
    await contrib(F.A.businessId, "Own item", makeInternalEan13(5));
    await contrib(F.A.businessId, "Bad", "4006381333932");
    await contrib(F.A.businessId, "Call 0612345678 now");
    await contrib(F.A.businessId, "Cheap milk $3");
    await contrib(F.A.businessId, "see www.x.com");
    expect(await catalogRows()).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("catalogContributions").collect())).toHaveLength(0);
  });
  it("normalizes UPC-A to one EAN-13 row", async () => {
    await contrib(F.A.businessId, "Cola", "036000291452");
    await contrib(F.B.businessId, "Cola", "0036000291452");
    await contrib(F.C.businessId, "Cola", "036000291452");
    const rows = await catalogRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("VERIFIED");
  });
  it("HIDDEN stays hidden", async () => {
    await contrib(F.A.businessId, "Milk");
    await t.run(async (ctx) => {
      const [r] = await ctx.db.query("catalog").collect();
      await ctx.db.patch(r._id, { status: "HIDDEN" });
    });
    await contrib(F.B.businessId, "Milk");
    expect((await catalogRows())[0].status).toBe("HIDDEN");
  });
});

const prod = (businessId: Id<"businesses">, over: Record<string, unknown>) =>
  t.run((ctx) =>
    ctx.db.insert("products", {
      businessId, type: "STOCKABLE", name: "P", sku: "", barcode: "", extraBarcodes: [], brand: "", unit: "pcs",
      allowDecimal: false, costCents: 300, priceCents: 500, stock: 1, reorderLevel: 0, trackExpiry: false,
      hasVariants: false, isArchived: false, updatedAt: Date.now(), ...over,
    } as never),
  );

describe("lookup", () => {
  it("local first (barcode, extra, unit, sku), catalog second, never contributions", async () => {
    const p1 = await prod(F.A.businessId, { barcode: COLA, name: "Cola" });
    await prod(F.A.businessId, { name: "Extra", extraBarcodes: ["EXTRA1"] });
    await prod(F.A.businessId, { name: "Packs", units: [{ name: "box", factor: 12, barcode: "BOX123" }] });
    await prod(F.A.businessId, { name: "Skued", sku: "SKU-9" });
    await prod(F.B.businessId, { barcode: EAN, name: "B-only" });
    const a = as(F.ownerA);
    expect((await a.query(api.catalog.lookup, { code: COLA })).local?.product._id).toBe(p1);
    expect((await a.query(api.catalog.lookup, { code: "EXTRA1" })).local?.product.name).toBe("Extra");
    const u = await a.query(api.catalog.lookup, { code: "BOX123" });
    expect(u.local?.product.name).toBe("Packs");
    expect(u.local?.unit?.name).toBe("box");
    expect((await a.query(api.catalog.lookup, { code: "SKU-9" })).local?.product.name).toBe("Skued");
    const miss = await a.query(api.catalog.lookup, { code: EAN }); // B's product is not local for A
    expect(miss.local).toBeNull();
    expect(miss.needsRemote).toBe(true);

    await contrib(F.B.businessId, "Shared Milk");
    await contrib(F.C.businessId, "Shared Milk");
    await contrib(F.D.businessId, "Shared Milk");
    const hit = await a.query(api.catalog.lookup, { code: EAN });
    expect(hit.catalog).toMatchObject({ name: "Shared Milk", confirmCount: 3, status: "VERIFIED", source: "COMMUNITY" });
    expect(hit.needsRemote).toBe(false);
    const json = JSON.stringify(hit);
    expect(json).not.toContain("businessId");
    expect(json).not.toContain("B-only");
  });
  it("hides cost from members without seeCost and requires login", async () => {
    await prod(F.A.businessId, { barcode: COLA });
    const own = await as(F.ownerA).query(api.catalog.lookup, { code: COLA });
    expect(own.local?.product.costCents).toBe(300);
    const cash = await as(F.cashierA).query(api.catalog.lookup, { code: COLA });
    expect(cash.local?.product.costCents).toBeUndefined();
    expect(await code(t.query(api.catalog.lookup, { code: COLA }))).toBe("UNAUTHENTICATED");
  });
  it("needsRemote logic", async () => {
    const a = as(F.ownerA);
    expect((await a.query(api.catalog.lookup, { code: EAN })).needsRemote).toBe(true);
    expect((await a.query(api.catalog.lookup, { code: makeInternalEan13(3) })).needsRemote).toBe(false);
    expect((await a.query(api.catalog.lookup, { code: "4006381333932" })).needsRemote).toBe(false); // bad check digit
    expect((await a.query(api.catalog.lookup, { code: "ABC" })).needsRemote).toBe(false);
    await t.run((ctx) =>
      ctx.db.insert("catalog", {
        barcode: EAN, status: "NOT_FOUND", name: "", brand: "", size: "", categoryHint: "", source: "OTHER",
        confirmCount: 0, flagCount: 0, fetchedAt: Date.now(),
      }),
    );
    const now = Date.now();
    expect((await a.query(api.catalog.lookup, { code: EAN, now })).needsRemote).toBe(false);
    const later = await a.query(api.catalog.lookup, { code: EAN, now: now + 31 * DAY });
    expect(later.needsRemote).toBe(true);
    expect(later.catalog).toBeNull();
  });
  it("resolveLocal ignores other tenants", async () => {
    await prod(F.B.businessId, { barcode: COLA });
    expect(await t.run((ctx) => resolveLocal(ctx, F.A.businessId, COLA))).toBeNull();
  });
});

describe("flag and moderation", () => {
  it("hides at 3 distinct businesses, once per business", async () => {
    await contrib(F.A.businessId, "Milk");
    await as(F.ownerA).mutation(api.catalog.flag, { barcode: EAN });
    await as(F.cashierA).mutation(api.catalog.flag, { barcode: EAN }); // same business: ignored
    await as(F.ownerB).mutation(api.catalog.flag, { barcode: EAN });
    expect((await catalogRows())[0]).toMatchObject({ flagCount: 2, status: "PENDING" });
    await as(F.ownerC).mutation(api.catalog.flag, { barcode: EAN });
    expect((await catalogRows())[0]).toMatchObject({ flagCount: 3, status: "HIDDEN" });
    expect(await code(as(F.ownerA).mutation(api.catalog.flag, { barcode: COLA }))).toBe("NOT_FOUND");
    expect((await as(F.ownerA).query(api.catalog.lookup, { code: EAN })).catalog).toBeNull();
  });
  it("admin list/set: platform only, SUPER_ADMIN edits, audited", async () => {
    await contrib(F.A.businessId, "Milk");
    expect(await code(as(F.ownerA).query(api.catalog.adminList, {}))).toBe("FORBIDDEN");
    const list = await as(F.padmin).query(api.catalog.adminList, { status: "PENDING" });
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("businessId");
    expect(await code(as(F.padmin).mutation(api.catalog.adminSet, { barcode: EAN, status: "HIDDEN" }))).toBe("FORBIDDEN");
    await as(F.superAdmin).mutation(api.catalog.adminSet, { barcode: EAN, status: "VERIFIED", name: "Milk 1L" });
    expect((await catalogRows())[0]).toMatchObject({ status: "VERIFIED", name: "Milk 1L" });
    const log = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(log.some((l) => l.action === "catalog.adminSet")).toBe(true);
    // admin edit locks the name: later shop contributions don't overwrite it
    await contrib(F.B.businessId, "Wrong Name");
    expect((await catalogRows())[0]).toMatchObject({ name: "Milk 1L", locked: true });
  });
});

describe("barcodes", () => {
  it("generates unique internal barcodes, audited, tenant-safe", async () => {
    const p1 = await prod(F.A.businessId, { name: "One" });
    const p2 = await prod(F.A.businessId, { name: "Two" });
    const pb = await prod(F.B.businessId, { name: "B" });
    const a = as(F.ownerA);
    const c1 = await a.mutation(api.barcodes.generate, { productId: p1 });
    const c2 = await a.mutation(api.barcodes.generate, { productId: p2 });
    expect(c1).not.toBe(c2);
    expect(isInternal(c1) && isValidGtin(c1)).toBe(true);
    expect(await a.mutation(api.barcodes.generate, { productId: p1 })).toBe(c1); // idempotent
    expect(await code(a.mutation(api.barcodes.generate, { productId: pb }))).toBe("NOT_FOUND");
    expect(await code(as(F.cashierA).mutation(api.barcodes.generate, { productId: p1 }))).toBe("FORBIDDEN");
    await prod(F.A.businessId, { name: "Three" });
    await prod(F.A.businessId, { name: "Arch", isArchived: true });
    expect((await a.mutation(api.barcodes.generateMissing, {})).count).toBe(1);
    const live = await t.run((ctx) =>
      ctx.db.query("products").withIndex("by_business", (q) => q.eq("businessId", F.A.businessId).eq("isArchived", false)).collect(),
    );
    expect(new Set(live.map((p) => p.barcode)).size).toBe(3);
    const log = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(log.filter((l) => l.action.startsWith("barcode.")).length).toBe(3);
  });
});

describe("scanner", () => {
  it("push/pending/consume access rules", async () => {
    const owner = as(F.ownerA);
    const { code: sc } = await owner.mutation(api.scanner.createSession, { target: "POS" });
    expect(sc).toMatch(/^[A-Za-z0-9_-]{10}$/);
    const session = (await t.run((ctx) => ctx.db.query("scanSessions").collect()))[0];
    expect(await code(as(F.ownerB).mutation(api.scanner.push, { code: sc, barcode: EAN }))).toBe("NOT_FOUND");
    expect(await as(F.ownerB).query(api.scanner.sessionInfo, { code: sc })).toBeNull();
    expect(await code(t.mutation(api.scanner.push, { code: sc, barcode: EAN }))).toBe("UNAUTHENTICATED");
    const phone = as(F.cashierA); // same business
    expect(await phone.query(api.scanner.sessionInfo, { code: sc, now: Date.now() })).toMatchObject({
      target: "POS", active: true, expired: false, createdBy: "owner-a",
    });
    await phone.mutation(api.scanner.push, { code: sc, barcode: EAN });
    await phone.mutation(api.scanner.push, { code: sc, barcode: COLA });
    // only the creator reads / consumes / ends
    expect(await code(phone.query(api.scanner.pending, { sessionId: session._id }))).toBe("FORBIDDEN");
    expect(await code(as(F.ownerB).query(api.scanner.pending, { sessionId: session._id }))).toBe("NOT_FOUND");
    const pend = await owner.query(api.scanner.pending, { sessionId: session._id });
    expect(pend.map((p) => p.barcode)).toEqual([EAN, COLA]);
    expect(await code(phone.mutation(api.scanner.consume, { scanIds: [pend[0]._id] }))).toBe("FORBIDDEN");
    expect(await code(as(F.ownerB).mutation(api.scanner.consume, { scanIds: [pend[0]._id] }))).toBe("NOT_FOUND");
    await owner.mutation(api.scanner.consume, { scanIds: [pend[0]._id] });
    expect((await owner.query(api.scanner.pending, { sessionId: session._id })).map((p) => p.barcode)).toEqual([COLA]);
    expect(await code(phone.mutation(api.scanner.endSession, { sessionId: session._id }))).toBe("FORBIDDEN");
    await owner.mutation(api.scanner.endSession, { sessionId: session._id });
    expect(await code(phone.mutation(api.scanner.push, { code: sc, barcode: EAN }))).toBe("SCAN_SESSION_INVALID");
  });
  it("expired session rejected; a new session deactivates the previous one", async () => {
    const owner = as(F.ownerA);
    const { code: c1 } = await owner.mutation(api.scanner.createSession, { target: "RECEIVE" });
    await t.run(async (ctx) => {
      const [s] = await ctx.db.query("scanSessions").collect();
      await ctx.db.patch(s._id, { expiresAt: Date.now() - 1 });
    });
    expect(await code(as(F.cashierA).mutation(api.scanner.push, { code: c1, barcode: EAN }))).toBe("SCAN_SESSION_INVALID");
    expect((await as(F.cashierA).query(api.scanner.sessionInfo, { code: c1, now: Date.now() }))?.expired).toBe(true);
    const { code: c2 } = await owner.mutation(api.scanner.createSession, { target: "POS" });
    const { code: c3 } = await owner.mutation(api.scanner.createSession, { target: "POS" });
    expect(c2).not.toBe(c3);
    expect(await code(as(F.cashierA).mutation(api.scanner.push, { code: c2, barcode: EAN }))).toBe("SCAN_SESSION_INVALID");
    expect(await code(as(F.cashierA).mutation(api.scanner.push, { code: c3, barcode: EAN }))).toBe("OK");
  });
  it("rate limits pushes per session (120/min)", async () => {
    const { code: sc } = await as(F.ownerA).mutation(api.scanner.createSession, { target: "POS" });
    const phone = as(F.cashierA);
    let limited = "";
    for (let i = 0; i < 125 && !limited; i++) {
      const r = await code(phone.mutation(api.scanner.push, { code: sc, barcode: EAN }));
      if (r !== "OK") limited = r;
    }
    expect(limited).toBe("RATE_LIMITED");
  });
  it("cleanup deletes old scans and sessions only", async () => {
    const { code: sc } = await as(F.ownerA).mutation(api.scanner.createSession, { target: "POS" });
    await as(F.cashierA).mutation(api.scanner.push, { code: sc, barcode: EAN });
    await t.mutation(internal.scanner.cleanup, {});
    expect(await t.run((ctx) => ctx.db.query("scans").collect())).toHaveLength(1);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 3 * DAY);
    try {
      await t.mutation(internal.scanner.cleanup, {});
    } finally {
      vi.useRealTimers();
    }
    expect(await t.run((ctx) => ctx.db.query("scans").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("scanSessions").collect())).toHaveLength(0);
  });
});

const offOk = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
const gtinN = (i: number) => {
  const body = "400638" + String(100000 + i);
  return body + gtinCheckDigit(body);
};

describe("lookups.remote", () => {
  it("requires access, fetches, caches, never re-fetches", async () => {
    const f = offOk({
      status: 1,
      product: { product_name: "Choco Bar", brands: "Brandy, Other", quantity: "50 g", categories_tags: ["en:chocolate-snacks"], image_front_small_url: "https://images.openfoodfacts.org/x.jpg" },
    });
    vi.stubGlobal("fetch", f);
    expect(await code(t.action(api.lookups.remote, { code: EAN }))).toBe("UNAUTHENTICATED");
    const a = as(F.ownerA);
    const r = await a.action(api.lookups.remote, { code: EAN });
    expect(r).toMatchObject({
      name: "Choco Bar", brand: "Brandy", size: "50 g", categoryHint: "chocolate snacks",
      imageUrl: "https://images.openfoodfacts.org/x.jpg", source: "OPEN_FOOD_FACTS", status: "PENDING",
    });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/api/v2/product/${EAN}.json`);
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/^Xisaabi\//);
    expect((await a.action(api.lookups.remote, { code: EAN }))?.name).toBe("Choco Bar");
    expect(f).toHaveBeenCalledTimes(1);
    expect((await a.query(api.catalog.lookup, { code: EAN })).catalog?.name).toBe("Choco Bar");
  });
  it("falls back to sister databases, negative-caches misses, and does not cache network errors", async () => {
    const miss = vi.fn(async () => new Response(JSON.stringify({ status: 0 }), { status: 404 }));
    vi.stubGlobal("fetch", miss);
    const a = as(F.ownerA);
    expect(await a.action(api.lookups.remote, { code: EAN })).toBeNull();
    expect(miss).toHaveBeenCalledTimes(3);
    expect((await catalogRows())[0].status).toBe("NOT_FOUND");
    expect(await a.action(api.lookups.remote, { code: EAN })).toBeNull();
    expect(miss).toHaveBeenCalledTimes(3); // served from the negative cache

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await a.action(api.lookups.remote, { code: COLA })).toBeNull();
    expect((await catalogRows()).filter((r) => r.barcode === COLA)).toHaveLength(0);
  });
  it("skips invalid/internal codes without fetching; global upstream bucket caps fetches", async () => {
    const f = offOk({ status: 0 });
    vi.stubGlobal("fetch", f);
    const a = as(F.ownerA);
    expect(await a.action(api.lookups.remote, { code: makeInternalEan13(1) })).toBeNull();
    expect(await a.action(api.lookups.remote, { code: "123" })).toBeNull();
    expect(f).not.toHaveBeenCalled();
    // 12/min global bucket (each lookup that misses everywhere = 3 fetches)
    for (let i = 0; i < 20; i++) await as(i % 2 ? F.ownerB : F.ownerA).action(api.lookups.remote, { code: gtinN(i) }); // per-shop minute cap is 10
    expect(f.mock.calls.length).toBe(12 * 3);
  });
  it("store never overwrites a real row", async () => {
    await contrib(F.A.businessId, "Community Name");
    const r = await t.mutation(internal.lookups.store, {
      barcode: EAN, found: { name: "OFF", brand: "", size: "", categoryHint: "", source: "OPEN_FOOD_FACTS" },
    });
    expect(r?.name).toBe("Community Name");
  });
});
