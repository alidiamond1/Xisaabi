import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { audit, diff, fail, getOwned, requireBusiness } from "./lib/access";
import { cents, optStr, posInt, str, ts } from "./lib/validate";
import { DAY_MS } from "./shared/expiry";
import { openShiftOf } from "./shifts";

type Customer = Doc<"customers">;
const MGR = { roles: ["OWNER" as const, "MANAGER" as const] };
const group = v.union(v.literal("RETAIL"), v.literal("WHOLESALE"), v.literal("VIP"));
const MAX = 1e12;

const fields = {
  fullName: v.string(),
  phone: v.string(),
  whatsapp: v.string(),
  type: v.union(v.literal("INDIVIDUAL"), v.literal("COMPANY")),
  companyName: v.string(),
  group,
  address: v.string(),
  district: v.string(),
  notes: v.string(),
  creditLimitCents: v.number(),
};
type Fields = {
  fullName: string; phone: string; whatsapp: string; type: "INDIVIDUAL" | "COMPANY"; companyName: string;
  group: Customer["group"]; address: string; district: string; notes: string; creditLimitCents: number;
};

const signed = (n: number) => {
  if (!Number.isInteger(n) || Math.abs(n) > MAX) fail("INVALID_INPUT");
  return n;
};

/** Validated text/contact fields (empty allowed except the name). */
const text = (a: Fields) => ({
  fullName: str(a.fullName),
  phone: optStr(a.phone, 50) ?? "",
  whatsapp: optStr(a.whatsapp, 50) ?? "",
  type: a.type,
  companyName: optStr(a.companyName) ?? "",
  address: optStr(a.address) ?? "",
  district: optStr(a.district) ?? "",
  notes: optStr(a.notes, 1000) ?? "",
});

/** Move a customer's balance and write the ledger row. delta > 0 adds debt. */
async function post(
  ctx: MutationCtx,
  member: Doc<"members">,
  c: Customer,
  type: Doc<"ledger">["type"],
  delta: number,
  o: { method?: Doc<"ledger">["method"]; reference?: string; note?: string; shiftId?: Id<"shifts"> } = {},
) {
  const now = Date.now();
  const balanceAfterCents = c.balanceCents + delta;
  await ctx.db.patch(c._id, { balanceCents: balanceAfterCents, ...(type === "PAYMENT" ? { lastPaymentAt: now } : {}) });
  const ledgerId = await ctx.db.insert("ledger", {
    businessId: c.businessId,
    customerId: c._id,
    type,
    amountCents: Math.abs(delta),
    balanceAfterCents,
    ...o,
    createdBy: member._id,
    createdAt: now,
  });
  return { ledgerId, balanceAfterCents };
}

const daysSince = (c: Customer, now: number) => (c.lastPaymentAt === undefined ? null : Math.floor((now - c.lastPaymentAt) / DAY_MS));

export const list = query({
  args: {
    search: v.optional(v.string()),
    group: v.optional(group),
    filter: v.optional(v.union(v.literal("DEBT"), v.literal("OVER_LIMIT"), v.literal("OVERDUE"), v.literal("BLOCKED"))),
  },
  handler: async (ctx, a) => {
    const { businessId } = await requireBusiness(ctx, "customers");
    const s = a.search?.trim().slice(0, 100);
    let rows: Customer[];
    if (!s) {
      // ponytail: first 1000 customers; paginate if a shop outgrows it
      rows = await ctx.db.query("customers").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(1000);
    } else {
      const byName = await ctx.db
        .query("customers")
        .withSearchIndex("search_name", (q) => q.search("fullName", s).eq("businessId", businessId))
        .take(50);
      const byPhone = await ctx.db
        .query("customers")
        .withIndex("by_business_phone", (q) => q.eq("businessId", businessId).gte("phone", s).lt("phone", s + "￿"))
        .take(50);
      rows = [...new Map([...byName, ...byPhone].map((c) => [c._id, c])).values()];
    }
    const now = Date.now();
    const overdue = (c: Customer) => c.balanceCents > 0 && now - (c.lastPaymentAt ?? c.createdAt) > 30 * DAY_MS;
    return rows
      .filter((c) => !a.group || c.group === a.group)
      .filter((c) => {
        switch (a.filter) {
          case "DEBT": return c.balanceCents > 0;
          case "OVER_LIMIT": return c.balanceCents > c.creditLimitCents;
          case "OVERDUE": return overdue(c);
          case "BLOCKED": return c.creditBlocked;
          default: return true;
        }
      })
      .map((c) => ({ ...c, daysSinceLastPayment: daysSince(c, now) }));
  },
});

export const get = query({
  args: { customerId: v.id("customers") },
  handler: async (ctx, a) => {
    const { businessId } = await requireBusiness(ctx, "customers");
    const customer = await getOwned(ctx, businessId, a.customerId);
    const ledger = await ctx.db.query("ledger").withIndex("by_customer", (q) => q.eq("customerId", customer._id)).order("desc").take(200);
    const sales = await ctx.db.query("sales").withIndex("by_customer", (q) => q.eq("customerId", customer._id)).order("desc").take(50);
    return {
      customer,
      ledger,
      // no cost data: cashiers use this screen too
      sales: sales.map((s) => ({
        _id: s._id, receiptNo: s.receiptNo, totalCents: s.totalCents, refundedCents: s.refundedCents,
        status: s.status, payments: s.payments, createdAt: s.createdAt,
      })),
    };
  },
});

async function insertCustomer(
  ctx: MutationCtx, member: Doc<"members">, businessId: Id<"businesses">, base: ReturnType<typeof text>,
  grp: Customer["group"], creditLimitCents: number, opening: number,
) {
  const id = await ctx.db.insert("customers", {
    businessId, ...base, group: grp, creditLimitCents, creditBlocked: false, balanceCents: opening, createdAt: Date.now(),
  });
  if (opening !== 0) {
    await ctx.db.insert("ledger", {
      businessId, customerId: id, type: "OPENING", amountCents: Math.abs(opening), balanceAfterCents: opening,
      note: "Opening balance", createdBy: member._id, createdAt: Date.now(),
    });
  }
  return id;
}

export const create = mutation({
  args: { ...fields, openingBalanceCents: v.number() },
  handler: async (ctx, a) => {
    const { businessId, member, role } = await requireBusiness(ctx, "customers");
    const base = text(a);
    const limit = cents(a.creditLimitCents);
    const opening = signed(a.openingBalanceCents);
    // credit and pricing group are granted by OWNER/MANAGER only; cashier-created customers start plain
    if (role === "CASHIER" && opening !== 0) fail("FORBIDDEN");
    const id = await insertCustomer(
      ctx, member, businessId, base, role === "CASHIER" ? "RETAIL" : a.group, role === "CASHIER" ? 0 : limit, opening,
    );
    await audit(ctx, member, "customer.create", base.fullName);
    return id;
  },
});

export const update = mutation({
  args: { customerId: v.id("customers"), ...fields },
  handler: async (ctx, a) => {
    const { businessId, member, role } = await requireBusiness(ctx, "customers");
    const c = await getOwned(ctx, businessId, a.customerId);
    const limit = cents(a.creditLimitCents);
    // credit limit and group are risk/pricing controls: cashiers must not change them
    if (role === "CASHIER" && (limit !== c.creditLimitCents || a.group !== c.group)) fail("FORBIDDEN");
    const next = { ...text(a), group: a.group, creditLimitCents: limit };
    await ctx.db.patch(c._id, next);
    await audit(ctx, member, "customer.update", c.fullName, undefined, {
      targetId: c._id,
      targetName: c.fullName,
      changes: diff(c, next, Object.keys(next)),
    });
  },
});

export const setCreditBlocked = mutation({
  args: { customerId: v.id("customers"), blocked: v.boolean() },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "customers", MGR);
    const c = await getOwned(ctx, businessId, a.customerId);
    await ctx.db.patch(c._id, { creditBlocked: a.blocked });
    await audit(ctx, member, a.blocked ? "customer.block" : "customer.unblock", c.fullName);
  },
});

export const recordPayment = mutation({
  args: {
    customerId: v.id("customers"),
    amountCents: v.number(),
    method: v.union(v.literal("CASH"), v.literal("EVC"), v.literal("ZAAD"), v.literal("EDAHAB"), v.literal("BANK")),
    reference: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "customers");
    const c = await getOwned(ctx, businessId, a.customerId);
    const amount = posInt(a.amountCents, MAX);
    if (amount > c.balanceCents) fail("PAYMENT_EXCEEDS_BALANCE");
    const r = await post(ctx, member, c, "PAYMENT", -amount, {
      method: a.method, reference: optStr(a.reference, 100), note: optStr(a.note, 500),
      shiftId: a.method === "CASH" ? (await openShiftOf(ctx, member._id))?._id : undefined,
    });
    await audit(ctx, member, "customer.payment", `${c.fullName} ${amount} ${a.method}`);
    return r;
  },
});

export const adjustBalance = mutation({
  args: { customerId: v.id("customers"), direction: v.union(v.literal("UP"), v.literal("DOWN")), amountCents: v.number(), note: v.string() },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "customers", MGR);
    const c = await getOwned(ctx, businessId, a.customerId);
    const amount = posInt(a.amountCents, MAX);
    const note = a.note.trim();
    if (!note) fail("REASON_REQUIRED");
    if (note.length > 500) fail("INVALID_INPUT");
    const up = a.direction === "UP";
    const r = await post(ctx, member, c, up ? "ADJUST_UP" : "ADJUST_DOWN", up ? amount : -amount, { note });
    await audit(ctx, member, up ? "customer.adjustUp" : "customer.adjustDown", `${c.fullName} ${amount}: ${note}`);
    return r;
  },
});

export const writeOff = mutation({
  args: { customerId: v.id("customers"), note: v.string() },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "customers", { roles: ["OWNER"] });
    const c = await getOwned(ctx, businessId, a.customerId);
    const note = a.note.trim();
    if (!note) fail("REASON_REQUIRED");
    if (note.length > 500 || c.balanceCents <= 0) fail("INVALID_INPUT");
    const r = await post(ctx, member, c, "WRITE_OFF", -c.balanceCents, { note });
    await audit(ctx, member, "customer.writeOff", `${c.fullName} ${c.balanceCents}: ${note}`);
    return r;
  },
});

export const statement = query({
  args: { customerId: v.id("customers"), from: v.number(), to: v.number() },
  handler: async (ctx, a) => {
    const { businessId, business } = await requireBusiness(ctx, "customers");
    const customer = await getOwned(ctx, businessId, a.customerId);
    ts(a.from);
    ts(a.to);
    if (a.to < a.from) fail("INVALID_INPUT");
    const before = await ctx.db
      .query("ledger")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id).lt("createdAt", a.from))
      .order("desc")
      .first();
    const rows = await ctx.db
      .query("ledger")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id).gte("createdAt", a.from).lte("createdAt", a.to))
      .take(1000);
    const openingBalanceCents = before?.balanceAfterCents ?? 0;
    let prev = openingBalanceCents;
    const out = rows.map((r) => {
      const deltaCents = r.balanceAfterCents - prev;
      prev = r.balanceAfterCents;
      return { ...r, deltaCents };
    });
    return {
      customer,
      business: {
        name: business.name, phone: business.phone, address: business.address, city: business.city,
        currency: business.currency, logoUrl: business.logoId ? await ctx.storage.getUrl(business.logoId) : null,
      },
      openingBalanceCents,
      rows: out,
      closingBalanceCents: prev,
    };
  },
});

export const exportCsv = query({
  args: {},
  handler: async (ctx) => {
    const { businessId } = await requireBusiness(ctx, "customers", MGR);
    const rows = await ctx.db.query("customers").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(5000);
    return rows.map((c) => ({
      fullName: c.fullName, phone: c.phone, whatsapp: c.whatsapp, type: c.type, companyName: c.companyName, group: c.group,
      address: c.address, district: c.district, creditLimitCents: c.creditLimitCents, balanceCents: c.balanceCents,
    }));
  },
});

export const importCsv = mutation({
  args: {
    rows: v.array(
      v.object({
        fullName: v.string(), phone: v.string(), group: v.optional(group),
        openingBalanceCents: v.optional(v.number()), creditLimitCents: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "customers", MGR);
    if (a.rows.length > 500) fail("INVALID_INPUT");
    const skipped: { row: number; reason: string }[] = [];
    const phones = new Set<string>();
    let created = 0;
    for (const [i, r] of a.rows.entries()) {
      const name = r.fullName.trim();
      const phone = r.phone.trim();
      const limit = r.creditLimitCents ?? 0;
      const opening = r.openingBalanceCents ?? 0;
      const bad =
        !name || name.length > 200 || phone.length > 50 ? "Invalid name or phone"
        : !Number.isInteger(limit) || limit < 0 || limit > MAX || !Number.isInteger(opening) || Math.abs(opening) > MAX ? "Invalid amount"
        : null;
      if (bad) { skipped.push({ row: i + 1, reason: bad }); continue; }
      if (phone) {
        const dup = phones.has(phone) || (await ctx.db.query("customers").withIndex("by_business_phone", (q) => q.eq("businessId", businessId).eq("phone", phone)).first());
        if (dup) { skipped.push({ row: i + 1, reason: "Phone already exists" }); continue; }
        phones.add(phone);
      }
      const base = text({ fullName: name, phone, whatsapp: "", type: "INDIVIDUAL", companyName: "", group: "RETAIL", address: "", district: "", notes: "", creditLimitCents: 0 });
      await insertCustomer(ctx, member, businessId, base, r.group ?? "RETAIL", limit, opening);
      created++;
    }
    await audit(ctx, member, "customer.import", `created=${created} skipped=${skipped.length}`);
    return { created, skipped };
  },
});
