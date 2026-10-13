import { query } from "./_generated/server";

// Public pricing page. No auth by design.
export const publicList = query({
  args: {},
  handler: async (ctx) => {
    const plans = await ctx.db.query("plans").withIndex("by_sort").collect();
    return plans.filter((p) => p.isActive);
  },
});
