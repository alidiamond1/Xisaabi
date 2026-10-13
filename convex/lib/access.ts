// THE tenant-isolation boundary. Every public query/mutation that touches data
// must start with requireBusiness() or requirePlatform(). Never accept a
// businessId from the client — use the one returned here.
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { canOpenApp, type AppKey, type BusinessRole, type PlatformRole } from "../shared/modules";
import type { ErrorCode } from "../shared/errors";
import { hasPermission, type Permission } from "../shared/permissions";

type Ctx = QueryCtx | MutationCtx;

export function fail(code: ErrorCode): never {
  throw new ConvexError(code);
}

export async function getMember(ctx: Ctx): Promise<Doc<"members"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/** Why a business can't work right now, or null if it can. */
export function lockReason(
  business: Doc<"businesses">,
  now = Date.now(),
): "BUSINESS_SUSPENDED" | "SUBSCRIPTION_EXPIRED" | null {
  if (business.status === "SUSPENDED") return "BUSINESS_SUSPENDED";
  if (business.subscriptionEndsAt < now) return "SUBSCRIPTION_EXPIRED";
  return null;
}

export type BusinessAccess = {
  member: Doc<"members">;
  role: BusinessRole;
  business: Doc<"businesses">;
  businessId: Id<"businesses">;
  plan: Doc<"plans">;
};

/**
 * Caller must be an active member of an active business, whose role and plan
 * allow `app`. `roles` narrows further (e.g. ["OWNER"]). `allowLocked` lets
 * suspended/expired businesses through — only for billing, support, settings.
 */
export async function requireBusiness(
  ctx: Ctx,
  app: AppKey,
  opts: { roles?: BusinessRole[]; allowLocked?: boolean } = {},
): Promise<BusinessAccess> {
  const member = await getMember(ctx);
  if (!member) fail("UNAUTHENTICATED");
  if (!member.businessId) fail("FORBIDDEN");
  if (!member.isActive) fail("ACCOUNT_LOCKED");

  const business = await ctx.db.get(member.businessId);
  if (!business) fail("FORBIDDEN");
  const plan = await ctx.db.get(business.planId);
  if (!plan) fail("FORBIDDEN");

  const role = member.role as BusinessRole;
  if (!canOpenApp(role, plan.modules, app)) fail("FORBIDDEN");
  if (opts.roles && !opts.roles.includes(role)) fail("FORBIDDEN");

  if (!opts.allowLocked) {
    const reason = lockReason(business);
    if (reason) fail(reason);
  }
  return { member, role, business, businessId: business._id, plan };
}

/** Caller must be platform staff. Default: any platform role. */
export async function requirePlatform(
  ctx: Ctx,
  roles: PlatformRole[] = ["SUPER_ADMIN", "PLATFORM_ADMIN"],
): Promise<Doc<"members">> {
  const member = await getMember(ctx);
  if (!member) fail("UNAUTHENTICATED");
  if (member.businessId || !member.isActive) fail("FORBIDDEN");
  if (!roles.includes(member.role as PlatformRole)) fail("FORBIDDEN");
  return member;
}

/** Throws NO_PERMISSION unless the member has this permission (OWNER always does). */
export function requirePermission(member: Doc<"members">, perm: Permission) {
  if (!hasPermission(member, perm)) fail("NO_PERMISSION");
}

type BusinessTable =
  | "serials"
  | "scanSessions"
  | "categories"
  | "batches"
  | "suppliers"
  | "supplierLedger"
  | "purchases"
  | "shifts"
  | "refunds"
  | "products"
  | "customers"
  | "sales"
  | "ledger"
  | "expenses"
  | "tickets"
  | "ticketMessages"
  | "subscriptionPayments";

/**
 * Load a doc by id and prove it belongs to this business. Use this for EVERY
 * id that comes from the client — otherwise business A can read/edit B's data.
 */
export async function getOwned<T extends BusinessTable>(
  ctx: Ctx,
  businessId: Id<"businesses">,
  id: Id<T>,
): Promise<Doc<T>> {
  const doc = (await ctx.db.get(id)) as Doc<T> | null;
  if (!doc || doc.businessId !== businessId) fail("NOT_FOUND");
  return doc;
}

export async function audit(
  ctx: MutationCtx,
  actor: Doc<"members">,
  action: string,
  details?: string,
  businessId: Id<"businesses"> | undefined = actor.businessId,
) {
  await ctx.db.insert("auditLog", {
    businessId,
    actorMemberId: actor._id,
    actorName: actor.fullName,
    action,
    details,
    createdAt: Date.now(),
  });
}
