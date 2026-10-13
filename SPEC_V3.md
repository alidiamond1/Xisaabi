# Dukaan v3 — Business types + barcode scan-to-add (contract)

Read first: `SPEC.md` §1 (tenant isolation — still mandatory), `SPEC_V2.md`, `DESIGN.md`, `RESEARCH_V3.md` (A5 presets, B1–B7 barcode), and **`convex/_generated/ai/guidelines.md` (Convex rules — follow them: bounded `.take()`, no `Date.now()` in queries, rate limiting via `@convex-dev/rate-limiter`, actions call internal functions)**.

Live data exists (deployment `marvelous-horse-738`): every new field is optional; code must treat a missing field as the v2 default.

## Foundation (organizer — use, don't rewrite)
- `convex/schema.ts` v3: `businesses.businessTypes/features/attributeDefs/settings.shareToCatalog`; `products.units/attrs/attrsText/trackSerial/warrantyMonths` + `search_attrs` index; purchase items `unitName/unitQty/serials`; sale items `unitName/unitFactor/serials/warrantyUntil`; tables `serials`, `catalog`, `catalogContributions`, `scanSessions`, `scans`.
- `convex/shared/presets.ts`: `PRESETS`, `mergePresets(keys)`, `businessFeatures(b)`, `FEATURE_LABELS`, `MAX_BUSINESS_TYPES`.
- getOwned supports `serials`, `scanSessions`.

## Rules for units (packs)
- Stock, batches, movements, costs are ALWAYS in the product's **base unit** (`product.unit`).
- `product.units[]` = extra units `{name, factor, barcode, priceCents?}`; price of a unit = `priceCents ?? round(factor × product.priceCents)`.
- A sale line carries `unitName`+`unitFactor`; `qty`, `priceCents` are per that unit; stock moves `qty × factor` base units (use `roundQty`). Refund restock likewise.
- A purchase line may be entered in a unit: server converts to base `qty` and per-base `unitCostCents`, storing `unitName/unitQty` for display.
- Scanning a unit barcode (POS/receive/lookup) resolves to `{product, unit}`. Unit barcodes are unique per business together with barcode + extraBarcodes.

## Rules for serials (IMEI)
- Product with `trackSerial` must be STOCKABLE, integer qty, no expiry tracking, no variants template.
- Receiving N units requires exactly N unique serials (normalized uppercase, trimmed; IMEI = 15 digits + Luhn check when it looks numeric 15-digit — reject bad check digit with `INVALID_SERIAL`).
- Selling a trackSerial line requires `serials` with length = qty, each IN_STOCK for that product → set SOLD, saleId, customerId, soldAt, warrantyUntil (= now + warrantyMonths). Refund with restock → RETURNED → back to IN_STOCK; without restock → RETURNED stays out.
- Opening stock for a trackSerial product must also list serials.
- Stock number for these products stays in products.stock (kept equal to IN_STOCK count via stockIn/stockOut).

---

## Backend API v3

### BACKEND-C — business types, units, attributes, serials
Files: `onboarding.ts`, `settings.ts`, `products.ts`, `purchases.ts`, `sales.ts`, new `serials.ts`, tests `convex/v3.test.ts`.
- `onboarding.createBusiness` + `businessTypes: string[]` (≤3, known keys; empty → ["general"]). Writes `businessTypes`, `features`, `attributeDefs` from `mergePresets`; seeds categories (top-level) once. Units are just suggestions (UI) — not stored.
- `settings.features` (Q) [settings] → `{businessTypes, features, attributeDefs}`; `settings.updateFeatures` (M) [OWNER] `{features, attributeDefs}` (validate keys `^[a-z][a-zA-Z0-9]{0,30}$`, ≤20 defs, labels ≤40, options ≤30); `settings.applyPreset` (M) [OWNER] `{businessTypes}` → unions new features/attributes in (never removes), seeds missing categories.
- `members.me` business payload must expose `features` (via `businessFeatures`) and `attributeDefs` — **organizer-owned file: BACKEND-C may edit `members.ts` only to add these two fields.**
- `products.create/update` accept `units?`, `attrs?` (only keys in attributeDefs; values ≤200), `trackSerial?`, `warrantyMonths?` (0–120), `openingSerials?: string[]`; maintain `attrsText` (searchable attr values joined); uniqueness of unit barcodes; `list` search also uses `search_attrs`; `posCatalog` includes `units`, `trackSerial`, `warrantyMonths`, `attrs` (searchable ones only).
- `products.lookupLocal` (Q) [inventory or pos] `{code}` → `{product, unit?}` | null — matches barcode, extraBarcodes, unit barcodes, SKU.
- `purchases.create` lines accept `unitName?` (+ `qty` in that unit) and `serials?`; creates `serials` rows IN_STOCK with per-base cost.
- `sales.create` lines accept `unitName?` and `serials?`; enforce rules above; return value unchanged. `sales.refund` handles units and serials.
- `serials.ts`: `list` (Q) [inventory] `{productId?, status?, search?}` ≤500; `lookup` (Q) [pos or inventory] `{serial}` → `{serial, product, sale?, customer?, warrantyStatus: "ACTIVE"|"EXPIRED"|"NONE", daysLeft}` (warranty check screen); `available` (Q) [pos] `{productId}` → IN_STOCK serials ≤200; `writeOff` (M) [inventory, adjustStock] `{serialId, reason}`.
- New error codes in shared/errors.ts: `INVALID_SERIAL`, `SERIAL_EXISTS`, `SERIAL_REQUIRED`, `SERIAL_NOT_AVAILABLE`, `UNIT_BARCODE_EXISTS`, `UNKNOWN_BUSINESS_TYPE`.

### BACKEND-D — barcode catalog, external lookup, phone scanner, internal barcodes
Files: new `catalog.ts`, new `lookups.ts` (actions), new `scanner.ts`, new `barcodes.ts`, new `convex/lib/catalog.ts`, `convex/convex.config.ts` (mount `@convex-dev/rate-limiter`), tests `convex/barcode.test.ts`. Install `@convex-dev/rate-limiter` (npm).
- Shared pure helpers in new `convex/shared/barcode.ts`: `isValidGtin(code)` (EAN-8/13, UPC-A/E check digit), `normalizeGtin` (UPC-A → EAN-13 with leading 0), `isInternal(code)` (EAN-13 prefix 20–29), `makeInternalEan13(seq)` (prefix "20" + 10-digit seq + check digit), `parseGs1(raw)` → `{gtin?, batch?, expiry?: "YYYY-MM-DD", serial?}` for GS1 element strings (AI 01, 10, 17, 21; FNC1/GS separators `\u001d` and `]d2`/`]C1` symbology prefixes), `isValidImei(s)` (15 digits Luhn). Unit tests for all.
- `convex/lib/catalog.ts`: `contribute(ctx, businessId, {barcode, name, brand, size, categoryHint, imageId?})` — skip if business `settings.shareToCatalog === false`, internal barcodes, invalid GTINs, names with URLs/phone numbers/prices; upsert `catalogContributions` (one per business+barcode); recompute catalog row: name = most-confirmed normalized name, `confirmCount` = distinct businesses with that name; status VERIFIED at ≥2 else PENDING (HIDDEN stays hidden). BACKEND-C calls `contribute` from `products.create/update` when a barcode is set (coordinate: BACKEND-D writes the helper first; signature above is fixed).
- `catalog.lookup` (Q) [inventory or pos or purchases] `{code}` → `{local: {product, unit?} | null, catalog: {name, brand, size, categoryHint, imageUrl, confirmCount, source, status} | null, needsRemote: boolean}`. local = same as `products.lookupLocal`. Never returns contributions or business info. needsRemote = valid non-internal GTIN, no catalog row (or NOT_FOUND older than 30 days).
- `lookups.remote` (A) `{code}` — auth via internal query (business member with inventory/pos/purchases); rate-limited per business (60/min, 1000/day) and a global Open Food Facts bucket (12/min) with `@convex-dev/rate-limiter`; fetch Open Food Facts `https://world.openfoodfacts.org/api/v2/product/{code}.json?fields=product_name,brands,quantity,categories_tags,image_front_small_url` with header `User-Agent: Dukaan/1.0 (support contact)`, fallback Open Beauty Facts / Open Products Facts same path; store result via internal mutation into `catalog` (source OPEN_FOOD_FACTS, status PENDING, imageUrl) or `NOT_FOUND`; returns the catalog shape or null. 5 s timeout; never throws to client on network failure (return null).
- `catalog.flag` (M) [any business member] `{barcode}` → flagCount++ (once per business; HIDDEN at ≥3 flags). Platform: `catalog.adminList` (Q) [platform] `{status?}`, `catalog.adminSet` (M) [SUPER_ADMIN] `{barcode, status, name?, brand?, size?}`.
- `barcodes.generate` (M) [inventory] `{productId}` → sets an internal EAN-13 (business-unique, from a per-business counter: store counter on the business doc? — no: compute next from `by_business_barcode` range over prefix "20…"; fine at small scale, mark ponytail) and returns it. `barcodes.generateMissing` (M) [inventory] → for up to 200 products without barcode.
- `scanner.ts`: `createSession` (M) [pos or inventory or purchases] `{target}` → `{code, expiresAt}` (code = 10 random url-safe chars; expires 8 h; deactivates the member's previous sessions); `sessionInfo` (Q) `{code}` [any logged-in member of SAME business] → `{target, active, expired, createdBy}`; `push` (M) `{code, barcode}` [member of same business; session active & not expired; rate-limited 120/min per session] → inserts `scans`; `pending` (Q) `{sessionId}` [session creator only] → unconsumed scans oldest first (≤50); `consume` (M) `{scanIds}` [creator] → consumed=true; `endSession` (M). Old scans cleanup: an internal mutation + daily cron deleting scans/sessions older than 2 days (bounded batches).

---

## Frontend v3

### FRONTEND-D — scanner & barcode UX
Files: new `components/scanner/**` (camera scanner component), new `app/apps/scan/**` (phone pairing page `/apps/scan/[code]`), new `components/inventory/scan-add.tsx`, `components/inventory/labels.tsx`, edits in `components/inventory/products-view.tsx` (Scan button, Print labels, Generate barcodes), `components/purchases/receive-view.tsx` (Scan items mode), `components/inventory/stocktake-view.tsx` (scan to count), `app/apps/pos/page.tsx` (camera scan button + "Use phone as scanner" pairing QR + consuming paired scans), new `app/platform/catalog/**` (moderation). Add deps: `barcode-detector` (ponyfill, lazy-loaded), `jsbarcode` (labels), `qrcode` (pairing QR) — nothing else.
- Scanner component: native `BarcodeDetector` when it supports ean_13 else dynamic import of `barcode-detector/ponyfill` (self-host wasm in `/public` if the package allows; otherwise default); formats ean_13, ean_8, upc_a, upc_e, code_128, code_39, itf, qr_code, data_matrix; rear camera 1280×720; torch toggle when supported; beep + vibrate on read; dedupe same code within 1.5 s; validate GTIN check digits; GS1 parse (`parseGs1`) and pass `{code, gs1}` up; "Type code" fallback; continuous mode; graceful permission-denied / no-camera message; works on HTTPS and localhost.
- **Scan to add** (Inventory → "+ Scan"): camera → `catalog.lookup` → if `needsRemote` call `lookups.remote` (spinner ≤5 s) → result sheet: "Already in your shop" (open / add stock) | "Found · confirmed by N shops / from Open Food Facts" | "New product". Quick-add form prefilled (name, brand → brand, size → attrs/name, category matched by hint to shop categories, image preview from imageUrl with attribution) with **focus on Price**; fields price, cost (if seeCost), opening stock, unit, expiry (if feature), serials (if trackSerial). Save → `products.create` → toast "Added · scan next" → camera reopens. GS1 DataMatrix scan pre-fills batch + expiry.
- **Bulk scan stock-in** (Purchases → Receive → "Scan items"): camera stays open, each scan adds/increments a line (resolve unit barcodes → unit), unknown codes become "needs details" lines with a quick sheet; then the normal receive review.
- **Stocktake scan**: each scan +1 on counted.
- **Phone as scanner**: on POS / Receive / Stocktake / Products, button "Use phone as scanner" → `scanner.createSession` → modal with QR (`/apps/scan/<code>` absolute URL) + code text; desktop subscribes `scanner.pending` and handles each scan exactly like a local scan, then `consume`. Phone page `/apps/scan/[code]`: requires login (same business), big camera, last 5 scans list, connection status.
- **Labels**: select products → print sheet (A4 3×8 and 58 mm thermal options) with name, price, barcode (EAN-13 or Code128 via jsbarcode SVG); "Generate barcodes for products without one".
- **Platform catalog moderation** `/platform/catalog`: list by status/flags, edit/hide/verify (SUPER_ADMIN), PLATFORM_ADMIN read-only. Add a tile in the platform launcher.

### FRONTEND-E — business types & vertical fields
Files: `app/onboarding/**`, `components/business-fields.tsx`, `app/apps/settings/**` + `components/settings/**` (new Features tab), `components/inventory/product-form.tsx`, `components/inventory/product-detail.tsx`, `components/inventory/products-view.tsx` (only: attribute columns/search hint — coordinate with FRONTEND-D who adds buttons there; keep edits small and separate), `components/purchases/receive-view.tsx` (only: unit picker + serials entry per line — FRONTEND-D adds the scan mode; keep separate), `app/apps/pos/page.tsx` + `components/pos/**` (unit picker, serial picker, warranty on receipt), `components/receipt.tsx`, new `app/apps/inventory/serials` view (or `?view=serials`) + warranty check, `lib/features.ts` (`useFeature(f)` reading `me.business` features via `businessFeatures`). Coordinate on shared files: FRONTEND-D and FRONTEND-E both touch `products-view.tsx`, `receive-view.tsx`, `pos/page.tsx` — **FRONTEND-E goes first on those three files; FRONTEND-D starts with its own new files and integrates into those three only after FRONTEND-E reports done** (organizer will tell you).
- Onboarding step "What do you sell?": grid of preset cards (icon, label, description), select up to 3, then business profile step. Pass `businessTypes`.
- Settings → Features: toggles with FEATURE_LABELS; attribute definitions editor (label, type, options, searchable); "Add business type" (applyPreset); "Share product names to the community catalog" toggle (`shareToCatalog`) with a clear privacy explanation (only name/brand/size/image, never prices).
- Product form: sections appear only when their feature is on: Packs & units (rows: unit name from preset suggestions or custom, factor "= N base", barcode, price override with auto-computed default shown); Extra fields (from attributeDefs); Serial tracking toggle + warranty months; opening serials textarea (one per line, count must equal opening stock). Hide variants/expiry/weight/wholesale controls when their features are off (data kept).
- Product detail: units table; attributes; Serials tab (IN_STOCK/SOLD list).
- POS: product with units → tapping opens unit chooser (piece / strip / box with prices) unless scanned via unit barcode; trackSerial product → serial picker (scan IMEI or choose from available list), qty = number of serials; cart line shows unit and serials; receipt shows IMEI and "Warranty until <date>".
- Receive stock: per line unit picker (converts), serials entry for trackSerial lines (textarea/scan; count check).
- Inventory → Serials view: search IMEI, status filter; **Warranty check** (enter/scan IMEI → product, sold date, customer, warranty status) also reachable from POS menu.
- Units suggestions in pickers come from `mergePresets(businessTypes).units`.
