/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as announcements from "../announcements.js";
import type * as auth from "../auth.js";
import type * as barcodes from "../barcodes.js";
import type * as billing from "../billing.js";
import type * as catalog from "../catalog.js";
import type * as categories from "../categories.js";
import type * as crons from "../crons.js";
import type * as customers from "../customers.js";
import type * as dashboard from "../dashboard.js";
import type * as expenses from "../expenses.js";
import type * as expiry from "../expiry.js";
import type * as http from "../http.js";
import type * as inventory from "../inventory.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_catalog from "../lib/catalog.js";
import type * as lib_limiter from "../lib/limiter.js";
import type * as lib_stock from "../lib/stock.js";
import type * as lib_validate from "../lib/validate.js";
import type * as lookups from "../lookups.js";
import type * as members from "../members.js";
import type * as onboarding from "../onboarding.js";
import type * as plans from "../plans.js";
import type * as platformActivity from "../platformActivity.js";
import type * as platformAnnouncements from "../platformAnnouncements.js";
import type * as platformBilling from "../platformBilling.js";
import type * as platformPlans from "../platformPlans.js";
import type * as platformSecurity from "../platformSecurity.js";
import type * as platformSettings from "../platformSettings.js";
import type * as platformStaff from "../platformStaff.js";
import type * as platformStats from "../platformStats.js";
import type * as platformSupport from "../platformSupport.js";
import type * as platformTenants from "../platformTenants.js";
import type * as products from "../products.js";
import type * as purchases from "../purchases.js";
import type * as reports from "../reports.js";
import type * as sales from "../sales.js";
import type * as scanner from "../scanner.js";
import type * as seed from "../seed.js";
import type * as serials from "../serials.js";
import type * as settings from "../settings.js";
import type * as shared_barcode from "../shared/barcode.js";
import type * as shared_errors from "../shared/errors.js";
import type * as shared_expiry from "../shared/expiry.js";
import type * as shared_health from "../shared/health.js";
import type * as shared_modules from "../shared/modules.js";
import type * as shared_money from "../shared/money.js";
import type * as shared_permissions from "../shared/permissions.js";
import type * as shared_presets from "../shared/presets.js";
import type * as shared_username from "../shared/username.js";
import type * as shifts from "../shifts.js";
import type * as staff from "../staff.js";
import type * as suppliers from "../suppliers.js";
import type * as support from "../support.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  announcements: typeof announcements;
  auth: typeof auth;
  barcodes: typeof barcodes;
  billing: typeof billing;
  catalog: typeof catalog;
  categories: typeof categories;
  crons: typeof crons;
  customers: typeof customers;
  dashboard: typeof dashboard;
  expenses: typeof expenses;
  expiry: typeof expiry;
  http: typeof http;
  inventory: typeof inventory;
  "lib/access": typeof lib_access;
  "lib/catalog": typeof lib_catalog;
  "lib/limiter": typeof lib_limiter;
  "lib/stock": typeof lib_stock;
  "lib/validate": typeof lib_validate;
  lookups: typeof lookups;
  members: typeof members;
  onboarding: typeof onboarding;
  plans: typeof plans;
  platformActivity: typeof platformActivity;
  platformAnnouncements: typeof platformAnnouncements;
  platformBilling: typeof platformBilling;
  platformPlans: typeof platformPlans;
  platformSecurity: typeof platformSecurity;
  platformSettings: typeof platformSettings;
  platformStaff: typeof platformStaff;
  platformStats: typeof platformStats;
  platformSupport: typeof platformSupport;
  platformTenants: typeof platformTenants;
  products: typeof products;
  purchases: typeof purchases;
  reports: typeof reports;
  sales: typeof sales;
  scanner: typeof scanner;
  seed: typeof seed;
  serials: typeof serials;
  settings: typeof settings;
  "shared/barcode": typeof shared_barcode;
  "shared/errors": typeof shared_errors;
  "shared/expiry": typeof shared_expiry;
  "shared/health": typeof shared_health;
  "shared/modules": typeof shared_modules;
  "shared/money": typeof shared_money;
  "shared/permissions": typeof shared_permissions;
  "shared/presets": typeof shared_presets;
  "shared/username": typeof shared_username;
  shifts: typeof shifts;
  staff: typeof staff;
  suppliers: typeof suppliers;
  support: typeof support;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
