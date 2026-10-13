// Phone-as-scanner: a desktop screen creates a session (QR with `code`), the phone pushes
// scanned barcodes, the desktop reads and consumes them.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { fail, getOwned } from "./lib/access";
import { requireAnyApp } from "./lib/catalog";
import { limiter } from "./lib/limiter";
import { str } from "./lib/validate";

const SCAN_APPS = ["pos", "inventory", "purchases"] as const;
const SESSION_MS = 8 * 3_600_000;
const KEEP_MS = 2 * 86_400_000;
const BATCH = 200;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const target = v.union(v.literal("POS"), v.literal("RECEIVE"), v.literal("STOCKTAKE"), v.literal("PRODUCTS"));

function randomCode(): string {
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => ALPHABET[x & 63]).join("");
}

/** The caller's own session (creator only), loaded tenant-safely. */
async function ownSession(ctx: QueryCtx | MutationCtx, businessId: Id<"businesses">, memberId: Id<"members">, id: Id<"scanSessions">) {
  const s = await getOwned(ctx, businessId, id);
  if (s.memberId !== memberId) fail("FORBIDDEN");
  return s;
}

export const createSession = mutation({
  args: { target },
  handler: async (ctx, { target: t }) => {
    const { businessId, member } = await requireAnyApp(ctx, [...SCAN_APPS]);
    const now = Date.now();
    const prev = await ctx.db.query("scanSessions").withIndex("by_member", (q) => q.eq("memberId", member._id)).order("desc").take(20);
    for (const s of prev) if (s.active) await ctx.db.patch(s._id, { active: false });
    const code = randomCode();
    const expiresAt = now + SESSION_MS;
    const sessionId = await ctx.db.insert("scanSessions", { businessId, memberId: member._id, code, target: t, expiresAt, active: true, createdAt: now });
    return { sessionId, code, expiresAt };
  },
});

/** Pairing page info. Same business only; anything else looks like "no such session". `now` comes from the client. */
export const sessionInfo = query({
  args: { code: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, { code, now }) => {
    const { businessId } = await requireAnyApp(ctx, [...SCAN_APPS]);
    const s = await ctx.db.query("scanSessions").withIndex("by_code", (q) => q.eq("code", str(code, 32))).unique();
    if (!s || s.businessId !== businessId) return null;
    const creator = await ctx.db.get(s.memberId);
    return { target: s.target, active: s.active, expired: now !== undefined && s.expiresAt < now, expiresAt: s.expiresAt, createdBy: creator?.fullName ?? "" };
  },
});

export const push = mutation({
  args: { code: v.string(), barcode: v.string() },
  handler: async (ctx, { code, barcode }) => {
    const { businessId } = await requireAnyApp(ctx, [...SCAN_APPS]);
    const bc = str(barcode, 200);
    const s = await ctx.db.query("scanSessions").withIndex("by_code", (q) => q.eq("code", str(code, 32))).unique();
    if (!s || s.businessId !== businessId) fail("NOT_FOUND");
    const now = Date.now();
    if (!s.active || s.expiresAt < now) fail("SCAN_SESSION_INVALID");
    const { ok } = await limiter.limit(ctx, "scanPush", { key: s._id });
    if (!ok) fail("RATE_LIMITED");
    await ctx.db.insert("scans", { sessionId: s._id, businessId, barcode: bc, consumed: false, createdAt: now });
  },
});

/** Unconsumed scans, oldest first. Session creator only. */
export const pending = query({
  args: { sessionId: v.id("scanSessions") },
  handler: async (ctx, { sessionId }) => {
    const { businessId, member } = await requireAnyApp(ctx, [...SCAN_APPS]);
    await ownSession(ctx, businessId, member._id, sessionId);
    const rows = await ctx.db
      .query("scans")
      .withIndex("by_session_and_consumed", (q) => q.eq("sessionId", sessionId).eq("consumed", false))
      .take(50);
    return rows.map((r) => ({ _id: r._id, barcode: r.barcode, createdAt: r.createdAt }));
  },
});

export const consume = mutation({
  args: { scanIds: v.array(v.id("scans")) },
  handler: async (ctx, { scanIds }) => {
    const { businessId, member } = await requireAnyApp(ctx, [...SCAN_APPS]);
    if (scanIds.length > 100) fail("INVALID_INPUT");
    const owned = new Set<Id<"scanSessions">>();
    for (const id of scanIds) {
      const scan = await ctx.db.get(id);
      if (!scan || scan.businessId !== businessId) fail("NOT_FOUND");
      if (!owned.has(scan.sessionId)) {
        await ownSession(ctx, businessId, member._id, scan.sessionId);
        owned.add(scan.sessionId);
      }
      if (!scan.consumed) await ctx.db.patch(id, { consumed: true });
    }
  },
});

export const endSession = mutation({
  args: { sessionId: v.id("scanSessions") },
  handler: async (ctx, { sessionId }) => {
    const { businessId, member } = await requireAnyApp(ctx, [...SCAN_APPS]);
    const s: Doc<"scanSessions"> = await ownSession(ctx, businessId, member._id, sessionId);
    await ctx.db.patch(s._id, { active: false });
  },
});

/** Daily cron: delete scans and sessions older than 2 days in bounded batches, continuing if more remain. */
export const cleanup = internalMutation({
  args: {},
  handler: async (ctx): Promise<null> => {
    const cutoff = Date.now() - KEEP_MS;
    const scans = await ctx.db.query("scans").withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff)).take(BATCH);
    const sessions = await ctx.db.query("scanSessions").withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff)).take(BATCH);
    for (const r of scans) await ctx.db.delete(r._id);
    for (const r of sessions) await ctx.db.delete(r._id);
    if (scans.length === BATCH || sessions.length === BATCH) await ctx.scheduler.runAfter(0, internal.scanner.cleanup, {});
    return null;
  },
});
