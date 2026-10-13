// Shared by Convex functions AND the Next.js UI. Pure TypeScript, no imports from convex/server.

export type PlatformRole = "SUPER_ADMIN" | "PLATFORM_ADMIN";
export type BusinessRole = "OWNER" | "MANAGER" | "CASHIER";
export type Role = PlatformRole | BusinessRole;

// Modules a plan can switch on/off.
export type ModuleKey =
  | "pos"
  | "inventory"
  | "sales"
  | "customers"
  | "expiry"
  | "expenses"
  | "reports"
  | "staff"
  | "purchases";

// Apps always present regardless of plan.
export type CoreAppKey = "settings" | "billing" | "support";
export type AppKey = ModuleKey | CoreAppKey;

export const MODULE_KEYS: ModuleKey[] = [
  "pos",
  "inventory",
  "sales",
  "customers",
  "expiry",
  "expenses",
  "reports",
  "staff",
  "purchases",
];

// Which business roles may open each app.
export const APP_ROLES: Record<AppKey, BusinessRole[]> = {
  pos: ["OWNER", "MANAGER", "CASHIER"],
  customers: ["OWNER", "MANAGER", "CASHIER"],
  inventory: ["OWNER", "MANAGER"],
  sales: ["OWNER", "MANAGER"],
  expiry: ["OWNER", "MANAGER"],
  expenses: ["OWNER", "MANAGER"],
  reports: ["OWNER", "MANAGER"],
  staff: ["OWNER", "MANAGER"], // MANAGER may only manage CASHIERs
  purchases: ["OWNER", "MANAGER"], // suppliers, stock in, supplier payments
  settings: ["OWNER"],
  billing: ["OWNER"],
  support: ["OWNER", "MANAGER"],
};

export function isModuleKey(app: AppKey): app is ModuleKey {
  return (MODULE_KEYS as string[]).includes(app);
}

/** Can this role, on a plan with these modules, open this app? */
export function canOpenApp(role: BusinessRole, planModules: ModuleKey[], app: AppKey): boolean {
  if (!APP_ROLES[app].includes(role)) return false;
  return isModuleKey(app) ? planModules.includes(app) : true;
}
