# Dukaan — Build Spec (contract for all agents)

Multi-tenant SaaS business suite for small shops in Somalia, Odoo-style: a home
screen of **apps (modules)**, each app its own screen. Next.js 15 (App Router) +
Convex + Convex Auth. UI language: English. Currency default USD.

**Read before writing code:** `convex/schema.ts`, `convex/lib/access.ts`,
`convex/shared/*.ts`, `convex/members.ts`, `convex/seed.ts`, `convex/auth.ts`.
These are the foundation — do NOT change them without the organizer's approval
(exception: adding indexes to schema.ts is fine; say so in your report).

---

## 1. Tenancy & roles (non-negotiable)

| Side | Role | Can |
|---|---|---|
| Platform | `SUPER_ADMIN` | Everything on the platform: businesses, plans & pricing, support inbox, payments, platform staff, audit |
| Platform | `PLATFORM_ADMIN` | Same as super admin EXCEPT edit plans/pricing and manage platform staff |
| Business | `OWNER` | Everything inside their own business, incl. Settings (profile, logo) and Billing |
| Business | `MANAGER` | Business apps except Settings & Billing; in Staff may only create/manage CASHIERs |
| Business | `CASHIER` | POS and Customers (lookup, add, take repayments) |

App access per role + plan is defined in `convex/shared/modules.ts` (`APP_ROLES`, `canOpenApp`).

**Isolation rules — every backend function:**
1. Starts with `requireBusiness(ctx, "<app>", opts)` or `requirePlatform(ctx, roles)`.
2. Uses `businessId` from that result. **Never** accept `businessId` as an argument on business-side functions.
3. Every id argument (productId, customerId, saleId, ticketId…) is loaded with `getOwned(ctx, businessId, id)`.
4. Queries on business tables always use an index starting with `businessId`.
5. Actions (no `ctx.db`) check access by calling an `internalQuery`/`internalMutation` that runs `requireBusiness`/`requirePlatform` — `ctx.runQuery` forwards the caller's auth.
6. Errors: `fail("CODE")` with codes from `convex/shared/errors.ts` (add new codes there if needed).
7. Every write that matters calls `audit(ctx, member, "action.name", details)`.
8. Validate all args with `v.*` validators; also validate business rules (non-negative money, qty > 0, string lengths ≤ 200, body ≤ 5000).

Locking: `requireBusiness` throws `BUSINESS_SUSPENDED` / `SUBSCRIPTION_EXPIRED`
unless `allowLocked: true`. Use `allowLocked` ONLY for `settings`, `billing`, `support`.

Money = integer cents everywhere. Dates = ms numbers.

---

## 2. Backend API contract (`convex/*.ts`)

Names are fixed — the frontend is built against them in parallel.
`(Q)` query, `(M)` mutation, `(A)` action. Access in brackets.

### Public
- `plans.publicList` (Q) [no auth] → active plans sorted by sortOrder (for landing/pricing page)

### Onboarding — `onboarding.ts`
- `generateUploadUrl` (M) [any logged-in user] → upload URL (logo)
- `createBusiness` (M) [logged in, no member yet] `{ fullName, name, businessType, phone, email?, address, city, country, currency, logoId? }` → businessId.
  Uses default trial plan (`isDefaultTrial`), `subscriptionStatus:"TRIAL"`, `subscriptionEndsAt = now + trialDays`, default settings `{ taxRatePercent:0, lowStockThreshold:5, allowNegativeStock:true }`, creates OWNER member with `username` = the auth user's `email` field. Throws `ALREADY_ONBOARDED` if a member exists.

(Signup itself is client-side: `signIn("password", { flow: "signUp", username, password })`, then `/onboarding`.)

### Settings — `settings.ts` [settings, OWNER, allowLocked]
- `get` (Q) → `{ business, logoUrl }`
- `updateProfile` (M) `{ name, businessType, phone, email?, address, city, country, currency, logoId? }`
- `updateSettings` (M) `{ receiptHeader?, receiptFooter?, taxRatePercent, lowStockThreshold, allowNegativeStock }`
- `generateUploadUrl` (M)

### Staff — `staff.ts` [staff]
- `list` (Q) → members of this business `{ _id, fullName, username, role, phone, isActive, createdAt }`
- `create` (A) `{ fullName, username, password, role: "MANAGER"|"CASHIER", phone? }` → memberId. MANAGER may only create CASHIER. Enforces plan `maxUsers` (0 = unlimited, counts active members). Username globally unique → `USERNAME_TAKEN`. Uses `createAccount` from `@convex-dev/auth/server`.
- `update` (M) `{ memberId, fullName, phone?, role }` — cannot change OWNER; MANAGER only on CASHIERs
- `setActive` (M) `{ memberId, isActive }` — cannot lock OWNER or self
- `resetPassword` (A) `{ memberId, newPassword }` — `modifyAccountCredentials`, then `invalidateSessions`

### Inventory — `products.ts`
- `list` (Q) [inventory] `{ search?, category?, includeArchived? }` → products + `expiryStatus`, `daysLeft`
- `posCatalog` (Q) [pos] → all non-archived products `{ _id, name, barcode, category, unit, priceCents, stock, expiryDate }` (the POS caches this offline)
- `categories` (Q) [inventory] → string[]
- `create` (M) [inventory] `{ name, barcode, category, unit, costCents, priceCents, stock, expiryDate? }` — barcode unique per business if non-empty (`BARCODE_EXISTS`); plan `maxProducts`
- `update` (M) [inventory] `{ productId, ...same fields }`
- `archive` (M) [inventory] `{ productId, archived: boolean }`
- `adjustStock` (M) [inventory] `{ productId, delta, reason }` — audit logged

### POS & Sales — `sales.ts`
- `create` (M) [pos] `{ clientSaleId, items:[{productId, qty}], discountCents, paymentMethod, mobileReference?, customerId?, createdAt }` → `{ saleId, receiptNo, duplicate }`.
  Idempotent on `(businessId, clientSaleId)`. Prices/costs read from DB. Rejects `PRODUCT_EXPIRED`. Stock decremented; if `allowNegativeStock` is false → `INSUFFICIENT_STOCK`. Tax = round((subtotal − discount) × taxRate / 100). CREDIT → requires customer, checks credit limit (0 = none), increases balance, inserts ledger DEBT. `receiptNo` = previous max + 1 per business. `createdAt` from client clamped to ≤ now.
- `get` (Q) [pos] `{ saleId }` → sale + `{ businessName, logoUrl, phone, address, receiptHeader, receiptFooter, currency }` for printing
- `list` (Q) [sales] `{ from, to, paymentMethod?, cashierId? }` → up to 500 sales, newest first
- `recentForCashier` (Q) [pos] → caller's last 20 sales
- `refund` (M) [sales, OWNER|MANAGER] `{ saleId }` — restores stock; if CREDIT reduces balance + ledger REVERSAL; `ALREADY_REFUNDED`

### Customers & credit — `customers.ts` [customers]
- `list` (Q) `{ search? }` → customers (search by name or phone)
- `get` (Q) `{ customerId }` → `{ customer, ledger (newest first, 200) }`
- `create` (M) `{ fullName, phone, creditLimitCents }`
- `update` (M) `{ customerId, fullName, phone, creditLimitCents }`
- `recordPayment` (M) `{ customerId, amountCents, method: "CASH"|"MOBILE", note? }` — `PAYMENT_EXCEEDS_BALANCE`; ledger PAYMENT; sets lastPaymentAt

### Expiry — `expiry.ts` [expiry]
- `watchlist` (Q) → `{ expired, oneMonth, threeMonths }` each `[{ product, daysLeft, valueCents (cost × stock) }]`
- `alertCount` (Q) [any business member — return `null` if caller can't open expiry] → `{ expired, oneMonth }`
- `setPrice` (M) `{ productId, priceCents }` — "quick discount"
- `clearStock` (M) `{ productId }` — stock → 0, audit

### Expenses — `expenses.ts` [expenses]
- `list` (Q) `{ from, to }`, `create` (M) `{ category, amountCents, note?, spentAt }`, `remove` (M) `{ expenseId }`

### Reports — `reports.ts` [reports]
- `summary` (Q) `{ from, to }` → `{ revenueCents, costCents, grossProfitCents, expensesCents, netProfitCents, salesCount, refundsCount, byPaymentMethod: {CASH, MOBILE, CREDIT}, topProducts: [{name, qty, revenueCents}] (10), daily: [{date:"YYYY-MM-DD", revenueCents, profitCents}], outstandingDebtCents }` — excludes REFUNDED

### Home — `dashboard.ts`
- `home` (Q) [any active business member; OWNER/MANAGER get numbers, CASHIER gets `null`] → `{ todaySalesCents, todaySalesCount, lowStockCount, outstandingDebtCents, openTickets }`

### Billing — `billing.ts` [billing, OWNER, allowLocked]
- `current` (Q) → `{ plan, subscriptionStatus, subscriptionEndsAt, usage: { users, products }, payments }`
- `plans` (Q) → active plans
- `requestPlan` (M) `{ planId, message? }` → creates a BILLING ticket "Upgrade request: <plan>" (payment is manual via EVC/Zaad; platform records it)

### Support (business side) — `support.ts` [support, allowLocked]
- `list` (Q) → this business's tickets, newest first
- `get` (Q) `{ ticketId }` → `{ ticket, messages }`
- `markRead` (M) `{ ticketId }` → unreadByBusiness=false
- `create` (M) `{ subject, category, priority, body }` → ticketId
- `reply` (M) `{ ticketId, body }` → status OPEN, unreadByPlatform=true
- `close` (M) `{ ticketId }`

### Platform — all `requirePlatform`
- `platformTenants.ts`
  - `list` (Q) `{ search?, status? }` → businesses + `{ logoUrl, planName, ownerName, ownerUsername, staffCount, lockReason }`
  - `get` (Q) `{ businessId }` → `{ business, logoUrl, plan, owner, staff, stats: { products, customers, sales30dCents, sales30dCount }, payments, audit (latest 50) }`
  - `suspend` (M) `{ businessId, reason }`, `activate` (M) `{ businessId }`
  - `changePlan` (M) `{ businessId, planId }`
  - `extend` (M) `{ businessId, days }`
  - `recordPayment` (M) `{ businessId, planId, amountCents, months, method, reference? }` → sets plan, `subscriptionStatus:"ACTIVE"`, `subscriptionEndsAt = max(now, endsAt) + months×30 days`
- `platformPlans.ts` — `list` (Q) [any platform], `create`/`update` (M) [SUPER_ADMIN] full plan fields, `setActive` (M) [SUPER_ADMIN]. Setting `isDefaultTrial:true` unsets it on the others.
- `platformSupport.ts` — `list` (Q) `{ status? }` → tickets + businessName; `get` (Q) `{ ticketId }`; `reply` (M) `{ ticketId, body }` → status ANSWERED, unreadByBusiness=true; `setStatus` (M); `markRead` (M)
- `platformStaff.ts` [SUPER_ADMIN] — `list` (Q), `create` (A) `{ fullName, username, password }` → PLATFORM_ADMIN, `setActive` (M)
- `platformStats.ts` — `overview` (Q) → `{ businesses: {total, active, suspended, trial, expired}, mrrCents, paymentsThisMonthCents, newBusinesses30d, expiringIn7Days: [...], openTickets, gmvThisMonthCents }`
- `platformAudit.ts` — `list` (Q) `{ businessId? }` → latest 200

---

## 3. Frontend (Next.js App Router, `app/`)

Stack: Tailwind v4 + shadcn/ui + lucide-react icons + Zustand (POS cart) + idb-keyval (offline outbox).
All pages are client components using `useQuery`/`useMutation`/`useAction` from `convex/react` and `api` from `@/convex/_generated/api`.
Session: `useQuery(api.members.me)` → route by `kind`. Auth hooks: `useAuthActions()` / `useConvexAuth()` from `@convex-dev/auth/react`.
Errors: show `errorMessage(err)` from `convex/shared/errors.ts` in a toast.

### Routes
| Route | Who | What |
|---|---|---|
| `/` | public | Landing page: hero, features (modules), pricing from `plans.publicList`, Login / Start free trial |
| `/login` | public | username + password |
| `/signup` | public | full name, username, password → then `/onboarding` |
| `/onboarding` | `needs_onboarding` | 2-step wizard: business profile (name, type, phone, email, address, city, country, currency) + logo upload with preview |
| `/apps` | business | **Odoo-style app launcher**: business logo + name top-left, user menu top-right, grid of colorful app tiles (only apps `canOpenApp` allows), KPI strip from `dashboard.home`, trial/expiry banner, expiry alert banner |
| `/apps/pos` | | Full-screen POS (see below) |
| `/apps/inventory` | | products table, add/edit drawer, stock adjust, archive, filters |
| `/apps/sales` | | sales history with date range, filters, view receipt, refund |
| `/apps/customers` | | customer list, detail with debt ledger, add payment |
| `/apps/expiry` | | tabs Expired / 1 month / 3 months, discount & clear stock |
| `/apps/expenses` | | expenses list + add |
| `/apps/reports` | | KPI cards, daily revenue/profit chart (simple SVG or recharts), top products, payment split |
| `/apps/staff` | | staff list, add user dialog, lock/unlock, reset password |
| `/apps/settings` | OWNER | business profile + logo, receipt & tax settings |
| `/apps/billing` | OWNER | current plan, usage bars, plan cards, "Request this plan" + payment instructions (EVC/Zaad number placeholder from env `NEXT_PUBLIC_PAYMENT_INSTRUCTIONS`) |
| `/apps/support` | | tickets list + thread chat view + new ticket |
| `/platform` | platform | **platform launcher** (same tile style): Dashboard, Businesses, Plans & Pricing, Support Inbox, Platform Staff (SUPER_ADMIN), Audit Log |
| `/platform/dashboard` | | KPIs from `platformStats.overview` |
| `/platform/businesses` + `/platform/businesses/[id]` | | list with search/status filter; detail: profile, logo, owner, plan, staff, stats, payments, audit; actions: suspend/activate, change plan, extend, record payment |
| `/platform/plans` | | edit plans (SUPER_ADMIN), PLATFORM_ADMIN read-only |
| `/platform/support` | | inbox + thread + reply + status |
| `/platform/staff` | SUPER_ADMIN | platform admins |
| `/platform/audit` | | audit log |

Guards: a shared client guard component — not logged in → `/login`; `needs_onboarding` → `/onboarding`; platform user on `/apps*` → `/platform`; business user on `/platform*` → `/apps`; app not allowed → back to `/apps`; `lockReason` set → locked screen with links to Billing and Support only (OWNER) / message to contact owner (others).

### Layout pattern (Odoo-like)
Every app page: top bar = [grid icon → launcher] [app icon + name] [app sub-menu tabs] … [business logo/name] [user menu]. Content below. Mobile: tabs collapse to a menu. Tables become cards on small screens.

### POS (`/apps/pos`)
- Full-screen, touch-first. Left: product search + category chips + product grid. Right: cart, totals, big Pay button.
- Barcode: hidden auto-focused input; scanner types + Enter → add by barcode. Expired products (`expiryStatus`) cannot be added (red toast).
- Status pill: 🟢 Online / 🟡 Offline · N pending.
- Checkout dialog: CASH (amount tendered → change), MOBILE (EVC/Zaad reference), CREDIT (customer search/pick, shows balance & limit).
- `lib/outbox.ts`: cache `posCatalog` in IndexedDB on every load; on Pay → create `clientSaleId = crypto.randomUUID()`, save to outbox, call `sales.create`; success → remove; failure due to network → keep; flush on `online` event / app start / every 30 s. Domain errors (e.g. PRODUCT_EXPIRED) → remove from outbox and show error. CREDIT sales require online.
- Receipt: 80mm thermal layout via `@media print`, logo, business name/phone/address, receipt no, date, cashier, items, totals, payment, header/footer text. Print button after sale; offline sales print a provisional receipt.

### Design
Professional, calm, dense-but-readable, like Odoo/Linear. Neutral slate background, white cards, one brand color (indigo-600), each app tile its own color + lucide icon. Rounded-xl, subtle borders, no heavy shadows. Light theme only for now. Every list has empty state + loading skeleton.

---

## 4. Verification each agent must do before reporting
- Backend: `npx tsc --noEmit -p convex` clean; the running `convex dev` pushes on save — check it shows "Convex functions ready". Smoke-test with `npx convex run` where possible.
- Frontend: `npx tsc --noEmit` and `npm run build` clean (after backend exists).
- Report: files created, any deviations from this spec and why.
