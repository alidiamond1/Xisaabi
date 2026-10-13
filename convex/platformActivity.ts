import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { requirePlatform } from "./lib/access";
import { ts } from "./lib/validate";

// Every module that appears as the prefix of an audit `action`.
const MODULES = [
  "announcement", "barcode", "billing", "business", "catalog", "category", "customer", "expense", "expiry",
  "inventory", "payment", "plan", "platformSettings", "platformStaff", "product", "purchase", "sale", "serial",
  "settings", "shift", "staff", "supplier", "ticket",
];

export const modules = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatform(ctx);
    return MODULES;
  },
});

export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    businessId: v.optional(v.id("businesses")),
    module: v.optional(v.string()),
    actorMemberId: v.optional(v.id("members")),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    await requirePlatform(ctx);
    const { businessId, module, actorMemberId } = a;
    const from = a.from === undefined ? 0 : ts(a.from);
    const to = a.to === undefined ? 4.1e12 : ts(a.to);
    // best index first (business > actor > module > time); the other equality filters run after it
    const q = ctx.db.query("auditLog");
    const ranged = businessId
      ? q.withIndex("by_business", (x) => x.eq("businessId", businessId).gte("createdAt", from).lte("createdAt", to))
      : actorMemberId
        ? q.withIndex("by_actor", (x) => x.eq("actorMemberId", actorMemberId).gte("createdAt", from).lte("createdAt", to))
        : module
          ? q.withIndex("by_module", (x) => x.eq("module", module).gte("createdAt", from).lte("createdAt", to))
          : q.withIndex("by_created", (x) => x.gte("createdAt", from).lte("createdAt", to));
    const res = await ranged
      .order("desc")
      .filter((f) =>
        f.and(
          businessId && actorMemberId ? f.eq(f.field("actorMemberId"), actorMemberId) : true,
          (businessId || actorMemberId) && module ? f.eq(f.field("module"), module) : true,
        ),
      )
      .paginate(a.paginationOpts);
    const names = new Map<Id<"businesses">, string | null>();
    for (const r of res.page) {
      if (r.businessId && !names.has(r.businessId)) names.set(r.businessId, (await ctx.db.get(r.businessId))?.name ?? null);
    }
    return { ...res, page: res.page.map((r) => ({ ...r, businessName: r.businessId ? (names.get(r.businessId) ?? null) : null })) };
  },
});
