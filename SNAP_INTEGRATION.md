# SNAP subscription checkout

Owner picks a plan (monthly / yearly) on `/apps/billing` → server creates a SNAP hosted checkout → owner pays →
the plan is activated only after the server re-fetches the payment from SNAP (`payment.succeeded` webhook or the
return-page check). Yearly price = plan's yearly price, or 12 × monthly if none is set. Free plans activate directly.
If SNAP is not configured, the page falls back to the manual "request plan" ticket.

Code: `convex/lib/snap.ts` (config, signature, API), `convex/billing.ts` (checkout + settle), `convex/http.ts`
(`POST /webhooks/snap`), `components/billing/*`, `app/apps/billing/page.tsx`. Tests: `convex/billing.test.ts`.

## Setup (Convex server env, never `NEXT_PUBLIC_*`, never in chat or git)

```sh
npx convex env set SNAP_ENVIRONMENT sandbox
npx convex env set SNAP_SECRET_KEY sk_test_...          # SNAP dashboard → Sandbox → Generate keys
npx convex env set SNAP_WEBHOOK_SECRET whsec_...        # after adding the webhook endpoint below
npx convex env set SNAP_APP_ORIGIN https://xisabsax.netlify.app
npx convex env set SNAP_CHECKOUT_ORIGINS https://<host of the checkout url SNAP returns>
npx convex env set SNAP_SANDBOX_BUSINESS_IDS <businessId>[,<businessId>]   # sandbox only works for these shops
```

Webhook endpoint to register in SNAP: `https://marvelous-horse-738.convex.site/webhooks/snap`, event `payment.succeeded`.

Optional: `SNAP_API_BASE_URL` (default `https://api.snap.so`).

All values must be present and valid or checkout stays off (fails closed).

## Going live

New live keys + live webhook secret, then `SNAP_ENVIRONMENT=live` and `SNAP_ENABLE_LIVE=true`.
Sandbox payments (provider `mock`) can never activate a live plan, and vice versa.

## Not done yet

A real sandbox checkout + signed webhook has not been run end to end. Do that before calling it connected.
