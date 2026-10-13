import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getOwned, requireBusiness } from "./lib/access";
import { str } from "./lib/validate";

const OPTS = { allowLocked: true };

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { businessId } = await requireBusiness(ctx, "support", OPTS);
    return await ctx.db
      .query("tickets")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .order("desc")
      .take(500);
  },
});

export const get = query({
  args: { ticketId: v.id("tickets") },
  handler: async (ctx, a) => {
    const { businessId } = await requireBusiness(ctx, "support", OPTS);
    const ticket = await getOwned(ctx, businessId, a.ticketId);
    const messages = await ctx.db
      .query("ticketMessages")
      .withIndex("by_ticket", (q) => q.eq("ticketId", ticket._id))
      .take(1000);
    return { ticket, messages };
  },
});

export const markRead = mutation({
  args: { ticketId: v.id("tickets") },
  handler: async (ctx, a) => {
    const { businessId } = await requireBusiness(ctx, "support", OPTS);
    const t = await getOwned(ctx, businessId, a.ticketId);
    if (t.unreadByBusiness) await ctx.db.patch(t._id, { unreadByBusiness: false });
  },
});

export const create = mutation({
  args: {
    subject: v.string(),
    category: v.union(
      v.literal("BILLING"),
      v.literal("TECHNICAL"),
      v.literal("FEATURE_REQUEST"),
      v.literal("OTHER"),
    ),
    priority: v.union(v.literal("LOW"), v.literal("NORMAL"), v.literal("HIGH")),
    body: v.string(),
  },
  handler: async (ctx, a) => {
    const { member, businessId } = await requireBusiness(ctx, "support", OPTS);
    const subject = str(a.subject);
    const body = str(a.body, 5000);
    const now = Date.now();
    const ticketId = await ctx.db.insert("tickets", {
      businessId,
      subject,
      category: a.category,
      priority: a.priority,
      status: "OPEN",
      createdBy: member._id,
      unreadByPlatform: true,
      unreadByBusiness: false,
      lastMessageAt: now,
      createdAt: now,
    });
    await ctx.db.insert("ticketMessages", {
      ticketId,
      businessId,
      authorMemberId: member._id,
      authorName: member.fullName,
      fromPlatform: false,
      body,
      createdAt: now,
    });
    return ticketId;
  },
});

export const reply = mutation({
  args: { ticketId: v.id("tickets"), body: v.string() },
  handler: async (ctx, a) => {
    const { member, businessId } = await requireBusiness(ctx, "support", OPTS);
    const t = await getOwned(ctx, businessId, a.ticketId);
    const body = str(a.body, 5000);
    const now = Date.now();
    await ctx.db.insert("ticketMessages", {
      ticketId: t._id,
      businessId,
      authorMemberId: member._id,
      authorName: member.fullName,
      fromPlatform: false,
      body,
      createdAt: now,
    });
    await ctx.db.patch(t._id, { status: "OPEN", unreadByPlatform: true, lastMessageAt: now });
  },
});

export const close = mutation({
  args: { ticketId: v.id("tickets") },
  handler: async (ctx, a) => {
    const { businessId } = await requireBusiness(ctx, "support", OPTS);
    const t = await getOwned(ctx, businessId, a.ticketId);
    await ctx.db.patch(t._id, { status: "CLOSED" });
  },
});
