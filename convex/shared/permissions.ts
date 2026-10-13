// Shared by Convex functions AND the UI.
import type { BusinessRole } from "./modules";

export type Permission = "seeCost" | "giveDiscount" | "refund" | "adjustStock" | "editPrice";
export type Permissions = Record<Permission, boolean>;

export const PERMISSION_LABELS: Record<Permission, string> = {
  seeCost: "See cost price & profit",
  giveDiscount: "Give discounts",
  refund: "Refund sales",
  adjustStock: "Adjust stock",
  editPrice: "Change prices",
};

export const ROLE_DEFAULTS: Record<Exclude<BusinessRole, "OWNER">, Permissions> = {
  MANAGER: { seeCost: true, giveDiscount: true, refund: true, adjustStock: true, editPrice: true },
  CASHIER: { seeCost: false, giveDiscount: true, refund: false, adjustStock: false, editPrice: false },
};

/** OWNER always true; others use their saved toggles or the role defaults. */
export function hasPermission(
  member: { role: string; permissions?: Permissions },
  perm: Permission,
): boolean {
  if (member.role === "OWNER") return true;
  if (member.role !== "MANAGER" && member.role !== "CASHIER") return false;
  return (member.permissions ?? ROLE_DEFAULTS[member.role])[perm];
}
