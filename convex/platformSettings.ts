import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { audit, diff, requirePlatform } from "./lib/access";
import { optStr } from "./lib/validate";

const FIELDS = ["paymentInstructions", "supportPhone", "supportWhatsApp", "supportEmail", "signupsOpen"];

// Public on purpose: only non-secret contact info + whether signup is open.
export const get = query({
  args: {},
  handler: async (ctx) => {
    const s = await ctx.db.query("platformSettings").first();
    return {
      paymentInstructions: s?.paymentInstructions ?? "",
      supportPhone: s?.supportPhone ?? "",
      supportWhatsApp: s?.supportWhatsApp ?? "",
      supportEmail: s?.supportEmail ?? "",
      signupsOpen: s?.signupsOpen ?? true,
    };
  },
});

export const update = mutation({
  args: {
    paymentInstructions: v.string(),
    supportPhone: v.string(),
    supportWhatsApp: v.string(),
    supportEmail: v.string(),
    signupsOpen: v.boolean(),
  },
  handler: async (ctx, a) => {
    const me = await requirePlatform(ctx, ["SUPER_ADMIN"]);
    const next = {
      paymentInstructions: optStr(a.paymentInstructions, 2000) ?? "",
      supportPhone: optStr(a.supportPhone, 50) ?? "",
      supportWhatsApp: optStr(a.supportWhatsApp, 50) ?? "",
      supportEmail: optStr(a.supportEmail, 100) ?? "",
      signupsOpen: a.signupsOpen,
    };
    const cur = await ctx.db.query("platformSettings").first();
    if (cur) await ctx.db.patch(cur._id, { ...next, updatedAt: Date.now() });
    else await ctx.db.insert("platformSettings", { ...next, updatedAt: Date.now() });
    await audit(ctx, me, "platformSettings.update", undefined, undefined, {
      changes: diff(cur ?? { paymentInstructions: "", supportPhone: "", supportWhatsApp: "", supportEmail: "", signupsOpen: true }, next, FIELDS),
    });
  },
});
