import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { audit, diff, fail, requirePlatform } from "./lib/access";
import { cents, str } from "./lib/validate";
import { moduleKey } from "./schema";

const fields = {
  name: v.string(),
  description: v.string(),
  priceCents: v.number(),
  trialDays: v.number(),
  maxUsers: v.number(),
  maxProducts: v.number(),
  modules: v.array(moduleKey),
  features: v.array(v.string()),
  isDefaultTrial: v.boolean(),
  isActive: v.boolean(),
  sortOrder: v.number(),
};

function clean(a: {
  name: string;
  description: string;
  priceCents: number;
  trialDays: number;
  maxUsers: number;
  maxProducts: number;
  modules: Doc_modules;
  features: string[];
  isDefaultTrial: boolean;
  isActive: boolean;
  sortOrder: number;
}) {
  if (a.features.length > 30) fail("INVALID_INPUT");
  if (!Number.isInteger(a.sortOrder) || Math.abs(a.sortOrder) > 1e6) fail("INVALID_INPUT");
  return {
    name: str(a.name),
    description: str(a.description, 500),
    priceCents: cents(a.priceCents),
    trialDays: cents(a.trialDays),
    maxUsers: cents(a.maxUsers),
    maxProducts: cents(a.maxProducts),
    modules: [...new Set(a.modules)],
    features: a.features.map((f) => str(f)),
    isDefaultTrial: a.isDefaultTrial,
    isActive: a.isActive,
    sortOrder: a.sortOrder,
  };
}
type Doc_modules = Array<typeof moduleKey.type>;

async function unsetOtherDefaults(ctx: MutationCtx, keep: Id<"plans">) {
  for (const p of await ctx.db.query("plans").collect()) {
    if (p._id !== keep && p.isDefaultTrial) await ctx.db.patch(p._id, { isDefaultTrial: false });
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatform(ctx);
    return await ctx.db.query("plans").withIndex("by_sort").collect();
  },
});

export const create = mutation({
  args: fields,
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx, ["SUPER_ADMIN"]);
    const data = clean(a);
    const id = await ctx.db.insert("plans", data);
    if (data.isDefaultTrial) await unsetOtherDefaults(ctx, id);
    await audit(ctx, me, "plan.create", data.name);
    return id;
  },
});

export const update = mutation({
  args: { planId: v.id("plans"), ...fields },
  handler: async (ctx, { planId, ...a }) => {
    const me = await requirePlatform(ctx, ["SUPER_ADMIN"]);
    const existing = await ctx.db.get(planId);
    if (!existing) fail("NOT_FOUND");
    const data = clean(a);
    // signups need a default trial plan: move the flag by setting it on another plan
    if (existing.isDefaultTrial && !data.isDefaultTrial) fail("INVALID_INPUT");
    await ctx.db.replace(planId, data);
    if (data.isDefaultTrial) await unsetOtherDefaults(ctx, planId);
    await audit(ctx, me, "plan.update", data.name, undefined, {
      targetId: planId,
      targetName: data.name,
      changes: diff(existing, data, Object.keys(data)),
    });
  },
});

export const setActive = mutation({
  args: { planId: v.id("plans"), isActive: v.boolean() },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx, ["SUPER_ADMIN"]);
    const p = await ctx.db.get(a.planId);
    if (!p) fail("NOT_FOUND");
    if (p.isDefaultTrial && !a.isActive) fail("INVALID_INPUT");
    await ctx.db.patch(p._id, { isActive: a.isActive });
    await audit(ctx, me, a.isActive ? "plan.activate" : "plan.deactivate", p.name);
  },
});
