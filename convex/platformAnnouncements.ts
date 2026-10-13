import { v, type ObjectType } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { audit, diff, fail, requirePlatform } from "./lib/access";
import { str, ts } from "./lib/validate";

const fields = {
  title: v.string(),
  body: v.string(),
  level: v.union(v.literal("INFO"), v.literal("WARNING"), v.literal("SUCCESS")),
  audience: v.object({ planIds: v.array(v.id("plans")), businessTypes: v.array(v.string()) }),
  startsAt: v.number(),
  endsAt: v.optional(v.number()),
  isActive: v.boolean(),
};

async function clean(ctx: MutationCtx, a: ObjectType<typeof fields>) {
  if (a.audience.planIds.length > 20 || a.audience.businessTypes.length > 20) fail("INVALID_INPUT");
  for (const id of a.audience.planIds) if (!(await ctx.db.get(id))) fail("NOT_FOUND");
  const endsAt = a.endsAt === undefined ? undefined : ts(a.endsAt);
  const startsAt = ts(a.startsAt);
  if (endsAt !== undefined && endsAt <= startsAt) fail("INVALID_INPUT");
  return {
    title: str(a.title, 120),
    body: str(a.body, 2000),
    level: a.level,
    audience: { planIds: [...new Set(a.audience.planIds)], businessTypes: [...new Set(a.audience.businessTypes.map((t) => str(t, 40)))] },
    startsAt,
    endsAt,
    isActive: a.isActive,
  };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatform(ctx);
    return await ctx.db.query("announcements").withIndex("by_created").order("desc").take(200);
  },
});

export const create = mutation({
  args: fields,
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const data = await clean(ctx, a);
    const id = await ctx.db.insert("announcements", { ...data, createdBy: me._id, createdAt: Date.now() });
    await audit(ctx, me, "announcement.create", data.title, undefined, { targetId: id, targetName: data.title });
    return id;
  },
});

export const update = mutation({
  args: { announcementId: v.id("announcements"), ...fields },
  handler: async (ctx, { announcementId, ...a }) => {
    const me = await requirePlatform(ctx);
    const cur = await ctx.db.get(announcementId);
    if (!cur) fail("NOT_FOUND");
    const data = await clean(ctx, a);
    await ctx.db.patch(cur._id, data);
    await audit(ctx, me, "announcement.update", data.title, undefined, {
      targetId: cur._id,
      targetName: data.title,
      changes: diff(cur, data, Object.keys(data)),
    });
  },
});

export const remove = mutation({
  args: { announcementId: v.id("announcements") },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const cur = await ctx.db.get(a.announcementId);
    if (!cur) fail("NOT_FOUND");
    await ctx.db.delete(cur._id);
    await audit(ctx, me, "announcement.remove", cur.title, undefined, { targetId: cur._id, targetName: cur.title });
  },
});
