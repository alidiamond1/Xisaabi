import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { audit, diff, fail, requirePlatform } from "./lib/access";
import { str } from "./lib/validate";

const status = v.union(v.literal("OPEN"), v.literal("ANSWERED"), v.literal("CLOSED"));
const priority = v.union(v.literal("LOW"), v.literal("NORMAL"), v.literal("HIGH"));

export const list = query({
  args: { status: v.optional(status), assignedTo: v.optional(v.id("members")), priority: v.optional(priority), mine: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const { status: st } = a;
    let tickets: Doc<"tickets">[] = st
      ? await ctx.db
          .query("tickets")
          .withIndex("by_status", (q) => q.eq("status", st))
          .order("desc")
          .take(500)
      : await ctx.db.query("tickets").order("desc").take(500);
    const assignee = a.mine ? me._id : a.assignedTo;
    if (assignee) tickets = tickets.filter((t) => t.assignedTo === assignee);
    if (a.priority) tickets = tickets.filter((t) => t.priority === a.priority);
    tickets.sort((x, y) => y.lastMessageAt - x.lastMessageAt);
    const names = new Map<string, string>();
    const label = async (id: Id<"businesses"> | Id<"members">) => {
      if (!names.has(id)) {
        const d = (await ctx.db.get(id as Id<"businesses">)) as { name?: string; fullName?: string } | null;
        names.set(id, d?.name ?? d?.fullName ?? "?");
      }
      return names.get(id)!;
    };
    const out = [];
    for (const t of tickets) {
      out.push({
        ...t,
        businessName: await label(t.businessId),
        assignedToName: t.assignedTo ? await label(t.assignedTo) : null,
        waitingSince: t.unreadByPlatform ? t.lastMessageAt : null,
      });
    }
    return out;
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
    await ctx.db.patch(t._id, {
      status: "ANSWERED",
      unreadByBusiness: true,
      unreadByPlatform: false,
      lastMessageAt: now,
      firstResponseAt: t.firstResponseAt ?? now,
    });
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

export const assign = mutation({
  args: { ticketId: v.id("tickets"), memberId: v.union(v.id("members"), v.null()) },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const t = await ctx.db.get(a.ticketId);
    if (!t) fail("NOT_FOUND");
    const to = a.memberId ? await ctx.db.get(a.memberId) : null;
    if (a.memberId && (!to || to.businessId || !to.isActive)) fail("NOT_FOUND"); // active platform staff only
    await ctx.db.patch(t._id, { assignedTo: a.memberId ?? undefined });
    const prev = t.assignedTo ? await ctx.db.get(t.assignedTo) : null;
    await audit(ctx, me, "ticket.assign", t.subject, t.businessId, {
      targetId: t._id,
      targetName: t.subject,
      changes: diff({ assignedTo: prev?.fullName }, { assignedTo: to?.fullName }, ["assignedTo"]),
    });
  },
});

export const setPriority = mutation({
  args: { ticketId: v.id("tickets"), priority },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx);
    const t = await ctx.db.get(a.ticketId);
    if (!t) fail("NOT_FOUND");
    await ctx.db.patch(t._id, { priority: a.priority });
    await audit(ctx, me, "ticket.setPriority", t.subject, t.businessId, {
      targetId: t._id,
      targetName: t.subject,
      changes: diff(t, { priority: a.priority }, ["priority"]),
    });
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
