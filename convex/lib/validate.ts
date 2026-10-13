// Input validation helpers. All failures → INVALID_INPUT.
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { fail } from "./access";

/** Trimmed, non-empty, ≤ max chars. */
export function str(s: string, max = 200): string {
  const t = s.trim();
  if (!t || t.length > max) fail("INVALID_INPUT");
  return t;
}

/** Trimmed; empty/undefined → undefined; too long → INVALID_INPUT. */
export function optStr(s: string | undefined, max = 200): string | undefined {
  const t = s?.trim();
  if (!t) return undefined;
  if (t.length > max) fail("INVALID_INPUT");
  return t;
}

/** Integer >= 0 (money in cents, stock...). */
export function cents(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 1e12) fail("INVALID_INPUT");
  return n;
}

/** Integer >= 1. */
export function posInt(n: number, max = 1e9): number {
  if (!Number.isInteger(n) || n < 1 || n > max) fail("INVALID_INPUT");
  return n;
}

/** Epoch ms. */
export function ts(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 4.1e12) fail("INVALID_INPUT");
  return n;
}

/** Logo upload must be a small image that no OTHER business already uses (storage ids are not secrets once shown in a URL). */
export async function checkLogo(ctx: QueryCtx, logoId: Id<"_storage">, businessId?: Id<"businesses">) {
  const f = await ctx.db.system.get(logoId);
  if (!f || (f.contentType && !f.contentType.startsWith("image/")) || f.size > 5_000_000) fail("INVALID_INPUT");
  const used = await ctx.db.query("businesses").withIndex("by_logo", (q) => q.eq("logoId", logoId)).first();
  if (used && used._id !== businessId) fail("INVALID_INPUT");
}
