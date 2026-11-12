/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import {convexTest} from "convex-test";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {api, internal} from "./_generated/api";
import type {Id} from "./_generated/dataModel";
import schema from "./schema";
import {MODULE_KEYS} from "./shared/modules";
import {extendSubscription, planPriceCents} from "./shared/subscriptions";
import {isCheckoutUrl, snapConfig, verifySnapSignature} from "./lib/snap";

const modules = import.meta.glob("./**/*.*s");
const makeT = () => { const t = convexTest(schema, modules); rateLimiterTest.register(t); return t; };
let t: ReturnType<typeof makeT>;
let f: Awaited<ReturnType<typeof fixture>>;
const secret = "whsec_test_endpoint_secret";

async function fixture() {
  return t.run(async ctx => {
    const plan = {name: "Pro", description: "Shop", priceCents: 1000, yearlyPriceCents: 10000, trialDays: 14, maxUsers: 5, maxProducts: 100,
      modules: MODULE_KEYS, features: [], isDefaultTrial: false, isActive: true, sortOrder: 0};
    const planId = await ctx.db.insert("plans", plan);
    const freeId = await ctx.db.insert("plans", {...plan, name: "Free", priceCents: 0, yearlyPriceCents: 0, isDefaultTrial: false});
    const trialId = await ctx.db.insert("plans", {...plan, name: "Trial", priceCents: 0, yearlyPriceCents: 0, isDefaultTrial: true});
    const premiumId = await ctx.db.insert("plans", {...plan, name: "Premium", priceCents: 2000, yearlyPriceCents: 20000, isDefaultTrial: false});
    const create = async (name: string) => {
      const userId = await ctx.db.insert("users", {name});
      const businessId = await ctx.db.insert("businesses", {name, businessType: "Grocery", phone: "", address: "", city: "", country: "SO", currency: "USD", ownerUserId: userId,
        status: "ACTIVE", planId, subscriptionStatus: "ACTIVE", subscriptionEndsAt: Date.now() + 10 * 86400000, createdAt: Date.now(),
        settings: {taxRatePercent: 0, lowStockThreshold: 5, allowNegativeStock: false, paymentMethods: ["CASH"], maxCashierDiscountPercent: 0, defaultCreditLimitCents: 0, expenseCategories: [], discountPresets: []}});
      await ctx.db.insert("members", {userId, businessId, username: name, fullName: name, role: "OWNER", isActive: true, createdAt: Date.now()});
      return {userId, businessId};
    };
    const a = await create("a"); const b = await create("b");
    const cashierId = await ctx.db.insert("users", {name: "cashier"});
    await ctx.db.insert("members", {userId: cashierId, businessId: a.businessId, username: "cashier", fullName: "Cashier", role: "CASHIER", isActive: true, createdAt: Date.now()});
    return {planId, freeId, trialId, premiumId, a, b, cashierId};
  });
}
const owner = () => t.withIdentity({subject: `${f.a.userId}|session`});
const json = (body: unknown) => new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}});
const start = (period: "monthly" | "yearly" = "monthly", planId = f.planId) => owner().action(api.billing.startCheckout, {planId, period});
const get = (id: Id<"subscriptionCheckouts">) => t.run(ctx => ctx.db.get(id));

function checkoutMock() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    return json({id: `session-${body.metadata.xisabsax_checkout_id}`, object: "checkout.session", url: "https://checkout.example/pay", expires_at: Date.now() + 1800000});
  });
}
async function paymentFor(id: Id<"subscriptionCheckouts">, extra: Record<string, unknown> = {}) {
  const row = (await get(id))!;
  return {id: "payment-1", object: "payment", amount: row.amountCents, currency: "USD", provider: "mock", status: "succeeded", refunded_amount: 0,
    metadata: JSON.parse(row.requestBody).metadata, ...extra};
}
async function signature(raw: string, version: "v1" | "v2" = "v1", seconds = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name: "HMAC", hash: version === "v1" ? "SHA-256" : "SHA-512"}, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${seconds}.${raw}`)));
  return `t=${seconds},${version}=${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
async function webhook(data: unknown, eventId = "event-1", version: "v1" | "v2" = "v1", overrides: Record<string, unknown> = {}) {
  const raw = JSON.stringify({id: eventId, type: "payment.succeeded", created: Date.now(), merchant_id: "merchant-1", environment: "sandbox", data, ...overrides});
  return t.fetch("/webhooks/snap", {method: "POST", headers: {"X-SNAP-Signature": await signature(raw, version)}, body: raw});
}

beforeEach(async () => {
  t = makeT(); f = await fixture();
  for (const [name, value] of Object.entries({SNAP_SECRET_KEY: "sk_test_not_a_real_key", SNAP_WEBHOOK_SECRET: secret, SNAP_MERCHANT_ID: "merchant-1", SNAP_ENVIRONMENT: "sandbox",
    SNAP_APP_ORIGIN: "https://shop.example", SNAP_CHECKOUT_ORIGINS: "https://checkout.example", SNAP_SANDBOX_BUSINESS_IDS: `${f.a.businessId},${f.b.businessId}`})) vi.stubEnv(name, value);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("subscription prices and calendar periods", () => {
  it("uses explicit yearly amount or 12 monthly prices, including a genuinely free year", () => {
    expect(planPriceCents({priceCents: 1000}, "yearly")).toBe(12000);
    expect(planPriceCents({priceCents: 1000, yearlyPriceCents: 9500}, "yearly")).toBe(9500);
    expect(planPriceCents({priceCents: 1000, yearlyPriceCents: 0}, "yearly")).toBe(0);
    expect(extendSubscription(Date.UTC(2026, 0, 31, 12), "monthly")).toBe(Date.UTC(2026, 1, 28, 12));
    expect(extendSubscription(Date.UTC(2024, 1, 29, 12), "yearly")).toBe(Date.UTC(2025, 1, 28, 12));
  });
  it("rejects unsafe environments and redirects", () => {
    expect(snapConfig({SNAP_SECRET_KEY: "sk_live_no_real_key"})).toBeNull();
    const base = {SNAP_SECRET_KEY: "sk_test_x", SNAP_WEBHOOK_SECRET: "whsec_x", SNAP_MERCHANT_ID: "m", SNAP_CHECKOUT_ORIGINS: "https://checkout.example"};
    expect(snapConfig({...base, SNAP_APP_ORIGIN: "http://localhost:3000"})?.appOrigin).toBe("http://localhost:3000");
    expect(snapConfig({...base, SNAP_APP_ORIGIN: "http://localhost.evil.com"})).toBeNull();
    expect(snapConfig({...base, SNAP_MERCHANT_ID: undefined, SNAP_APP_ORIGIN: "http://localhost:3000"})?.merchantId).toBe("");
    expect(snapConfig({...base, SNAP_SECRET_KEY: "sk_live_x", SNAP_ENVIRONMENT: "live", SNAP_ENABLE_LIVE: "true", SNAP_APP_ORIGIN: "http://localhost:3000"})).toBeNull();
    expect(isCheckoutUrl("https://checkout.example.evil/pay", ["https://checkout.example"])).toBe(false);
    expect(isCheckoutUrl("https://user:pass@checkout.example/pay", ["https://checkout.example"])).toBe(false);
  });
});

describe("SNAP hosted checkout", () => {
  it("creates a server-priced monthly session and reuses it without creating another session", async () => {
    const fetch = checkoutMock();
    const result = await start();
    expect(result.activated).toBe(false); expect(result.environment).toBe("sandbox");
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body.amount).toBe(1000); expect(body.allowedProviders).toEqual(["mock"]);
    expect(body.metadata.business_id).toBe(f.a.businessId);
    expect(body.successUrl).toContain(`checkout=${result.checkoutId}&result=success`);
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({Authorization: "Bearer sk_test_not_a_real_key", "Idempotency-Key": `xisabsax:${result.checkoutId}`});
    expect(await start()).toEqual(result); expect(fetch).toHaveBeenCalledTimes(1);
    expect((await owner().query(api.billing.checkout, {checkoutId: result.checkoutId!}))?.status).toBe("PENDING");
  });
  it("retries the exact original idempotency key/body after a timeout, despite an application-origin change", async () => {
    const fetch = checkoutMock(); fetch.mockRejectedValueOnce(new Error("timeout"));
    await expect(start("yearly")).rejects.toThrow("PAYMENT_GATEWAY_UNAVAILABLE");
    vi.stubEnv("SNAP_APP_ORIGIN", "https://new-shop.example");
    await start("yearly");
    expect(fetch.mock.calls[1][1]?.body).toBe(fetch.mock.calls[0][1]?.body);
    expect(fetch.mock.calls[1][1]?.headers).toEqual(fetch.mock.calls[0][1]?.headers);
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body)).amount).toBe(10000);
  });
  it("rejects unauthenticated, cashier, suspended and non-allowlisted sandbox checkout", async () => {
    const fetch = checkoutMock();
    await expect(t.action(api.billing.startCheckout, {planId: f.planId, period: "monthly"})).rejects.toThrow("UNAUTHENTICATED");
    await expect(t.withIdentity({subject: `${f.cashierId}|s`}).action(api.billing.startCheckout, {planId: f.planId, period: "monthly"})).rejects.toThrow("FORBIDDEN");
    vi.stubEnv("SNAP_SANDBOX_BUSINESS_IDS", "");
    await expect(start()).rejects.toThrow("PAYMENT_GATEWAY_UNAVAILABLE");
    await t.run(ctx => ctx.db.patch(f.a.businessId, {status: "SUSPENDED"}));
    await expect(start()).rejects.toThrow("BUSINESS_SUSPENDED");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps free plans usable without gateway credentials and records an annual manual request", async () => {
    vi.stubEnv("SNAP_SECRET_KEY", "");
    const result = await start("yearly", f.freeId);
    expect(result).toMatchObject({activated: true, url: null});
    expect((await t.run(ctx => ctx.db.get(f.a.businessId)))?.planId).toBe(f.freeId);
    const ticketId = await owner().mutation(api.billing.requestPlan, {planId: f.planId, period: "yearly"});
    const ticket = await t.run(ctx => ctx.db.get(ticketId)); expect(ticket?.subject).toContain("yearly");
  });
  it("never lets a business pick the signup trial again", async () => {
    await expect(start("monthly", f.trialId)).rejects.toThrow("NOT_FOUND");
    await expect(owner().mutation(api.billing.requestPlan, {planId: f.trialId})).rejects.toThrow("NOT_FOUND");
    expect((await owner().query(api.billing.plans)).map(p => p.name)).not.toContain("Trial");
  });
  it("does not redirect customers to an unapproved checkout origin", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({id: "cs", object: "checkout.session", url: "https://evil.example/pay", expires_at: Date.now() + 10000}));
    await expect(start()).rejects.toThrow("PAYMENT_GATEWAY_UNAVAILABLE");
  });
});

describe("verified fulfilment", () => {
  it("verifies a payment server-side and extends the same plan exactly once under concurrent retries", async () => {
    const fetch = checkoutMock(); const result = await start();
    const payment = await paymentFor(result.checkoutId!);
    fetch.mockImplementation(async () => json(payment));
    const before = (await t.run(ctx => ctx.db.get(f.a.businessId)))!.subscriptionEndsAt;
    await Promise.all([0, 1].map(() => owner().action(api.billing.verifyCheckout, {checkoutId: result.checkoutId!, paymentId: payment.id})));
    const business = (await t.run(ctx => ctx.db.get(f.a.businessId)))!;
    expect(business.subscriptionEndsAt).toBe(extendSubscription(before, "monthly"));
    expect(await t.run(ctx => ctx.db.query("subscriptionPayments").collect())).toHaveLength(1);
    expect((await get(result.checkoutId!))?.status).toBe("PAID");
  });
  it("switches plans from payment time, without converting a cheap plan's remaining year into premium time", async () => {
    const fetch = checkoutMock(); const result = await start("yearly", f.premiumId);
    const payment = await paymentFor(result.checkoutId!); fetch.mockImplementation(async () => json(payment));
    await t.run(ctx => ctx.db.patch(f.a.businessId, {subscriptionEndsAt: Date.now() + 365 * 86400000}));
    await owner().action(api.billing.verifyCheckout, {checkoutId: result.checkoutId!, paymentId: payment.id});
    const row = (await get(result.checkoutId!))!;
    const business = (await t.run(ctx => ctx.db.get(f.a.businessId)))!;
    expect(business.planId).toBe(f.premiumId);
    expect(business.subscriptionEndsAt).toBe(extendSubscription(row.paidAt!, "yearly"));
  });
  it("does not fulfil pending, mismatched, refunded, other-tenant or malformed-return payments", async () => {
    const fetch = checkoutMock(); const result = await start();
    await expect(owner().action(api.billing.verifyCheckout, {checkoutId: "invalid", paymentId: "payment-1"})).rejects.toThrow("NOT_FOUND");
    expect(await owner().query(api.billing.checkout, {checkoutId: "invalid"})).toBeNull();
    const other = t.withIdentity({subject: `${f.b.userId}|s`});
    expect(await other.query(api.billing.checkout, {checkoutId: result.checkoutId!})).toBeNull();
    await expect(other.action(api.billing.verifyCheckout, {checkoutId: result.checkoutId!, paymentId: "payment-1"})).rejects.toThrow("NOT_FOUND");
    for (const change of [{amount: 1}, {currency: "EUR"}, {refunded_amount: 1}, {metadata: {xisabsax_checkout_id: result.checkoutId}}, {provider: "evcPlus"}]) {
      fetch.mockResolvedValueOnce(json(await paymentFor(result.checkoutId!, change)));
      await expect(owner().action(api.billing.verifyCheckout, {checkoutId: result.checkoutId!, paymentId: "payment-1"})).rejects.toThrow("PAYMENT_VERIFICATION_FAILED");
    }
    fetch.mockResolvedValueOnce(json(await paymentFor(result.checkoutId!, {status: "processing"})));
    expect(await owner().action(api.billing.verifyCheckout, {checkoutId: result.checkoutId!, paymentId: "payment-1"})).toEqual({paid: false});
    expect(await t.run(ctx => ctx.db.query("subscriptionPayments").collect())).toHaveLength(0);
  });
});

describe("SNAP webhooks", () => {
  it("accepts v1/v2 over exact bytes and rejects tampering, stale timestamps and malformed headers", async () => {
    const raw = '{ "a": 1 }'; const bytes = new TextEncoder().encode(raw);
    for (const version of ["v1", "v2"] as const) expect(await verifySnapSignature(bytes, await signature(raw, version), secret)).toBe(true);
    expect(await verifySnapSignature(new TextEncoder().encode('{"a":1}'), await signature(raw), secret)).toBe(false);
    expect(await verifySnapSignature(bytes, await signature(raw, "v1", Math.floor(Date.now() / 1000) - 301), secret)).toBe(false);
    expect(await verifySnapSignature(bytes, "t=123abc,v1=ff", secret)).toBe(false);
  });
  it("fulfils a signed direct-data event once, including a late success after expiry, without removing a business suspension", async () => {
    const fetch = checkoutMock(); const result = await start();
    const payment = await paymentFor(result.checkoutId!); fetch.mockImplementation(async () => json(payment));
    await t.run(async ctx => { await ctx.db.patch(result.checkoutId!, {status: "EXPIRED"}); await ctx.db.patch(f.a.businessId, {status: "SUSPENDED"}); });
    expect((await webhook(payment, "event-1", "v2")).status).toBe(204);
    const end = (await t.run(ctx => ctx.db.get(f.a.businessId)))!.subscriptionEndsAt;
    expect((await webhook(payment, "event-1", "v2")).status).toBe(204);
    expect((await webhook(payment, "event-2", "v1")).status).toBe(204);
    expect((await get(result.checkoutId!))?.status).toBe("PAID");
    const business = (await t.run(ctx => ctx.db.get(f.a.businessId)))!;
    expect(business.status).toBe("SUSPENDED"); expect(business.subscriptionEndsAt).toBe(end);
    expect(await t.run(ctx => ctx.db.query("subscriptionPayments").collect())).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query("snapWebhookEvents").collect())).toHaveLength(2);
  });
  it("rejects unsigned/wrong-merchant/wrong-environment events and retries server verification failures", async () => {
    const fetch = checkoutMock(); const result = await start(); const payment = await paymentFor(result.checkoutId!);
    expect((await t.fetch("/webhooks/snap", {method: "POST", body: "{}"})).status).toBe(400);
    expect((await webhook(payment, "bad-m", "v1", {merchant_id: "merchant-other"})).status).toBe(400);
    expect((await webhook(payment, "bad-env", "v1", {environment: "live"})).status).toBe(400);
    fetch.mockRejectedValueOnce(new Error("timeout"));
    expect((await webhook(payment)).status).toBe(503);
    expect(await t.run(ctx => ctx.db.query("snapWebhookEvents").collect())).toHaveLength(0);
    expect((await get(result.checkoutId!))?.status).toBe("PENDING");
  });
});
