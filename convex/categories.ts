import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { audit, fail, getOwned, requireBusiness } from "./lib/access";
import { str } from "./lib/validate";

export const list = query({
  args: {},
  handler: async (ctx) => {
    // inventory screens and the POS category filter both read this
    const { businessId } = await requireBusiness(ctx, "inventory").catch(() => requireBusiness(ctx, "pos"));
    const rows = await ctx.db.query("categories").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(1000);
    return rows.map((c) => ({ _id: c._id, name: c.name, parentId: c.parentId })).sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: { name: v.string(), parentId: v.optional(v.id("categories")) },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "inventory");
    const name = str(a.name, 60);
    if (a.parentId) {
      const parent = await getOwned(ctx, businessId, a.parentId);
      if (parent.parentId) fail("INVALID_INPUT"); // max 2 levels
    }
    const id = await ctx.db.insert("categories", { businessId, name, parentId: a.parentId });
    await audit(ctx, member, "category.create", name);
    return id;
  },
});

export const rename = mutation({
  args: { categoryId: v.id("categories"), name: v.string() },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "inventory");
    const c = await getOwned(ctx, businessId, a.categoryId);
    const name = str(a.name, 60);
    await ctx.db.patch(c._id, { name });
    await audit(ctx, member, "category.rename", `${c.name} -> ${name}`);
  },
});

export const remove = mutation({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, a) => {
    const { businessId, member } = await requireBusiness(ctx, "inventory");
    const c = await getOwned(ctx, businessId, a.categoryId);
    const kids = await ctx.db.query("categories").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(1000);
    if (kids.some((k) => k.parentId === c._id)) fail("CATEGORY_IN_USE");
    // ponytail: no categoryId index on products, so scan up to 5000; add by_business_category if shops outgrow it
    const prods = await ctx.db.query("products").withIndex("by_business", (q) => q.eq("businessId", businessId)).take(5000);
    if (prods.some((p) => p.categoryId === c._id)) fail("CATEGORY_IN_USE");
    await ctx.db.delete(c._id);
    await audit(ctx, member, "category.remove", c.name);
  },
});
