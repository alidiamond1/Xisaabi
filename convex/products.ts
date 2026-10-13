import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { audit, fail, getOwned, requireBusiness, requirePermission, type BusinessAccess } from "./lib/access";
import { roundQty, stockIn } from "./lib/stock";
import { cents, optStr, str, ts } from "./lib/validate";
import { hasPermission } from "./shared/permissions";
import { expiryStatus } from "./shared/expiry";
import { productType } from "./schema";
import { addSerials, checkNewSerials } from "./serials";
import { contribute } from "./lib/catalog";

/** Share name/brand/size/category (never prices) to the community catalog; silent no-op when opted out or invalid. */
async function share(ctx: MutationCtx, businessId: Id<"businesses">, d: { barcode: string; name: string; brand: string; categoryId?: Id<"categories">; attrs?: Record<string, string>; imageId?: Id<"_storage"> }) {
  if (!d.barcode) return;
  const cat = d.categoryId ? await ctx.db.get(d.categoryId) : null;
  await contribute(ctx, businessId, { barcode: d.barcode, name: d.name, brand: d.brand, size: d.attrs?.size ?? "", categoryHint: cat?.name ?? "" }); // shop photos stay private: only name/brand/size are shared
}

const unitArg = v.object({ name: v.string(), factor: v.number(), barcode: v.string(), priceCents: v.optional(v.number()) });
type UnitArg = { name: string; factor: number; barcode: string; priceCents?: number };

// ponytail: lists/scans capped at 5000 rows; paginate + add by_business_category index if a shop outgrows it
const CAP = 5000;

/** Positive quantity; decimals only when the product allows them. */
export function qtyOf(n: number, allowDecimal: boolean): number {
  if (!Number.isFinite(n) || n <= 0 || n > 1e9) fail("INVALID_INPUT");
  if (!allowDecimal && !Number.isInteger(n)) fail("INVALID_INPUT");
  const r = roundQty(n);
  if (r <= 0) fail("INVALID_INPUT");
  return r;
}

/** Remove cost fields unless the caller may see them. */
export function noCost<T extends { costCents: number }>(o: T, see: boolean): Omit<T, "costCents"> & { costCents?: number } {
  if (see) return o;
  const { costCents: _c, ...rest } = o;
  return rest;
}

const base = {
  type: productType,
  name: v.string(),
  sku: v.string(),
  barcode: v.string(),
  extraBarcodes: v.array(v.string()),
  categoryId: v.optional(v.id("categories")),
  brand: v.string(),
  unit: v.string(),
  allowDecimal: v.boolean(),
  costCents: v.number(),
  priceCents: v.number(),
  wholesalePriceCents: v.optional(v.number()),
  reorderLevel: v.number(),
  trackExpiry: v.boolean(),
  supplierId: v.optional(v.id("suppliers")),
  imageId: v.optional(v.id("_storage")),
  // v3 — omitted on update = keep current
  units: v.optional(v.array(unitArg)),
  attrs: v.optional(v.record(v.string(), v.string())),
  trackSerial: v.optional(v.boolean()),
  warrantyMonths: v.optional(v.number()),
};
type Base = {
  type: Doc<"products">["type"]; name: string; sku: string; barcode: string; extraBarcodes: string[];
  categoryId?: Id<"categories">; brand: string; unit: string; allowDecimal: boolean; costCents: number;
  priceCents: number; wholesalePriceCents?: number; reorderLevel: number; trackExpiry: boolean;
  supplierId?: Id<"suppliers">; imageId?: Id<"_storage">;
  units?: UnitArg[]; attrs?: Record<string, string>; trackSerial?: boolean; warrantyMonths?: number;
};

async function clean(ctx: MutationCtx, businessId: Id<"businesses">, a: Base, cur?: Doc<"products">) {
  if (!Number.isFinite(a.reorderLevel) || a.reorderLevel < 0 || a.reorderLevel > 1e9) fail("INVALID_INPUT");
  if (a.extraBarcodes.length > 20) fail("INVALID_INPUT");
  if (a.categoryId) await getOwned(ctx, businessId, a.categoryId);
  if (a.supplierId) await getOwned(ctx, businessId, a.supplierId);
  if (a.imageId) {
    // ponytail: storage ids carry no owner; relies on ids being unguessable. Add an image-owner table if that stops being enough
    const f = await ctx.db.system.get(a.imageId);
    if (!f || (f.contentType && !f.contentType.startsWith("image/")) || f.size > 5_000_000) fail("INVALID_INPUT");
  }
  const extras = [...new Set(a.extraBarcodes.map((b) => optStr(b, 64)).filter((b): b is string => !!b))];
  const unit = str(a.unit, 30);
  const trackExpiry = a.type === "STOCKABLE" && a.trackExpiry;

  // packs: extra units with a conversion factor to the base unit
  const rawUnits = a.units ?? cur?.units ?? [];
  if (rawUnits.length > 6) fail("INVALID_INPUT");
  const names = new Set([unit.toLowerCase()]);
  const units = rawUnits.map((u) => {
    const name = str(u.name, 30);
    if (names.has(name.toLowerCase())) fail("INVALID_INPUT");
    names.add(name.toLowerCase());
    if (!Number.isFinite(u.factor) || u.factor < 0.001 || u.factor > 1e6 || (!a.allowDecimal && !Number.isInteger(u.factor))) fail("INVALID_INPUT");
    return {
      name, factor: roundQty(u.factor), barcode: optStr(u.barcode, 64) ?? "",
      priceCents: u.priceCents === undefined ? undefined : cents(u.priceCents),
    };
  });

  const trackSerial = a.trackSerial ?? cur?.trackSerial ?? false;
  const warrantyMonths = a.warrantyMonths ?? cur?.warrantyMonths;
  if (warrantyMonths !== undefined && (!Number.isInteger(warrantyMonths) || warrantyMonths < 0 || warrantyMonths > 120)) fail("INVALID_INPUT");
  if (trackSerial && (a.type !== "STOCKABLE" || a.allowDecimal || trackExpiry || units.length)) fail("INVALID_INPUT");

  // extra fields: only keys defined for this business; searchable ones feed the search index
  let attrs = cur?.attrs, attrsText = cur?.attrsText;
  if (a.attrs) {
    const defs = (await ctx.db.get(businessId))?.attributeDefs ?? [];
    const keys = Object.keys(a.attrs);
    if (keys.length > 30) fail("INVALID_INPUT");
    const out: Record<string, string> = {};
    for (const k of keys) {
      const def = defs.find((d) => d.key === k);
      const val = a.attrs[k].trim();
      if (!def) fail("INVALID_INPUT");
      if (!val) continue;
      if (val.length > 200 || (def.type === "select" && !def.options?.includes(val)) || (def.type === "number" && !Number.isFinite(Number(val)))) fail("INVALID_INPUT");
      out[k] = val;
    }
    attrs = Object.keys(out).length ? out : undefined;
    attrsText = defs.filter((d) => d.searchable && out[d.key]).map((d) => out[d.key]).join(" ") || undefined;
  }
  return {
    units: units.length ? units : undefined,
    attrs,
    attrsText,
    trackSerial,
    warrantyMonths,
    type: a.type,
    name: str(a.name),
    sku: optStr(a.sku, 64) ?? "",
    barcode: optStr(a.barcode, 64) ?? "",
    extraBarcodes: extras,
    categoryId: a.categoryId,
    brand: optStr(a.brand, 80) ?? "",
    unit,
    allowDecimal: a.allowDecimal,
    costCents: cents(a.costCents),
    priceCents: cents(a.priceCents),
    wholesalePriceCents: a.wholesalePriceCents === undefined ? undefined : cents(a.wholesalePriceCents),
    reorderLevel: roundQty(a.reorderLevel),
    trackExpiry,
    supplierId: a.supplierId,
    imageId: a.imageId,
  };
}

type CodeFields = { sku: string; barcode: string; extraBarcodes: string[]; units?: { barcode: string }[] };
const unitCodes = (d: CodeFields) => (d.units ?? []).map((u) => u.barcode).filter(Boolean);
type Codes = { barcodes: Map<string, Id<"products">>; skus: Map<string, Id<"products">> };
// ponytail: barcode/SKU uniqueness scans the business's products (primary + extraBarcodes); ceiling = CAP rows
async function loadCodes(ctx: QueryCtx, businessId: Id<"businesses">): Promise<Codes> {
  const rows = await ctx.db.query("products").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(CAP);
  const c: Codes = { barcodes: new Map(), skus: new Map() };
  for (const p of rows) addCodes(c, p._id, p);
  return c;
}
function addCodes(c: Codes, id: Id<"products">, d: CodeFields) {
  for (const b of [d.barcode, ...d.extraBarcodes, ...unitCodes(d)]) if (b) c.barcodes.set(b, id);
  if (d.sku) c.skus.set(d.sku, id);
}
function checkCodes(c: Codes, d: CodeFields, selfId?: Id<"products">) {
  const mine = [d.barcode, ...d.extraBarcodes].filter(Boolean);
  if (new Set(mine).size !== mine.length) fail("BARCODE_EXISTS");
  for (const b of mine) {
    const o = c.barcodes.get(b);
    if (o && o !== selfId) fail("BARCODE_EXISTS");
  }
  const ub = unitCodes(d);
  if (new Set([...mine, ...ub]).size !== mine.length + ub.length) fail("UNIT_BARCODE_EXISTS");
  for (const b of ub) {
    const o = c.barcodes.get(b);
    if (o && o !== selfId) fail("UNIT_BARCODE_EXISTS");
  }
  const s = d.sku ? c.skus.get(d.sku) : undefined;
  if (s && s !== selfId) fail("SKU_EXISTS");
}

async function assertProductLimit(ctx: MutationCtx, access: BusinessAccess, add = 1) {
  const max = access.plan.maxProducts;
  if (max <= 0) return;
  const live = await ctx.db
    .query("products")
    .withIndex("by_business", (q) => q.eq("businessId", access.businessId).eq("isArchived", false))
    .take(max);
  if (live.length + add > max) fail("PLAN_LIMIT_PRODUCTS");
}

/** Per product: nearest expiry among batches with stock (any) and among non-expired ones (sellable). */
async function batchInfo(ctx: QueryCtx, businessId: Id<"businesses">, now: number) {
  const m = new Map<Id<"products">, { any?: number; sellable?: number }>();
  // ponytail: first 5000 batches by expiry; fully-sold old batches could crowd this, prune zero-qty batches if so
  const bs = await ctx.db.query("batches").withIndex("by_business_expiry", (q) => q.eq("businessId", businessId)).take(CAP);
  for (const b of bs) {
    if (b.qty <= 0) continue;
    const e = m.get(b.productId) ?? {};
    e.any ??= b.expiryDate;
    if (b.expiryDate > now) e.sellable ??= b.expiryDate;
    m.set(b.productId, e);
  }
  return m;
}

const label = (p: Doc<"products">) => (p.variantLabel ? `${p.name} (${p.variantLabel})` : p.name);
const imageUrl = async (ctx: QueryCtx, id?: Id<"_storage">) => (id ? await ctx.storage.getUrl(id) : null);

export const list = query({
  args: {
    search: v.optional(v.string()),
    categoryId: v.optional(v.id("categories")),
    type: v.optional(productType),
    filter: v.optional(v.union(v.literal("LOW"), v.literal("OUT"), v.literal("EXPIRING"), v.literal("ARCHIVED"))),
  },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "inventory");
    const archived = a.filter === "ARCHIVED";
    const search = a.search?.trim().slice(0, 100);
    let rows: Doc<"products">[];
    if (search) {
      rows = await ctx.db
        .query("products")
        .withSearchIndex("search_name", (q) => q.search("name", search).eq("businessId", businessId).eq("isArchived", archived))
        .take(100);
      const byCode = await ctx.db
        .query("products")
        .withIndex("by_business_barcode", (q) => q.eq("businessId", businessId).eq("barcode", search))
        .take(20);
      const bySku = await ctx.db
        .query("products")
        .withIndex("by_business_sku", (q) => q.eq("businessId", businessId).eq("sku", search))
        .take(20);
      const byAttr = await ctx.db
        .query("products")
        .withSearchIndex("search_attrs", (q) => q.search("attrsText", search).eq("businessId", businessId).eq("isArchived", archived))
        .take(100);
      for (const p of [...byCode, ...bySku, ...byAttr]) if (p.isArchived === archived && !rows.some((r) => r._id === p._id)) rows.push(p);
    } else {
      rows = await ctx.db
        .query("products")
        .withIndex("by_business", (q) => q.eq("businessId", businessId).eq("isArchived", archived))
        .take(CAP);
    }
    if (a.categoryId) rows = rows.filter((p) => p.categoryId === a.categoryId);
    if (a.type) rows = rows.filter((p) => p.type === a.type);
    const stocked = (p: Doc<"products">) => p.type === "STOCKABLE" && !p.hasVariants;
    if (a.filter === "LOW") rows = rows.filter((p) => stocked(p) && p.stock <= p.reorderLevel);
    if (a.filter === "OUT") rows = rows.filter((p) => stocked(p) && p.stock <= 0);

    const now = Date.now();
    const info = await batchInfo(ctx, businessId, now);
    const cats = new Map(
      (await ctx.db.query("categories").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(1000)).map((c) => [c._id, c.name]),
    );
    const see = hasPermission(member, "seeCost");
    const parents = new Map<Id<"products">, string>();
    const out = [];
    for (const p of rows) {
      const nearestExpiry = p.trackExpiry ? info.get(p._id)?.any : undefined;
      if (a.filter === "EXPIRING" && (nearestExpiry === undefined || expiryStatus(nearestExpiry, now) === "OK")) continue;
      let parentName: string | undefined;
      if (p.parentId) {
        if (!parents.has(p.parentId)) parents.set(p.parentId, (await ctx.db.get(p.parentId))?.name ?? "");
        parentName = parents.get(p.parentId);
      }
      out.push({
        ...noCost(p, see),
        parentName,
        imageUrl: await imageUrl(ctx, p.imageId),
        categoryName: p.categoryId ? cats.get(p.categoryId) : undefined,
        nearestExpiry,
        expiryStatus: expiryStatus(nearestExpiry, now),
      });
    }
    return out;
  },
});

export const get = query({
  args: { productId: v.id("products") },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "inventory");
    const p = await getOwned(ctx, businessId, a.productId);
    const see = hasPermission(member, "seeCost");
    const variants = p.hasVariants
      ? await ctx.db.query("products").withIndex("by_parent", (q) => q.eq("parentId", p._id)).take(200)
      : [];
    const batches = await ctx.db.query("batches").withIndex("by_product_expiry", (q) => q.eq("productId", p._id)).take(200);
    const movements = await ctx.db.query("stockMovements").withIndex("by_product", (q) => q.eq("productId", p._id)).order("desc").take(100);
    const supplier = p.supplierId ? await ctx.db.get(p.supplierId) : null;
    return {
      product: noCost(p, see),
      imageUrl: await imageUrl(ctx, p.imageId),
      variants: variants.filter((x) => x.businessId === businessId).map((x) => noCost(x, see)),
      batches: batches.map((b) => noCost(b, see)),
      movements: movements.map((m) => {
        if (see) return m;
        const { unitCostCents: _u, ...rest } = m;
        return rest;
      }),
      supplier: supplier && supplier.businessId === businessId ? { _id: supplier._id, name: supplier.name } : null,
    };
  },
});

export const posCatalog = query({
  args: {},
  handler: async (ctx) => {
    const { businessId, business } = await requireBusiness(ctx, "pos");
    const searchable = new Set((business.attributeDefs ?? []).filter((d) => d.searchable).map((d) => d.key));
    const rows = await ctx.db
      .query("products")
      .withIndex("by_business", (q) => q.eq("businessId", businessId).eq("isArchived", false))
      .take(CAP);
    const info = await batchInfo(ctx, businessId, Date.now());
    const out = [];
    for (const p of rows) {
      if (p.hasVariants) continue;
      const sellableUntil = p.trackExpiry ? info.get(p._id)?.sellable : undefined;
      out.push({
        _id: p._id,
        name: label(p),
        barcode: p.barcode,
        extraBarcodes: p.extraBarcodes,
        sku: p.sku,
        categoryId: p.categoryId,
        unit: p.unit,
        allowDecimal: p.allowDecimal,
        type: p.type,
        priceCents: p.priceCents,
        wholesalePriceCents: p.wholesalePriceCents,
        stock: p.stock,
        trackExpiry: p.trackExpiry,
        sellableUntil,
        allExpired: p.trackExpiry && p.stock > 0 && sellableUntil === undefined,
        imageUrl: await imageUrl(ctx, p.imageId),
        units: p.units ?? [],
        trackSerial: p.trackSerial ?? false,
        warrantyMonths: p.warrantyMonths,
        attrs: p.attrs && Object.fromEntries(Object.entries(p.attrs).filter(([k]) => searchable.has(k))),
      });
    }
    return out;
  },
});

type Found = { product: Doc<"products">; unit?: NonNullable<Doc<"products">["units"]>[number] };
/** Resolve a scanned/typed code: barcode, extra barcode, unit barcode or SKU (non-archived products only). */
export async function findLocal(ctx: QueryCtx, businessId: Id<"businesses">, code: string): Promise<Found | null> {
  const c = code.trim();
  if (!c || c.length > 64) return null;
  const byCode = await ctx.db.query("products").withIndex("by_business_barcode", (q) => q.eq("businessId", businessId).eq("barcode", c)).take(5);
  const bySku = byCode.some((p) => !p.isArchived)
    ? []
    : await ctx.db.query("products").withIndex("by_business_sku", (q) => q.eq("businessId", businessId).eq("sku", c)).take(5);
  const hit = [...byCode, ...bySku].find((p) => !p.isArchived);
  if (hit) return { product: hit };
  // ponytail: extra/unit barcodes live in arrays, so this scans live products (CAP); add a barcode lookup table if a shop outgrows it
  const rows = await ctx.db.query("products").withIndex("by_business", (q) => q.eq("businessId", businessId).eq("isArchived", false)).take(CAP);
  for (const p of rows) {
    if (p.extraBarcodes.includes(c)) return { product: p };
    const unit = p.units?.find((u) => u.barcode === c);
    if (unit) return { product: p, unit };
  }
  return null;
}

export const lookupLocal = query({
  args: { code: v.string() },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "inventory").catch(() => requireBusiness(ctx, "pos"));
    const f = await findLocal(ctx, businessId, a.code);
    return f && { product: noCost(f.product, hasPermission(member, "seeCost")), unit: f.unit };
  },
});

const batchArg = v.object({ batchNo: v.string(), expiryDate: v.number() });

/** Opening stock through stockIn (the only stock writer). */
async function opening(
  ctx: MutationCtx, member: Doc<"members">, id: Id<"products">, qty: number | undefined,
  batch?: { batchNo: string; expiryDate: number },
) {
  if (qty === undefined || qty === 0) return; // NaN falls through to qtyOf, which rejects it
  const p = (await ctx.db.get(id))!;
  await stockIn(ctx, member, p, qtyOf(qty, p.allowDecimal), "OPENING", {
    batch: batch && { batchNo: optStr(batch.batchNo, 60) ?? "OPENING", expiryDate: ts(batch.expiryDate) },
    ref: "Opening stock",
  });
}

export const create = mutation({
  args: {
    ...base,
    openingStock: v.optional(v.number()),
    openingBatch: v.optional(batchArg),
    openingSerials: v.optional(v.array(v.string())),
    variants: v.optional(
      v.array(
        v.object({
          label: v.string(), sku: v.string(), barcode: v.string(), priceCents: v.number(), costCents: v.number(),
          openingStock: v.optional(v.number()),
        }),
      ),
    ),
  },
  handler: async (ctx, { openingStock, openingBatch, openingSerials, variants, ...a }) => {
    const access = await requireBusiness(ctx, "inventory");
    const { businessId, member } = access;
    const d = await clean(ctx, businessId, a);
    const vs = variants ?? [];
    if (vs.length > 100 || (vs.length && openingStock)) fail("INVALID_INPUT");
    if (d.trackSerial && vs.length) fail("INVALID_INPUT");
    if (!d.trackSerial && openingSerials?.length) fail("INVALID_INPUT");
    const serials = d.trackSerial ? await checkNewSerials(ctx, businessId, openingSerials ?? [], openingStock ?? 0) : [];
    await assertProductLimit(ctx, access, 1 + vs.length);
    const codes = await loadCodes(ctx, businessId);
    checkCodes(codes, d);
    const now = Date.now();
    const id = await ctx.db.insert("products", {
      ...d, businessId, stock: 0, hasVariants: vs.length > 0, isArchived: false, updatedAt: now,
    });
    addCodes(codes, id, d);
    await opening(ctx, member, id, openingStock, openingBatch);
    await addSerials(ctx, businessId, id, serials, d.costCents);
    await share(ctx, businessId, d);
    for (const x of vs) {
      const vd = {
        ...d, sku: optStr(x.sku, 64) ?? "", barcode: optStr(x.barcode, 64) ?? "", extraBarcodes: [] as string[],
        priceCents: cents(x.priceCents), costCents: cents(x.costCents), wholesalePriceCents: undefined,
        units: undefined, trackSerial: undefined,
      };
      checkCodes(codes, vd);
      const vid = await ctx.db.insert("products", {
        ...vd, businessId, stock: 0, parentId: id, variantLabel: str(x.label, 60), hasVariants: false, isArchived: false, updatedAt: now,
      });
      addCodes(codes, vid, vd);
      await opening(ctx, member, vid, x.openingStock, openingBatch);
    }
    await audit(ctx, member, "product.create", `${d.name}${vs.length ? ` (${vs.length} variants)` : ""}`);
    return id;
  },
});

export const update = mutation({
  args: { productId: v.id("products"), ...base },
  handler: async (ctx, { productId, ...a }) => {
    const { businessId, member } = await requireBusiness(ctx, "inventory");
    const p = await getOwned(ctx, businessId, productId);
    const d = await clean(ctx, businessId, a, p);
    if (!hasPermission(member, "seeCost")) d.costCents = p.costCents; // hidden from them, so never overwritten
    if (d.priceCents !== p.priceCents || d.costCents !== p.costCents || d.wholesalePriceCents !== p.wholesalePriceCents) {
      requirePermission(member, "editPrice");
    }
    // stock is untouchable here, so changes that would leave existing stock inconsistent are refused
    if ((d.type !== p.type || d.trackExpiry !== p.trackExpiry) && (p.stock !== 0 || p.hasVariants)) fail("INVALID_INPUT");
    if (!d.allowDecimal && !Number.isInteger(p.stock)) fail("INVALID_INPUT");
    // serial tracking can only be switched while there is no stock to account for
    if (d.trackSerial !== (p.trackSerial ?? false) && (p.stock !== 0 || p.hasVariants)) fail("INVALID_INPUT");
    if (d.trackSerial && p.hasVariants) fail("INVALID_INPUT");
    checkCodes(await loadCodes(ctx, businessId), d, p._id);
    await ctx.db.patch(p._id, { ...d, updatedAt: Date.now() });
    await share(ctx, businessId, d);
    if (p.hasVariants && d.name !== p.name) {
      for (const c of await ctx.db.query("products").withIndex("by_parent", (q) => q.eq("parentId", p._id)).take(200)) {
        await ctx.db.patch(c._id, { name: d.name });
      }
    }
    await audit(ctx, member, "product.update", d.name);
  },
});

export const addVariant = mutation({
  args: {
    parentId: v.id("products"), label: v.string(), sku: v.string(), barcode: v.string(),
    priceCents: v.number(), costCents: v.number(),
  },
  handler: async (ctx, a) => {
    const access = await requireBusiness(ctx, "inventory");
    const { businessId, member } = access;
    const parent = await getOwned(ctx, businessId, a.parentId);
    if (parent.parentId || parent.isArchived || parent.trackSerial || (!parent.hasVariants && parent.stock !== 0)) fail("INVALID_INPUT");
    await assertProductLimit(ctx, access);
    const d = {
      sku: optStr(a.sku, 64) ?? "", barcode: optStr(a.barcode, 64) ?? "", extraBarcodes: [] as string[],
      priceCents: cents(a.priceCents), costCents: cents(a.costCents),
    };
    checkCodes(await loadCodes(ctx, businessId), d);
    const { _id, _creationTime, wholesalePriceCents: _w, ...rest } = parent;
    const id = await ctx.db.insert("products", {
      ...rest, ...d, stock: 0, parentId: _id, variantLabel: str(a.label, 60), hasVariants: false, units: undefined, updatedAt: Date.now(),
    });
    if (!parent.hasVariants) await ctx.db.patch(_id, { hasVariants: true, updatedAt: Date.now() });
    await audit(ctx, member, "product.addVariant", `${parent.name} / ${a.label}`);
    return id;
  },
});

export const archive = mutation({
  args: { productId: v.id("products"), archived: v.boolean() },
  handler: async (ctx, a) => {
    const access = await requireBusiness(ctx, "inventory");
    const p = await getOwned(ctx, access.businessId, a.productId);
    if (!a.archived && p.isArchived) await assertProductLimit(ctx, access);
    await ctx.db.patch(p._id, { isArchived: a.archived, updatedAt: Date.now() });
    await audit(ctx, access.member, a.archived ? "product.archive" : "product.unarchive", p.name);
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireBusiness(ctx, "inventory");
    return await ctx.storage.generateUploadUrl();
  },
});

export const exportCsv = query({
  args: {},
  handler: async (ctx) => {
    const { businessId, member } = await requireBusiness(ctx, "inventory");
    const see = hasPermission(member, "seeCost");
    const rows = await ctx.db
      .query("products")
      .withIndex("by_business", (q) => q.eq("businessId", businessId).eq("isArchived", false))
      .take(CAP);
    const cats = new Map(
      (await ctx.db.query("categories").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(1000)).map((c) => [c._id, c.name]),
    );
    return rows
      .filter((p) => !p.hasVariants)
      .map((p) =>
        noCost(
          {
            name: label(p), sku: p.sku, barcode: p.barcode, category: p.categoryId ? (cats.get(p.categoryId) ?? "") : "",
            brand: p.brand, unit: p.unit, costCents: p.costCents, priceCents: p.priceCents,
            wholesalePriceCents: p.wholesalePriceCents ?? null, stock: p.stock, reorderLevel: p.reorderLevel,
          },
          see,
        ),
      );
  },
});

const importRow = v.object({
  name: v.string(), sku: v.string(), barcode: v.string(), category: v.string(), brand: v.string(), unit: v.string(),
  costCents: v.number(), priceCents: v.number(), wholesalePriceCents: v.optional(v.number()),
  stock: v.number(), reorderLevel: v.number(),
});

export const importCsv = mutation({
  args: { rows: v.array(importRow) },
  handler: async (ctx, a) => {
    const access = await requireBusiness(ctx, "inventory");
    const { businessId, member } = access;
    if (a.rows.length > 500) fail("INVALID_INPUT");
    const codes = await loadCodes(ctx, businessId);
    const cats = new Map(
      (await ctx.db.query("categories").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(1000)).map((c) => [c.name.toLowerCase(), c._id]),
    );
    let room = Infinity;
    if (access.plan.maxProducts > 0) {
      const live = await ctx.db
        .query("products")
        .withIndex("by_business", (q) => q.eq("businessId", businessId).eq("isArchived", false))
        .take(access.plan.maxProducts);
      room = access.plan.maxProducts - live.length;
    }
    let created = 0;
    const skipped: { row: number; reason: string }[] = [];
    for (const [i, r] of a.rows.entries()) {
      try {
        // every check runs before the first write of the row, so a skipped row leaves nothing behind
        if (room <= 0) fail("PLAN_LIMIT_PRODUCTS");
        if (!Number.isFinite(r.stock) || r.stock < 0 || r.stock > 1e9) fail("INVALID_INPUT");
        const catName = optStr(r.category, 60);
        const d = await clean(ctx, businessId, {
          type: "STOCKABLE", name: r.name, sku: r.sku, barcode: r.barcode, extraBarcodes: [], brand: r.brand,
          unit: optStr(r.unit, 30) ?? "pcs", allowDecimal: !Number.isInteger(r.stock), costCents: r.costCents,
          priceCents: r.priceCents, wholesalePriceCents: r.wholesalePriceCents, reorderLevel: r.reorderLevel, trackExpiry: false,
        });
        checkCodes(codes, d);
        let categoryId = catName ? cats.get(catName.toLowerCase()) : undefined;
        if (catName && !categoryId) {
          categoryId = await ctx.db.insert("categories", { businessId, name: catName });
          cats.set(catName.toLowerCase(), categoryId);
        }
        const id = await ctx.db.insert("products", {
          ...d, categoryId, businessId, stock: 0, hasVariants: false, isArchived: false, updatedAt: Date.now(),
        });
        addCodes(codes, id, d);
        await opening(ctx, member, id, r.stock);
        room--;
        created++;
      } catch (e) {
        const code = (e as { data?: unknown }).data;
        if (typeof code !== "string") throw e;
        skipped.push({ row: i + 1, reason: code });
      }
    }
    await audit(ctx, member, "product.import", `${created} created, ${skipped.length} skipped`);
    return { created, skipped };
  },
});
