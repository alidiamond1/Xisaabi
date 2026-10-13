import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireBusiness } from "./lib/access";

// Banners for the app shell. Gated like support (OWNER/MANAGER, locked businesses included): cashiers don't see them.
export const active = query({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const { business } = await requireBusiness(ctx, "support", { allowLocked: true });
    const types = new Set([business.businessType, ...(business.businessTypes ?? [])]);
    const rows = await ctx.db.query("announcements").withIndex("by_created").order("desc").take(100);
    return rows
      .filter(
        (r) =>
          r.isActive &&
          r.startsAt <= now &&
          (r.endsAt === undefined || r.endsAt >= now) &&
          (r.audience.planIds.length === 0 || r.audience.planIds.includes(business.planId)) &&
          (r.audience.businessTypes.length === 0 || r.audience.businessTypes.some((t) => types.has(t))),
      )
      .slice(0, 5)
      .map((r) => ({ _id: r._id, title: r.title, body: r.body, level: r.level, startsAt: r.startsAt, endsAt: r.endsAt ?? null }));
  },
});
