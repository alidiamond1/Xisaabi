import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { audit, fail, requirePlatform } from "./lib/access";
import { str } from "./lib/validate";

const status = v.union(v.literal("OPEN"), v.literal("ANSWERED"), v.literal("CLOSED"));

export const list = query({
  args: { status: v.optional(status) },
  handler: async (ctx, a) => {
    await requirePlatform(ctx);
    const { status: st } = a;
    const tickets: Doc<"tickets">[] = st
      ? await ctx.db
          .query("tickets")
          .withIndex("by_status", (q) => q.eq("status", st))
          .order("desc")
          .take(500)
      : await ctx.db.query("tickets").order("desc").take(500);
    tickets.sort((x, y) => y.lastMessageAt - x.lastMessageAt);
    const names = new Map<string, string>();
    for (const t of tickets) {
      if (!names.has(t.businessId)) names.set(t.businessId, (await ctx.db.get(t.businessId))?.name ?? "?");
    }
    return tickets.map((t) => ({ ...t, businessName: names.get(t.businessId)! }));
  },
});

export const get = query({
  args: { ticketId: v.id("tickets") },
  handler: async (ctx, a) => {
    await requirePlatform(ctx);
    const ticket = await ctx.db.get(a.ticketId);
    if (!ticket) fail("NOT_FOUND");
    const business = await ctx.db.get(ticket.businessId);
    const messages = await ctx.db
      .query("ticketMessages")
      .withIndex("by_ticket", (q) => q.eq("ticketId", ticket._id))
      .take(1000);
    return { ticket, businessName: business?.name ?? "?", messages };
  },
});

export const reply = mutation({
  args: { ticketId: v.id("tickets"), body: v.string() },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const t = await ctx.db.get(a.ticketId);
    if (!t) fail("NOT_FOUND");
    const body = str(a.body, 5000);
    const now = Date.now();
    await ctx.db.insert("ticketMessages", {
      ticketId: t._id,
      businessId: t.businessId,
      authorMemberId: me._id,
      authorName: me.fullName,
      fromPlatform: true,
      body,
      createdAt: now,
    });
    await ctx.db.patch(t._id, { status: "ANSWERED", unreadByBusiness: true, unreadByPlatform: false, lastMessageAt: now });
    await audit(ctx, me, "ticket.reply", t.subject, t.businessId);
  },
});

export const setStatus = mutation({
  args: { ticketId: v.id("tickets"), status },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const t = await ctx.db.get(a.ticketId);
    if (!t) fail("NOT_FOUND");
    await ctx.db.patch(t._id, { status: a.status });
    await audit(ctx, me, "ticket.setStatus", `${t.subject} -> ${a.status}`, t.businessId);
  },
});

export const markRead = mutation({
  args: { ticketId: v.id("tickets") },
  handler: async (ctx, a) => {
    await requirePlatform(ctx);
    const t = await ctx.db.get(a.ticketId);
    if (!t) fail("NOT_FOUND");
    if (t.unreadByPlatform) await ctx.db.patch(t._id, { unreadByPlatform: false });
  },
});
