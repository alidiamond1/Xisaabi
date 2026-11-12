import { v } from "convex/values";
import { action, env, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { audit, fail, requireBusiness } from "./lib/access";
import { optStr } from "./lib/validate";
import { canUseSnap, identifier, isCheckoutUrl, object, readPayment, snapConfig, snapRequest, type SnapPayment } from "./lib/snap";
import { limiter } from "./lib/limiter";
import { extendSubscription, planPriceCents } from "./shared/subscriptions";

const OPTS = { roles: ["OWNER" as const], allowLocked: true };
const periodArg = v.union(v.literal("monthly"), v.literal("yearly"));
const environmentArg = v.union(v.literal("sandbox"), v.literal("live"));
const paymentArg = v.object({ id: v.string(), amount: v.number(), currency: v.string(), provider: v.string(), status: v.string(), refunded_amount: v.number(), metadata: v.record(v.string(), v.string()) });

export const current = query({
  args: {},
  handler: async (ctx) => {
    const { business, businessId, plan } = await requireBusiness(ctx, "billing", OPTS);
    const members = await ctx.db
      .query("members")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .collect();
    const products = await ctx.db
      .query("products")
      .withIndex("by_business", (q) => q.eq("businessId", businessId).eq("isArchived", false))
      .take(100_000);
    const payments = await ctx.db
      .query("subscriptionPayments")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .order("desc")
      .take(50);
    const snap = snapConfig(env);
    return {
      plan,
      subscriptionStatus: business.subscriptionStatus,
      subscriptionEndsAt: business.subscriptionEndsAt,
      usage: { users: members.filter((m) => m.isActive).length, products: products.length },
      payments,
      checkoutEnabled: canUseSnap(snap, businessId),
      checkoutEnvironment: snap?.environment ?? null,
    };
  },
});

export const plans = query({
  args: {},
  handler: async (ctx) => {
    const { business } = await requireBusiness(ctx, "billing", OPTS);
    const all = await ctx.db.query("plans").withIndex("by_sort").collect();
    // Trial only shows while it is the current plan, and never as an option to pick again.
    return all.filter((p) => p.isActive && (!p.isDefaultTrial || p._id === business.planId));
  },
});

export const requestPlan = mutation({
  args: { planId: v.id("plans"), period: v.optional(periodArg), message: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { member, businessId } = await requireBusiness(ctx, "billing", OPTS);
    const plan = await ctx.db.get(a.planId);
    if (!plan || !plan.isActive || plan.isDefaultTrial) fail("NOT_FOUND"); // trial is signup-only
    const message = optStr(a.message, 5000);
    const now = Date.now();
    const ticketId = await ctx.db.insert("tickets", {
      businessId,
      subject: `Upgrade request: ${plan.name} (${a.period ?? "monthly"})`,
      category: "BILLING",
      priority: "NORMAL",
      status: "OPEN",
      createdBy: member._id,
      unreadByPlatform: true,
      unreadByBusiness: false,
      lastMessageAt: now,
      createdAt: now,
    });
    await ctx.db.insert("ticketMessages", {
      ticketId,
      businessId,
      authorMemberId: member._id,
      authorName: member.fullName,
      fromPlatform: false,
      body: message ?? `We would like the ${plan.name} plan, billed ${a.period ?? "monthly"}: USD ${(planPriceCents(plan, a.period ?? "monthly") / 100).toFixed(2)}.`,
      createdAt: now,
    });
    await audit(ctx, member, "billing.requestPlan", plan.name);
    return ticketId;
  },
});

export const prepareCheckout = internalMutation({
  args: {planId: v.id("plans"), period: periodArg, config: v.union(v.null(), v.object({
    environment: environmentArg, merchantId: v.string(), apiBaseUrl: v.string(), appOrigin: v.string(), sandboxBusinessIds: v.array(v.string()),
  }))},
  handler: async (ctx, a): Promise<Doc<"subscriptionCheckouts"> | null> => {
    const {member, business, businessId} = await requireBusiness(ctx, "billing", OPTS);
    if (business.status === "SUSPENDED") fail("BUSINESS_SUSPENDED");
    const plan = await ctx.db.get(a.planId);
    if (!plan || !plan.isActive || plan.isDefaultTrial) fail("NOT_FOUND"); // trial is signup-only
    const amount = planPriceCents(plan, a.period);
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1e12) fail("INVALID_INPUT");
    if (!(await limiter.limit(ctx, "checkoutCreate", {key: businessId})).ok) fail("RATE_LIMITED");
    const now = Date.now();
    if (amount === 0) {
      if (business.planId !== plan._id || business.subscriptionEndsAt <= now) {
        await ctx.db.patch(businessId, {planId: plan._id, subscriptionStatus: "ACTIVE", subscriptionEndsAt: extendSubscription(now, a.period)});
        await audit(ctx, member, "billing.freePlan", plan.name);
      }
      return null;
    }
    const config = a.config;
    if (!config || (config.environment === "sandbox" && !config.sandboxBusinessIds.includes(businessId))) fail("PAYMENT_GATEWAY_UNAVAILABLE");
    const pending = await ctx.db.query("subscriptionCheckouts").withIndex("by_businessId_and_status", q => q.eq("businessId", businessId).eq("status", "PENDING")).order("desc").take(20);
    const existing = pending.find(row => row.planId === plan._id && row.period === a.period && row.amountCents === amount && row.environment === config.environment && row.merchantId === config.merchantId && row.apiBaseUrl === config.apiBaseUrl && row.expiresAt > now);
    if (existing) return existing;
    const id = await ctx.db.insert("subscriptionCheckouts", {
      businessId, memberId: member._id, planId: plan._id, planName: plan.name, period: a.period, amountCents: amount,
      environment: config.environment, merchantId: config.merchantId, apiBaseUrl: config.apiBaseUrl,
      status: "PENDING", requestBody: "", expiresAt: now + 1800_000, createdAt: now,
    });
    const metadata = {xisabsax_checkout_id: id, business_id: businessId, plan_id: plan._id, period: a.period, environment: config.environment, ...(config.merchantId ? {merchant_id: config.merchantId} : {})};
    const requestBody = JSON.stringify({amount, successUrl: `${config.appOrigin}/apps/billing?checkout=${id}&result=success`,
      cancelUrl: `${config.appOrigin}/apps/billing?checkout=${id}&result=cancel`,
      ...(config.environment === "sandbox" ? {allowedProviders: ["mock"]} : {}),
      ttlSeconds: 1800, presentation: "hosted", locale: "so-SO", metadata});
    await ctx.db.patch(id, {requestBody});
    return (await ctx.db.get(id))!;
  },
});

export const saveCheckoutSession = internalMutation({
  args: {checkoutId: v.id("subscriptionCheckouts"), sessionId: v.string(), url: v.string(), expiresAt: v.number()},
  handler: async (ctx, a) => {
    const checkout = await ctx.db.get(a.checkoutId);
    if (!checkout) fail("NOT_FOUND");
    if (checkout.sessionId && checkout.sessionId !== a.sessionId) fail("PAYMENT_VERIFICATION_FAILED");
    await ctx.db.patch(checkout._id, {sessionId: a.sessionId, checkoutUrl: a.url, expiresAt: a.expiresAt});
  },
});

type CheckoutResult = {checkoutId: Id<"subscriptionCheckouts"> | null; url: string | null; environment: "sandbox" | "live"; activated: boolean};
export const startCheckout = action({
  args: {planId: v.id("plans"), period: periodArg},
  handler: async (ctx, a): Promise<CheckoutResult> => {
    const config = snapConfig(env);
    const checkout: Doc<"subscriptionCheckouts"> | null = await ctx.runMutation(internal.billing.prepareCheckout, {
      ...a, config: config ? {environment: config.environment, merchantId: config.merchantId, apiBaseUrl: config.apiBaseUrl, appOrigin: config.appOrigin, sandboxBusinessIds: config.sandboxBusinessIds} : null,
    });
    if (!checkout) return {checkoutId: null, url: null, environment: config?.environment ?? "sandbox", activated: true};
    if (!config) fail("PAYMENT_GATEWAY_UNAVAILABLE");
    if (checkout.checkoutUrl && isCheckoutUrl(checkout.checkoutUrl, config.checkoutOrigins)) return {checkoutId: checkout._id, url: checkout.checkoutUrl, environment: checkout.environment, activated: false};
    try {
      const result = await snapRequest(config, "/v1/checkout/sessions", {method: "POST", headers: {"Idempotency-Key": `xisabsax:${checkout._id}`}, body: checkout.requestBody});
      if (!object(result) || result.object !== "checkout.session" || !identifier(result.id) || typeof result.url !== "string" || !isCheckoutUrl(result.url, config.checkoutOrigins) || !Number.isSafeInteger(result.expires_at) || (result.expires_at as number) <= Date.now()) fail("PAYMENT_GATEWAY_UNAVAILABLE");
      await ctx.runMutation(internal.billing.saveCheckoutSession, {checkoutId: checkout._id, sessionId: result.id, url: result.url, expiresAt: result.expires_at as number});
      return {checkoutId: checkout._id, url: result.url, environment: checkout.environment, activated: false};
    } catch (e) { console.error("SNAP checkout failed:", e instanceof Error ? e.message : e); fail("PAYMENT_GATEWAY_UNAVAILABLE"); }
  },
});

export const checkout = query({
  args: {checkoutId: v.string()},
  handler: async (ctx, a) => {
    const {businessId} = await requireBusiness(ctx, "billing", OPTS);
    const id = ctx.db.normalizeId("subscriptionCheckouts", a.checkoutId);
    const row = id ? await ctx.db.get(id) : null;
    if (!row || row.businessId !== businessId) return null;
    return {status: row.status, planName: row.planName, period: row.period, amountCents: row.amountCents, environment: row.environment};
  },
});

export const checkoutForVerification = internalQuery({
  args: {checkoutId: v.string(), ownerRequired: v.boolean()},
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId("subscriptionCheckouts", a.checkoutId);
    const row = id ? await ctx.db.get(id) : null;
    if (a.ownerRequired) {
      const {businessId} = await requireBusiness(ctx, "billing", OPTS);
      if (!row || row.businessId !== businessId) fail("NOT_FOUND");
    }
    return row;
  },
});

/** Called only after authenticated SNAP retrieval; the transaction deduplicates both event and payment. */
export const settleCheckout = internalMutation({
  args: {checkoutId: v.id("subscriptionCheckouts"), payment: paymentArg, merchantId: v.string(), environment: environmentArg, eventId: v.optional(v.string())},
  handler: async (ctx, a) => {
    const checkout = await ctx.db.get(a.checkoutId);
    if (!checkout) fail("NOT_FOUND");
    const p = a.payment;
    if (p.status !== "succeeded" || p.refunded_amount !== 0 || p.currency !== "USD" || p.amount !== checkout.amountCents || checkout.environment !== a.environment || checkout.merchantId !== a.merchantId ||
      p.metadata.xisabsax_checkout_id !== checkout._id || p.metadata.business_id !== checkout.businessId || p.metadata.plan_id !== checkout.planId || p.metadata.period !== checkout.period || p.metadata.environment !== checkout.environment || (p.metadata.merchant_id ?? "") !== checkout.merchantId ||
      (checkout.environment === "sandbox" ? p.provider !== "mock" : p.provider === "mock")) fail("PAYMENT_VERIFICATION_FAILED");
    if (a.eventId && await ctx.db.query("snapWebhookEvents").withIndex("by_eventId", q => q.eq("eventId", a.eventId!)).unique()) return {paid: checkout.status === "PAID"};
    const other = await ctx.db.query("subscriptionCheckouts").withIndex("by_paymentId", q => q.eq("paymentId", p.id)).unique();
    if (other && other._id !== checkout._id) fail("PAYMENT_VERIFICATION_FAILED");
    if (checkout.status === "PAID") {
      if (checkout.paymentId !== p.id) fail("PAYMENT_VERIFICATION_FAILED");
    } else {
      const business = await ctx.db.get(checkout.businessId);
      const plan = await ctx.db.get(checkout.planId);
      const member = await ctx.db.get(checkout.memberId);
      if (!business || !plan || !member) fail("NOT_FOUND");
      const now = Date.now();
      const paymentRecordId = await ctx.db.insert("subscriptionPayments", {businessId: checkout.businessId, planId: checkout.planId, amountCents: checkout.amountCents,
        months: checkout.period === "yearly" ? 12 : 1, method: "SNAP", reference: p.id, recordedBy: checkout.memberId, createdAt: now});
      const start = business.planId === checkout.planId ? Math.max(now, business.subscriptionEndsAt) : now;
      await ctx.db.patch(business._id, {planId: checkout.planId, subscriptionStatus: "ACTIVE", subscriptionEndsAt: extendSubscription(start, checkout.period)});
      await ctx.db.patch(checkout._id, {status: "PAID", paymentId: p.id, paymentRecordId, paidAt: now});
      await audit(ctx, member, "billing.gatewayPayment", `${checkout.planName} ${checkout.period} SNAP ${checkout.environment}`, checkout.businessId);
    }
    if (a.eventId) await ctx.db.insert("snapWebhookEvents", {eventId: a.eventId, checkoutId: checkout._id, createdAt: Date.now()});
    return {paid: true};
  },
});

async function verifiedPayment(config: NonNullable<ReturnType<typeof snapConfig>>, row: Doc<"subscriptionCheckouts">, paymentId: string): Promise<SnapPayment> {
  if (!identifier(paymentId) || config.environment !== row.environment || config.merchantId !== row.merchantId || config.apiBaseUrl !== row.apiBaseUrl || !canUseSnap(config, row.businessId)) fail("PAYMENT_VERIFICATION_FAILED");
  const payment = readPayment(await snapRequest(config, `/v1/payments/${encodeURIComponent(paymentId)}`));
  if (!payment || payment.id !== paymentId) fail("PAYMENT_VERIFICATION_FAILED");
  return payment;
}

export const verifyCheckout = action({
  args: {checkoutId: v.string(), paymentId: v.string()},
  handler: async (ctx, a): Promise<{paid: boolean}> => {
    const row: Doc<"subscriptionCheckouts"> | null = await ctx.runQuery(internal.billing.checkoutForVerification, {checkoutId: a.checkoutId, ownerRequired: true});
    if (!row) fail("NOT_FOUND");
    const config = snapConfig(env);
    if (!config) fail("PAYMENT_GATEWAY_UNAVAILABLE");
    let payment: SnapPayment;
    try { payment = await verifiedPayment(config, row, a.paymentId); } catch { fail("PAYMENT_VERIFICATION_FAILED"); }
    if (payment.status !== "succeeded") return {paid: false};
    return ctx.runMutation(internal.billing.settleCheckout, {checkoutId: row._id, payment, merchantId: config.merchantId, environment: config.environment});
  },
});

export const processSnapPayment = internalAction({
  args: {checkoutId: v.string(), paymentId: v.string(), eventId: v.string()},
  handler: async (ctx, a): Promise<void> => {
    const row: Doc<"subscriptionCheckouts"> | null = await ctx.runQuery(internal.billing.checkoutForVerification, {checkoutId: a.checkoutId, ownerRequired: false});
    if (!row) return;
    const config = snapConfig(env);
    if (!config) fail("PAYMENT_GATEWAY_UNAVAILABLE");
    const payment = await verifiedPayment(config, row, a.paymentId);
    await ctx.runMutation(internal.billing.settleCheckout, {checkoutId: row._id, payment, merchantId: config.merchantId, environment: config.environment, eventId: a.eventId});
  },
});
