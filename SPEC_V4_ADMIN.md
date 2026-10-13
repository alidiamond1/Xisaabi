# SPEC v4 — Super Admin console

Goal: the platform side (`/platform/*`) becomes a full SaaS control room: see every change, every
business's health, money in, support load, security — live (Convex subscriptions).
Benchmarks: Stripe/Chargebee (MRR, churn, payments), Shopify/Odoo SaaS admin (tenant health, usage
vs plan limits), Intercom/Zendesk (ticket assignment, waiting time), Auth0/Clerk (logins, lockouts).

Rules unchanged: every function starts with `requirePlatform(ctx, roles?)` (or `requireBusiness` on the
business side), bounded queries (`.take`/paginate), no `Date.now()` in queries (pass `now` from the
client rounded to the minute, or compute in crons/mutations), money = integer cents, audit every write.
Design: DESIGN.md (approved — reuse existing components/look, do not restyle).

## 1. Change tracking (the core ask: "track all changes")

Schema `auditLog` — add optional fields (old rows stay valid):
- `module: v.optional(v.string())` — prefix of `action` before the dot (`product`, `business`…), set by `audit()`
- `targetId: v.optional(v.string())`, `targetName: v.optional(v.string())` — what was changed
- `changes: v.optional(v.array(v.object({ field: v.string(), from: v.string(), to: v.string() })))`
- indexes: `by_module ["module","createdAt"]`, `by_actor ["actorMemberId","createdAt"]`

`convex/lib/access.ts`:
- `audit(ctx, actor, action, details?, businessId?, extra?: { targetId?, targetName?, changes? })`
  (keep the current positional params so existing callers compile).
- `diff(before, after, fields: string[])` → changes array, only fields whose JSON differs; values
  stringified (`String`, arrays/objects `JSON.stringify`, undefined → ""), each capped at 200 chars.

Add diffs (`changes`) to these updates: product.update, settings.update, settings.profile,
settings.features, customer.update, supplier.update, expense.update, expiry.setPrice, plan.update,
business.changePlan (plan name from→to), business.extend (endsAt from→to, ISO date), staff updates
(role, permissions, active). Add audits where missing: every staff.* write (create, update, deactivate,
reset password — never log the password), platformStaff.* writes, announcement.*, platformSettings.*,
business.note, business.editProfile, payment.void, ticket.assign.

Queries `convex/platformActivity.ts` (replaces platformAudit.ts; delete the old file & update UI):
- `list({ paginationOpts, businessId?, module?, actorMemberId?, from?, to? })` — paginated, newest
  first; picks the best index (business > actor > module > by_created) and `.filter()`s the rest.
  Returns rows + `businessName`.
- `modules()` → distinct module list (static array from code is fine).

## 2. Business health stats (cron rollup — never scan sales on page load)

New table `businessStats` (one row per business, `by_business` index unique-ish, `by_lastSale`):
`businessId, lastSaleAt?, lastLoginAt?, sales30dCents, sales30dCount, gmvThisMonthCents,
gmvLastMonthCents, products, customers, staff, updatedAt`.
- `internal.platformStats.refreshAll` (internalMutation, cron hourly + "Refresh now" button for
  platform users via a public mutation `refreshNow`): schedules `refreshOne({businessId})` per business.
- `refreshOne`: bounded `.take()` counts; lastLoginAt = newest `authSessions` `_creationTime` over the
  business's members (`authSessions` index `userId`).
- Health (derived in queries from stats + `now` arg): `ACTIVE` sale ≤7d, `QUIET` ≤30d, `DORMANT`
  >30d or never, `NEW` created ≤7d with no sale.

## 3. Dashboard (`platformStats.overview({ now })`)
Returns: counts (total/active/trial/expired/suspended), mrrCents, arrCents, payingCount,
trialConversionPercent (businesses with ≥1 non-void payment ÷ businesses older than 14d),
churned30d (expired in last 30d and not renewed), collectedThisMonthCents, collectedLastMonthCents,
gmvThisMonthCents, gmvLastMonthCents (sum of businessStats), health counts, openTickets,
oldestWaitingTicketAt, `series` last 12 months [{month:"2026-10", signups, collectedCents}],
`expiringIn7Days`, `overdue` (expired, not suspended), `atRisk` (paying + DORMANT/QUIET),
`topByGmv` (10, by sales30dCents), breakdowns `byType`, `byPlan`, `byCity` [{key,count}].
UI: KPI cards with month-over-month delta, two 12-month bar charts (CSS/SVG, no chart lib unless one
is already installed), lists with links to the business page.

## 4. Businesses
- `platformTenants.list({ now, search?, status?, planId?, type?, city?, health? })` — adds plan,
  owner, stats (lastSaleAt, sales30dCents, staff), health. UI: sortable table, filters, CSV export
  (client Blob, no lib), mobile cards.
- `platformTenants.get` — add stats row, usage vs plan limits (users x/max, products x/max), open
  tickets, notes; drop the heavy sales/products scans (use businessStats).
- New mutations: `editProfile({businessId, name, phone, city, address, email?})` (diffed),
  `addNote({businessId, body})`, `deleteNote({noteId})` — table `businessNotes {businessId, body,
  authorMemberId, authorName, createdAt}` index by_business. Platform-only, never visible to tenants.
- Members: `platformTenants.members({businessId})` → staff with lastLoginAt, isActive.
  `resetMemberPassword` (action, SUPER_ADMIN only, min 8 chars, `modifyAccountCredentials` +
  `invalidateSessions`), `forceLogout({memberId})` (invalidateSessions), `setMemberActive`.
  Member must belong to a business (never platform staff via these).
- Detail page tabs: Overview · Staff · Billing · Activity · Support · Notes. Suspend/activate in a
  danger zone.

## 5. Billing (`/platform/billing`)
- `subscriptionPayments` add optional `voidedAt`, `voidReason`, `voidedBy`.
- `platformBilling.payments({ paginationOpts, from?, to?, method?, businessId? })` + totals.
- `platformBilling.voidPayment({paymentId, reason})` (SUPER_ADMIN): marks void, subtracts
  `months*30d` from subscriptionEndsAt (not below now−1d), audited. Voided rows excluded from all sums.
- UI: month totals, by-method breakdown, table, CSV export, overdue list, record payment shortcut.

## 6. Announcements
Table `announcements {title, body, level: INFO|WARNING|SUCCESS, audience: v.object({planIds:
v.array(v.id("plans")), businessTypes: v.array(v.string())}) (empty = everyone), startsAt, endsAt?,
isActive, createdBy, createdAt}`.
Platform CRUD in `platformAnnouncements.ts` (list/create/update/remove). Business side:
`announcements.active({ now })` (requireBusiness, allowLocked) → matching rows (≤5). App shell shows a
dismissible banner (dismissed ids in localStorage, try/catch).

## 7. Support upgrades
`tickets` add optional `assignedTo: v.id("members")`, `firstResponseAt`. `platformSupport.list` gains
filters `assignedTo`, `priority`, `mine`; returns waitingSince (lastMessageAt when unreadByPlatform).
`assign({ticketId, memberId|null})`, `setPriority`. Set `firstResponseAt` on first platform reply.
Dashboard shows oldest waiting.

## 8. Platform staff & security
- `platformStaff.list` adds lastLoginAt. New: `setActive` (cannot deactivate self or the last
  SUPER_ADMIN), `resetPassword` (action, SUPER_ADMIN), `setRole` (same last-SUPER_ADMIN rule).
- `platformSecurity.recentLogins({ limit })` — newest `authSessions` (≤100) joined to members
  (username, role, business name). `platformSecurity.lockouts()` — `authRateLimits` rows (accounts
  temporarily locked by failed logins) joined to usernames where possible.
- UI `/platform/security`: recent logins, lockouts, platform-staff actions (activity filtered to
  platform modules).

## 9. Platform settings (`/platform/settings`, SUPER_ADMIN)
Singleton table `platformSettings {paymentInstructions, supportPhone, supportWhatsApp, supportEmail,
signupsOpen, updatedAt}`. `platformSettings.get` is public (no auth — only non-secret contact info),
`update` SUPER_ADMIN + diff audit. `signupsOpen=false` → onboarding/signup refuses with
`SIGNUPS_CLOSED` (add to errors.ts). Billing page uses `paymentInstructions` (fallback to env var);
Support page shows contact phone/WhatsApp.

## 10. Navigation
Platform nav: Dashboard · Businesses · Billing · Activity · Support · Announcements · Catalog ·
Plans · Staff · Security · Settings (SUPER_ADMIN-only items hidden for PLATFORM_ADMIN).

## Out of scope (later)
Impersonation / "log in as" (privacy + audit risk — add read-only view-as when asked), automated
payment gateway, email/SMS sending, invoices PDF.

## Done =
`npx tsc --noEmit` clean, all tests pass incl. new tests (tenant isolation of every new function:
business users get FORBIDDEN; PLATFORM_ADMIN blocked from SUPER_ADMIN-only; diff helper; void
payment; last-SUPER_ADMIN guard; signupsOpen), `npm run lint` 0 errors, `npm run build` OK.
