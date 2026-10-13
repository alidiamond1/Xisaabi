import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import { getMember, lockReason } from "./lib/access";
import { businessFeatures } from "./shared/presets";

/**
 * Session bootstrap for the UI. One of:
 *  null                              → not logged in
 *  { kind: "needs_onboarding" }      → logged in, no business yet (new signup)
 *  { kind: "platform", member }      → SUPER_ADMIN / PLATFORM_ADMIN
 *  { kind: "business", member, business, logoUrl, plan, lockReason }
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const member = await getMember(ctx);
    if (!member) return { kind: "needs_onboarding" as const };
    if (!member.businessId) return { kind: "platform" as const, member };

    const business = await ctx.db.get(member.businessId);
    if (!business) return null;
    const plan = await ctx.db.get(business.planId);
    if (!plan) return null;
    return {
      kind: "business" as const,
      member,
      business: { ...business, features: businessFeatures(business), attributeDefs: business.attributeDefs ?? [] },
      logoUrl: business.logoId ? await ctx.storage.getUrl(business.logoId) : null,
      plan,
      lockReason: member.isActive ? lockReason(business) : ("ACCOUNT_LOCKED" as const),
    };
  },
});
