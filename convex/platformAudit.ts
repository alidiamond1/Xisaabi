import { v } from "convex/values";
import { query } from "./_generated/server";
import { requirePlatform } from "./lib/access";

export const list = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, a) => {
    await requirePlatform(ctx);
    const { businessId } = a;
    return businessId
      ? await ctx.db
          .query("auditLog")
          .withIndex("by_business", (q) => q.eq("businessId", businessId))
          .order("desc")
          .take(200)
      : await ctx.db.query("auditLog").withIndex("by_created").order("desc").take(200);
  },
});
