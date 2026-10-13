import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { audit, diff, fail, requireBusiness } from "./lib/access";
import { cents, checkLogo, optStr, str } from "./lib/validate";
import { feature, paymentMethod } from "./schema";
import { MAX_BUSINESS_TYPES, PRESETS, businessFeatures, mergePresets, type AttributeDef } from "./shared/presets";

const OPTS = { roles: ["OWNER" as const], allowLocked: true };

export const get = query({
  args: {},
  handler: async (ctx) => {
    const { business } = await requireBusiness(ctx, "settings", OPTS);
    return {
      business,
      logoUrl: business.logoId ? await ctx.storage.getUrl(business.logoId) : null,
    };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireBusiness(ctx, "settings", OPTS);
    return await ctx.storage.generateUploadUrl();
  },
});

export const updateProfile = mutation({
  args: {
    name: v.string(),
    businessType: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    address: v.string(),
    city: v.string(),
    country: v.string(),
    currency: v.string(),
    logoId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, a) => {
    const { member, business, businessId } = await requireBusiness(ctx, "settings", OPTS);
    if (a.logoId) await checkLogo(ctx, a.logoId, businessId);
    // logoId omitted = keep current logo
    const logoId = a.logoId ?? business.logoId;
    const next = {
      name: str(a.name),
      businessType: str(a.businessType),
      phone: str(a.phone, 50),
      email: optStr(a.email),
      address: str(a.address),
      city: str(a.city),
      country: str(a.country),
      currency: str(a.currency, 8).toUpperCase(),
      logoId,
    };
    await ctx.db.patch(businessId, next);
    if (a.logoId && business.logoId && business.logoId !== a.logoId) {
      await ctx.storage.delete(business.logoId);
    }
    await audit(ctx, member, "settings.profile", undefined, undefined, {
      targetId: businessId,
      targetName: next.name,
      changes: diff(business, next, Object.keys(next)),
    });
  },
});

export const updateSettings = mutation({
  args: {
    receiptHeader: v.optional(v.string()),
    receiptFooter: v.optional(v.string()),
    taxRatePercent: v.number(),
    lowStockThreshold: v.number(),
    allowNegativeStock: v.boolean(),
    // omitted = keep the current value
    paymentMethods: v.optional(v.array(paymentMethod)),
    maxCashierDiscountPercent: v.optional(v.number()),
    defaultCreditLimitCents: v.optional(v.number()),
    expenseCategories: v.optional(v.array(v.string())),
    discountPresets: v.optional(v.array(v.number())),
    shareToCatalog: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const { member, businessId, business } = await requireBusiness(ctx, "settings", OPTS);
    const cur = business.settings;
    const maxDisc = a.maxCashierDiscountPercent ?? cur.maxCashierDiscountPercent;
    if (!(maxDisc >= 0 && maxDisc <= 100)) fail("INVALID_INPUT");
    const presets = a.discountPresets ?? cur.discountPresets;
    if (presets.length > 6 || presets.some((p) => !(p >= 1 && p <= 100))) fail("INVALID_INPUT");
    const categories = a.expenseCategories ? [...new Set(a.expenseCategories.map((c) => str(c, 40)))] : cur.expenseCategories;
    if (categories.length < 1 || categories.length > 40) fail("INVALID_INPUT");
    const methods = [...new Set(["CASH" as const, ...(a.paymentMethods ?? cur.paymentMethods)])]; // CASH is always on
    if (!(a.taxRatePercent >= 0 && a.taxRatePercent <= 100)) fail("INVALID_INPUT");
    if (!Number.isInteger(a.lowStockThreshold) || a.lowStockThreshold < 0 || a.lowStockThreshold > 1e6)
      fail("INVALID_INPUT");
    const next = {
        receiptHeader: optStr(a.receiptHeader, 500),
        receiptFooter: optStr(a.receiptFooter, 500),
        taxRatePercent: a.taxRatePercent,
        lowStockThreshold: a.lowStockThreshold,
        allowNegativeStock: a.allowNegativeStock,
        paymentMethods: methods,
        maxCashierDiscountPercent: maxDisc,
        defaultCreditLimitCents: a.defaultCreditLimitCents === undefined ? cur.defaultCreditLimitCents : cents(a.defaultCreditLimitCents),
        expenseCategories: categories,
        discountPresets: presets,
        shareToCatalog: a.shareToCatalog ?? cur.shareToCatalog, // omitted = keep (never silently re-enable sharing)
    };
    await ctx.db.patch(businessId, { settings: next });
    await audit(ctx, member, "settings.update", undefined, undefined, {
      targetId: businessId,
      changes: diff(cur, next, Object.keys(next)),
    });
  },
});

const defView = v.object({
  key: v.string(), label: v.string(), type: v.union(v.literal("text"), v.literal("number"), v.literal("select")),
  options: v.optional(v.array(v.string())), searchable: v.boolean(),
});

export const features = query({
  args: {},
  handler: async (ctx) => {
    const { business } = await requireBusiness(ctx, "settings", OPTS);
    return {
      businessTypes: business.businessTypes ?? [],
      features: businessFeatures(business),
      attributeDefs: business.attributeDefs ?? [],
    };
  },
});

export const updateFeatures = mutation({
  args: { features: v.array(feature), attributeDefs: v.array(defView) },
  handler: async (ctx, a) => {
    const { member, businessId, business } = await requireBusiness(ctx, "settings", OPTS);
    if (a.attributeDefs.length > 20) fail("INVALID_INPUT");
    const keys = new Set<string>();
    const defs: AttributeDef[] = a.attributeDefs.map((d) => {
      if (!/^[a-z][a-zA-Z0-9]{0,30}$/.test(d.key) || keys.has(d.key)) fail("INVALID_INPUT");
      keys.add(d.key);
      const options = d.type === "select" ? [...new Set((d.options ?? []).map((o) => str(o, 40)))] : undefined;
      if (options && (options.length < 1 || options.length > 30)) fail("INVALID_INPUT");
      return { key: d.key, label: str(d.label, 40), type: d.type, options, searchable: d.searchable };
    });
    const features = [...new Set(a.features)];
    await ctx.db.patch(businessId, { features, attributeDefs: defs });
    await audit(ctx, member, "settings.features", undefined, undefined, {
      targetId: businessId,
      changes: diff({ features: businessFeatures(business), attributeDefs: business.attributeDefs }, { features, attributeDefs: defs }, ["features", "attributeDefs"]),
    });
  },
});

/** Add business types: unions their features and fields in (never removes) and seeds missing categories. */
export const applyPreset = mutation({
  args: { businessTypes: v.array(v.string()) },
  handler: async (ctx, a) => {
    const { member, businessId, business } = await requireBusiness(ctx, "settings", OPTS);
    const types = [...new Set(a.businessTypes)];
    if (!types.length || types.length > MAX_BUSINESS_TYPES || types.some((k) => !PRESETS.some((p) => p.key === k))) fail("UNKNOWN_BUSINESS_TYPE");
    const preset = mergePresets(types);
    const defs = [...(business.attributeDefs ?? [])];
    for (const d of preset.attributes) if (!defs.some((x) => x.key === d.key)) defs.push(d);
    if (defs.length > 20) fail("INVALID_INPUT");
    await ctx.db.patch(businessId, {
      businessTypes: [...new Set([...(business.businessTypes ?? []), ...types])],
      features: [...new Set([...businessFeatures(business), ...preset.features])],
      attributeDefs: defs,
    });
    const have = new Set(
      (await ctx.db.query("categories").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(1000)).map((c) => c.name.toLowerCase()),
    );
    for (const name of preset.categories) if (!have.has(name.toLowerCase())) await ctx.db.insert("categories", { businessId, name });
    await audit(ctx, member, "settings.applyPreset", types.join(","));
  },
});
