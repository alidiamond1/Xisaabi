import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { audit, fail, getOwned, requireBusiness, requirePermission } from "./lib/access";
import { stockOut } from "./lib/stock";
import { str } from "./lib/validate";
import { DAY_MS } from "./shared/expiry";
import { hasPermission } from "./shared/permissions";

const status = v.union(v.literal("IN_STOCK"), v.literal("SOLD"), v.literal("RETURNED"), v.literal("WRITTEN_OFF"));
const posOrInventory = (ctx: QueryCtx) => requireBusiness(ctx, "inventory").catch(() => requireBusiness(ctx, "pos"));

const luhn = (s: string) => {
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    let d = Number(s[s.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
};

/** Trim, uppercase, drop spaces. 15 digits must pass the IMEI (Luhn) check. */
export function normSerial(raw: string): string {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9\-_./]{0,63}$/.test(s)) fail("INVALID_SERIAL");
  if (/^\d{15}$/.test(s) && !luhn(s)) fail("INVALID_SERIAL");
  return s;
}

/** Normalized, unique, not yet registered in this business; exactly `qty` of them. */
export async function checkNewSerials(ctx: QueryCtx, businessId: Id<"businesses">, raw: string[] | undefined, qty: number) {
  if (!Number.isInteger(qty) || !raw || raw.length !== qty || qty > 500) fail("SERIAL_REQUIRED");
  const list = raw.map(normSerial);
  if (new Set(list).size !== list.length) fail("SERIAL_EXISTS");
  for (const s of list) {
    const hit = await ctx.db.query("serials").withIndex("by_business_and_serial", (q) => q.eq("businessId", businessId).eq("serial", s)).first();
    if (hit) fail("SERIAL_EXISTS");
  }
  return list;
}

export async function addSerials(
  ctx: MutationCtx, businessId: Id<"businesses">, productId: Id<"products">, list: string[], costCents: number, purchaseId?: Id<"purchases">,
) {
  const createdAt = Date.now();
  for (const serial of list) {
    await ctx.db.insert("serials", { businessId, productId, serial, status: "IN_STOCK", costCents, purchaseId, createdAt });
  }
}

const hideCost = (s: Doc<"serials">, see: boolean) => {
  if (see) return s;
  const { costCents: _c, ...rest } = s;
  return rest;
};

export const list = query({
  args: { productId: v.optional(v.id("products")), status: v.optional(status), search: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "inventory");
    const search = a.search?.replace(/\s+/g, "").toUpperCase().slice(0, 64);
    let rows: Doc<"serials">[];
    if (a.productId) {
      const p = await getOwned(ctx, businessId, a.productId);
      const st = a.status;
      rows = await ctx.db
        .query("serials")
        .withIndex("by_product_and_status", (q) => (st ? q.eq("productId", p._id).eq("status", st) : q.eq("productId", p._id)))
        .order("desc")
        .take(500);
    } else if (search) {
      // prefix match on the serial
      rows = await ctx.db
        .query("serials")
        .withIndex("by_business_and_serial", (q) => q.eq("businessId", businessId).gte("serial", search).lt("serial", search + "￿"))
        .take(500);
    } else {
      rows = await ctx.db.query("serials").withIndex("by_business_and_serial", (q) => q.eq("businessId", businessId)).take(500);
    }
    rows = rows.filter((s) => s.businessId === businessId && (!a.status || s.status === a.status) && (!search || s.serial.startsWith(search)));
    const names = new Map<Id<"products">, string>();
    const see = hasPermission(member, "seeCost");
    const out = [];
    for (const s of rows) {
      if (!names.has(s.productId)) names.set(s.productId, (await ctx.db.get(s.productId))?.name ?? "");
      out.push({ ...hideCost(s, see), productName: names.get(s.productId) });
    }
    return out;
  },
});

export const lookup = query({
  args: { serial: v.string() },
  handler: async (ctx, a) => {
    const { businessId } = await posOrInventory(ctx);
    const code = a.serial.replace(/\s+/g, "").toUpperCase().slice(0, 64);
    if (!code) return null;
    const s = await ctx.db.query("serials").withIndex("by_business_and_serial", (q) => q.eq("businessId", businessId).eq("serial", code)).first();
    if (!s) return null;
    const product = await ctx.db.get(s.productId);
    const sale = s.saleId ? await ctx.db.get(s.saleId) : null;
    const customer = s.customerId ? await ctx.db.get(s.customerId) : null;
    const now = Date.now();
    const warrantyStatus = s.warrantyUntil === undefined ? ("NONE" as const) : s.warrantyUntil >= now ? ("ACTIVE" as const) : ("EXPIRED" as const);
    return {
      serial: { _id: s._id, serial: s.serial, status: s.status, soldAt: s.soldAt, warrantyUntil: s.warrantyUntil, createdAt: s.createdAt },
      product: product && product.businessId === businessId ? { _id: product._id, name: product.name, brand: product.brand } : null,
      sale: sale && sale.businessId === businessId ? { _id: sale._id, receiptNo: sale.receiptNo, createdAt: sale.createdAt } : null,
      customer: customer && customer.businessId === businessId ? { _id: customer._id, fullName: customer.fullName, phone: customer.phone } : null,
      warrantyStatus,
      daysLeft: warrantyStatus === "ACTIVE" ? Math.ceil(((s.warrantyUntil ?? now) - now) / DAY_MS) : 0,
    };
  },
});

export const available = query({
  args: { productId: v.id("products") },
  handler: async (ctx, a) => {
    const { businessId } = await requireBusiness(ctx, "pos");
    const p = await getOwned(ctx, businessId, a.productId);
    const rows = await ctx.db.query("serials").withIndex("by_product_and_status", (q) => q.eq("productId", p._id).eq("status", "IN_STOCK")).take(200);
    return rows.map((s) => ({ _id: s._id, serial: s.serial }));
  },
});

export const writeOff = mutation({
  args: { serialId: v.id("serials"), reason: v.string() },
  handler: async (ctx, a) => {
    const { businessId, member, business } = await requireBusiness(ctx, "inventory");
    requirePermission(member, "adjustStock");
    const s = await getOwned(ctx, businessId, a.serialId);
    const reason = a.reason.trim();
    if (!reason) fail("REASON_REQUIRED");
    str(reason, 500);
    if (s.status !== "IN_STOCK") fail("SERIAL_NOT_AVAILABLE");
    const p = await getOwned(ctx, businessId, s.productId);
    await stockOut(ctx, member, p, 1, "WRITE_OFF", { allowNegative: business.settings.allowNegativeStock, reason, ref: `Serial ${s.serial}` });
    await ctx.db.patch(s._id, { status: "WRITTEN_OFF" });
    await audit(ctx, member, "serial.writeOff", `${s.serial}: ${reason}`);
  },
});
