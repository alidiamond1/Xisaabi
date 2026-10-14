# XisabSax

Multi-tenant business suite for small shops (Odoo-style apps): POS (works offline), inventory, sales,
customer credit, expiry alerts, expenses, reports, staff, settings, billing, support — plus a platform
admin area for the SaaS owner. Next.js 15 + Convex. Full spec: `SPEC.md`.

## Run locally

```bash
npm install
npx convex dev          # terminal 1 (first time: log in, or set CONVEX_AGENT_MODE=anonymous for a local backend)
npm run dev             # terminal 2 → http://localhost:3000
```

First-time setup of a new Convex deployment:

```bash
npx @convex-dev/auth                     # sets SITE_URL, JWT_PRIVATE_KEY, JWKS
npx convex run seed:plans
npx convex run seed:createSuperAdmin '{"username":"you","password":"a-strong-password","fullName":"Your Name"}'
```

Optional env: `NEXT_PUBLIC_PAYMENT_INSTRUCTIONS` — EVC/Zaad payment text shown in Billing.

## Checks

```bash
npm test                # tenant-isolation & role tests (convex-test)
npx tsc --noEmit
npm run build
```

## Roles

| Side | Role | Access |
|---|---|---|
| Platform | SUPER_ADMIN | everything: businesses, plans & pricing, support, payments, platform staff |
| Platform | PLATFORM_ADMIN | same, except pricing and platform staff |
| Business | OWNER | all apps of their business + settings + billing |
| Business | MANAGER | all apps except settings/billing; manages cashiers only |
| Business | CASHIER | POS + customers |

Tenant isolation lives in `convex/lib/access.ts` — every backend function goes through it.
