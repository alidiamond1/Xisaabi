# Dukaan - Research V3: Business-Type Presets + Barcode Scan-to-Add

Priority: **P1** = build next, **P2** = after, **P3** = later. Builds on RESEARCH.md.
Evidence tags: **[src]** = found in a fetched/searched source (list at end). **[gk]** = my general product knowledge, not verified this round. Treat [gk] pricing/limits as "check before committing".

**Already in schema (do not re-build):** product `type`, `unit`, `allowDecimal`, `extraBarcodes`, `brand`, `categoryId` (2 levels), variants via `parentId`+`variantLabel`, `wholesalePriceCents`, `trackExpiry` + `batches` (FEFO), `stockMovements`, suppliers/purchases, shifts, refunds, ledger (deen), `reorderLevel`.
**Not in schema:** pack/carton unit conversion, serial/IMEI, warranty, custom attributes, repair jobs, tables/modifiers/recipes, deposits (customer or cylinder), fitment, prescriptions, business-type setting.

---

# PART A - Business types

## A1. What vertical software has that a generic shop lacks

| # | Vertical | Product fields | Workflows | Reports | Sale-unit problem | What generic Dukaan already covers |
|---|---|---|---|---|---|---|
| 1 | **Grocery / mini-market** | Brand, size text, multiple barcodes, expiry, weight flag | Weighed items, hold orders, wholesale tier, credit | Fast/slow movers, expiry loss, margin by category | Carton (24) bought, piece sold; sack (50 kg) bought, kg sold | Most of it. Gap = **pack conversion** |
| 2 | **Pharmacy / chemist** | Generic (INN) name, brand, strength (500 mg), dosage form (tab/syrup/inj), pack size, manufacturer, Rx-only flag, controlled flag, storage (cold), batch+expiry **mandatory** | Sell by strip or by tablet from a box; Rx capture (patient, prescriber) for Rx/controlled; substitute lookup by generic name; expiry block; supplier return of near-expiry | Expiry loss, controlled-drug register, sales by generic | Box > strip > tablet (3 levels). Selling "2 tablets" from a strip is the daily norm | Batches/FEFO/expiry block exist. Gap = **packs, generic search, Rx flag, controlled register** [src: Odoo/ERPNext pharmacy modules; fields from gk] |
| 3 | **Electronics & phones** | Brand, model, **IMEI/serial per unit**, warranty months, condition (new / used / refurbished), storage/colour (variants), accessory compatibility | Warranty lookup by IMEI, trade-in/used purchase from customer, layaway/deposit, supplier return (RMA), IMEI stolen-check | Serial stock list, warranty expiring, margin per unit | Mostly 1:1 per unit; accessories by piece/box | Variants exist. Gap = **serial tracking, warranty, condition** [src: CellSmart, PHP POS, SpudgerHQ] |
| 3b | **Phone repair** (sub-type) | Device model, IMEI, passcode (optional), problem, parts used | **Repair job ticket**: received > diagnosing > waiting parts > done > collected; deposit; technician; parts auto-deducted; SMS/WhatsApp "ready"; warranty on repair | Open jobs, tech productivity, repair margin | Parts by piece, labour = service item | Service product type exists. Gap = **job tickets** [src] |
| 4 | **Mobile-money / airtime agent** | Not stock-based: wallet accounts (EVC, Zaad, eDahab, cash), airtime/scratch-card denominations | Cash-in/cash-out entries, float top-up and rebalancing, commission per txn, daily wallet reconciliation, scratch cards sold by face value | Float position per wallet, commission earned, cash vs e-money mismatch | Denomination (1/5/10 USD cards), commission % not unit price | Payment methods exist, but **no wallet-float ledger**. Keep manual (no merchant API confirmed in RESEARCH.md; results this round also gave no agent-commission or float docs) |
| 5 | **Clothing / shoes / fabric / tailoring** | **Size x colour matrix**, season/collection, style code, material; fabric: metre length, roll | Variant grid entry on purchase, exchange not refund, size-run restock; **tailoring orders**: measurements, fabric chosen, due date, deposit, balance on pickup | Sell-through by size/colour, aged stock, tailor orders due | Fabric by metre (decimal, exists); roll > metre cut | Variants exist (one row each). Gap = **matrix bulk-create UI, custom attributes, order+deposit** |
| 6 | **Cosmetics & perfume (oud, uunsi)** | Brand, size (ml), shade, expiry (PAO), authentic/tester flag; oud/uunsi: **sold by gram/tola**, grade | Decanting (buy 100 ml, sell 5 ml), gift boxes/bundles, weight-based price | Margin per ml/gram, expiry | Bulk (kg/litre) > small unit (g/ml) conversion; price per gram by grade | Decimal exists. Gap = **unit conversion, bundles** |
| 7 | **Hardware & building materials** | Dimensions/spec (size, grade, thickness), brand, multiple units (bag, tonne, piece, metre, length of pipe) | Wholesale vs retail price, quotations, delivery, credit to contractors, partial payment/deposit | Debtors ageing, margin | Cement bag vs tonne; pipes per length vs metre; nails by kg; **most unit-heavy vertical** | Wholesale tier, credit exist. Gap = **unit conversion, quotation, delivery** |
| 8 | **Auto spare parts** | **Part number, OEM number**, brand/aftermarket, **vehicle make/model/year fitment**, cross-reference/supersession, bin location, new/used/refurbished, core charge | Search by part no./vehicle/cross-ref, "alternative if out of stock", core return, special order from supplier, credit to garages | Margin by brand, slow stock (dead parts) | Piece, set, pair (brake pads), litre (oil) | Search index only on name. Gap = **searchable part numbers/cross-ref, fitment** [src: Cleverence, ERPNext auto parts] |
| 9 | **Restaurant / café / tea shop** | Menu item, category, **modifiers** (sugar, size), recipe/ingredients (optional), prep station | **Tables / dine-in / take-away / delivery**, open tab per table, **kitchen ticket**, split bill, tips (rare) | Sales by hour, best dishes, food cost % | Portion/plate, cup sizes; ingredient units (kg flour) vs portions | Hold orders exist. Gap = **tables, modifiers, kitchen print** |
| 10 | **Bakery** | Product with **daily production batch**, shelf-life 1-3 days, recipe (flour kg per loaf), weight-based items | Daily production entry, end-of-day leftover/waste, pre-orders (cakes) with deposit, wholesale to shops (credit) | Waste %, production vs sales | Sack flour (kg) > loaves; dozen vs piece | Expiry/batch can model production batch. Gap = **production entry/waste, pre-order deposit** |
| 11 | **Butcher / meat** | Weighed cuts, price per kg, daily carcass cost, trim yield | Sell by weight, **carcass breakdown** (1 goat > cuts), daily stock zero, scale integration | Yield and margin per carcass | kg only; buy whole animal/head | Decimal exists. Gap = **scale barcode**, simple breakdown (P3) |
| 12 | **Furniture & household** | Dimensions, material, colour (variants), assembly, warranty | **Order-on-request**, deposit/instalments (very common), delivery, quotations | Open orders, instalment ageing | Piece, set (sofa 5-seater) | Credit/deen exists. Gap = **deposits/layaway + instalment schedule, delivery** |
| 13 | **Stationery & bookshop** | Author/ISBN (books), publisher, size, brand, pack | School-season bulk, wholesale tier, photocopy/printing as service items | Seasonality | Ream/pack/dozen vs piece | Barcodes (ISBN) fine. Gap = **pack conversion** |
| 14 | **Wholesale / distributor** | Multiple price tiers, carton/pack, brand, MOQ | Quotation/proforma > invoice, delivery notes, customer credit with terms, salesman/route, bulk purchase orders | Debtors ageing, sales by customer/area, margin | **Carton/dozen/piece** at both buy and sell; mixed-unit lines | Wholesale tier, credit, suppliers exist. Gap = **pack conversion, quotation/invoice, delivery** |
| 15 | **Gas (LPG) & water delivery** | Cylinder size (6 kg, 12.5 kg...), full/empty as two stock states, **cylinder deposit**, brand; water: jerrycan/barrel/tanker litres | **Exchange** (bring empty, get full), deposit on new cylinder, deposit refund on return, delivery run, customer credit (monthly), driver/vehicle | Cylinders out at customers, empties in stock, deliveries per driver | Full vs empty; refill by kg vs whole cylinder; deposit not revenue | Credit exists. Gap = **deposit tracking (asset/liability), empty/full stock, delivery**. No deposit-based cylinder software found for Horn of Africa; Cargas is US propane [src] |
| 16 | **Salon / barber** | Services (haircut, braids, henna) with duration and price; products for retail and "consumed in service" | Appointments (P3), service + product on one bill, **commission per stylist**, packages/prepaid | Revenue per stylist, service mix | Service = no stock; products by piece/ml | Service type exists. Gap = **staff on line item (commission)**, optional booking |

Notes: pharmacy, auto parts, phone-repair, ERP "electronics" rows draw on vendor marketing pages (CellSmart, PHP POS, SpudgerHQ, Cleverence, ECOSIRE) - fine for the feature list, not independent evidence of demand. Somali-market demand ranking below is my judgement [gk].

## A2. Feature matrix (rows = feature, cols = vertical)

Cols: **Gro**cery, **Pha**rmacy, **Ele**ctronics/repair, **Mob**ile-money, **Clo**thing/tailor, **Cos**metics/oud, **Har**dware, **Aut**o parts, **Res**taurant, **Bak**ery, **But**cher, **Fur**niture, **Sta**tionery, **Who**lesale, **Gas**/water, **Sal**on.

| Feature | Gro | Pha | Ele | Mob | Clo | Cos | Har | Aut | Res | Bak | But | Fur | Sta | Who | Gas | Sal |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Pack/unit conversion** (carton>piece, box>strip>tab, kg>g) | ✓ | ✓ | | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | | ✓ | ✓ | | |
| Decimal / weight | ✓ | | | | ✓ | ✓ | ✓ | | | ✓ | ✓ | | | ✓ | ✓ | |
| Expiry batches (exists) | ✓ | ✓ | | | | ✓ | | | ✓ | ✓ | ✓ | | | ✓ | | ✓ |
| **Serial / IMEI per unit** | | | ✓ | | | | | | | | | ✓ | | | ✓ (cylinder no., P3) | |
| **Warranty** (months, print on receipt) | | | ✓ | | | | | ✓ | | | | ✓ | | | | |
| Condition new/used | | | ✓ | | ✓ | | | ✓ | | | | ✓ | | | | |
| **Custom product attributes** (strength, dosage form, part no., OEM no., ISBN, dimensions) | | ✓ | ✓ | | ✓ | ✓ | ✓ | ✓ | | | | ✓ | ✓ | | ✓ | |
| Variant matrix (size x colour) | | | ✓ | | ✓ | ✓ | | | | | | ✓ | | | | |
| **Service / repair job tickets** | | | ✓ | | ✓ (tailor) | | | ✓ (garage, P3) | | | | | | | | ✓ |
| **Deposit / layaway / partial pay** | | | ✓ | | ✓ | | ✓ | ✓ | | ✓ (cakes) | | ✓ | | ✓ | ✓ (cylinder) | |
| **Tables, modifiers, kitchen ticket** | | | | | | | | | ✓ | | | | | | | |
| Recipes / production | | | | | | | | | ✓ | ✓ | ✓ | | | | | |
| Rx / controlled-drug register | | ✓ | | | | | | | | | | | | | | |
| Fitment / cross-reference search | | | | | | | | ✓ | | | | | | | | |
| Wallet float ledger + commission | | | | ✓ | | | | | | | | | | | | |
| Staff commission per line | | | | ✓ | | | | | | | | | | | | ✓ |
| Quotation / invoice / delivery note | | | | | | | ✓ | ✓ | | | | ✓ | | ✓ | ✓ | |
| Delivery / driver | ✓ (some) | | | | | | ✓ | | ✓ | | | ✓ | | ✓ | ✓ | |
| Wholesale price tier (exists) | ✓ | | | | | | ✓ | ✓ | | ✓ | | | ✓ | ✓ | | |
| Customer credit / deen (exists) | ✓ | ✓ | ✓ | | ✓ | | ✓ | ✓ | | ✓ | ✓ | ✓ | | ✓ | ✓ | |
| Scale / weight barcode | ✓ | | | | | | | | | ✓ | ✓ | | | | | |
| Service items (no stock) (exists) | | | ✓ | ✓ | ✓ | | | | | | | | ✓ | | ✓ | ✓ |
| Bundles / kits | ✓ | | ✓ | | | ✓ | | | ✓ | | | | | | | ✓ |

## A3. Cross-cutting features ranked by verticals unlocked

| Rank | Feature | Verticals unlocked | Pri | Schema hint |
|---|---|---|---|---|
| 1 | **Unit conversion / packs** (buy carton, sell piece; box>strip>tablet; kg>g) | Grocery, pharmacy, cosmetics, hardware, auto, bakery, stationery, wholesale, clothing (~9) | **P1** | `productUnits[]`: {name, factor to base, barcode?, priceCents?, isDefaultSale, isDefaultBuy}. Stock always in base unit; POS line carries chosen unit. Pack barcode maps to pack unit (use existing `extraBarcodes` idea but with factor) |
| 2 | **Custom attributes per product** (typed fields switched on by preset) | Pharmacy, electronics, auto, hardware, furniture, stationery, cosmetics, clothing (~8) | **P1** | `attrs: record<string,string>` on product + business-level `attributeDefs` (label, type, searchable). Searchable ones feed search index (part no., generic name) |
| 3 | **Deposits / partial payments / layaway / orders** (customer deposit against an order, balance later) | Electronics, repair, tailoring, furniture, hardware, bakery, wholesale, gas (~8) | **P1** | `orders` with status + `depositCents`; reuse customer ledger. Gas cylinder deposit = same mechanism with a "returnable" flag |
| 4 | **Serial / IMEI tracking + warranty** | Electronics, repair, furniture, auto parts, appliances (~4-5, but highest ticket value) | **P1** (phones are very common) | `serials` table: productId, serialNo, status (in stock/sold/returned), costCents, soldSaleId, warrantyMonths; scan at sale; warranty lookup screen |
| 5 | **Service / repair jobs** (ticket with customer, device, problem, parts, labour, deposit, status, WhatsApp "ready") | Phone repair, tailoring, garage, salon (jobs-lite), furniture (~4) | **P2** | `jobs` table; parts become stock movements; closing creates a sale |
| 6 | **Quotation / invoice / delivery note** (A4 print, due date) | Wholesale, hardware, furniture, auto, gas (~5) | **P2** | Already P2 in RESEARCH.md; share with delivery status |
| 7 | **Tables / modifiers / kitchen ticket** | Restaurant, café, tea shop, bakery (partial) (~2-3, but large market in Somalia) | **P2** | `tables`, `modifiers`; hold orders already similar to open tabs |
| 8 | **Staff on line + commission; wallet-float ledger** | Salon, mobile-money agent | **P3** | Small, vertical-specific |

Other items kept off the cross-cutting list: Rx/controlled register (P2, pharmacy only), fitment (P3 - searchable part-number attrs + cross-ref text covers 80%), recipes/production (P3), appointment booking (P3).

## A4. Market priority (Somalia) [gk judgement]

| Pri | Verticals | Reason |
|---|---|---|
| **P1** | Grocery/mini-market, wholesale/distributor, pharmacy, electronics/phones | Largest counts, highest stock value, existing modules fit; packs + attributes + serial solve most gaps |
| **P1** | Mobile-money/airtime shop (as a **light** preset: services + cash/wallet reconciliation) | Ubiquitous; most are also a grocery/phone shop |
| **P2** | Clothing/fabric, cosmetics/perfume, hardware, restaurant/tea shop, bakery, auto parts | Large but need deposits/tables/part-number search |
| **P3** | Furniture, stationery, butcher, gas/water, salon | Smaller or need bespoke flows (deposit assets, commission) |

## A5. Business-type preset system - recommendation

**Principle:** one data model; presets only set *flags and defaults*. No per-vertical code forks. Owner can override every toggle later in Settings > Features. Multi-type allowed (a shop is often grocery + phone + airtime).

At onboarding: "What do you sell?" - multi-select cards (max 3). Result writes `business.features` (set of flags) + `business.attributeDefs` + seeds categories/units. Nothing is deleted if they change later.

| Preset | Switched on | Product form shows | Default categories (seed) | Default units | POS extras |
|---|---|---|---|---|---|
| **General shop (default)** | core only | name, barcode, price, stock | Food, Drinks, Household, Other | pcs, kg, litre, carton | - |
| Grocery | packs, expiry (per product), weight barcodes | brand, size, pack/carton unit, expiry toggle | Rice & flour, Oil, Sugar, Dairy, Drinks, Snacks, Cleaning, Hygiene | pcs, kg, carton, sack, dozen, litre | scale barcode, wholesale tier |
| Pharmacy | packs (box/strip/tablet), expiry **forced on**, attributes, Rx flag | generic name, strength, dosage form, manufacturer, Rx-only, controlled | Antibiotics, Painkillers, Vitamins, Baby, First aid, Chronic, Devices | box, strip, tablet, bottle, vial, tube | expiry block, "sell by strip/tab", substitute search |
| Electronics & phones | serial/IMEI, warranty, condition, variants | brand, model, IMEI toggle, warranty months, condition, storage/colour | Phones, Accessories, Chargers, Audio, Computers, Parts | pcs | IMEI scan, warranty print, trade-in (P3) |
| + Repair add-on | jobs | - | Repair services, Spare parts | pcs | job tickets, deposits |
| Mobile money / airtime | services, wallet reconciliation (P3) | service/airtime item with denomination | Airtime, Data bundles, Cash-in/out fees | USD | quick-sell service tiles |
| Clothing / fabric | variant matrix, orders+deposit (tailoring) | size, colour, season, condition | Men, Women, Kids, Shoes, Fabric, Accessories | pcs, pair, metre | size grid picker |
| Cosmetics & perfume | packs, decimal, bundles, expiry optional | brand, size (ml), shade, gram/tola price for oud | Perfume, Oud & uunsi, Skin, Hair, Makeup | pcs, ml, gram, tola, bottle | sell by weight |
| Hardware | packs, attributes, quotation, delivery | spec (size/grade), brand | Cement & sand, Steel, Paint, Plumbing, Electrical, Tools | bag, tonne, piece, metre, kg | quotation, wholesale tier |
| Auto parts | attributes (part no., OEM no., fitment text, cross-ref), condition | part no., OEM no., vehicle fits, bin | Engine, Brakes, Filters, Electrical, Tyres, Oils | pcs, set, pair, litre | search by part no./cross-ref |
| Restaurant / café | tables, modifiers, kitchen ticket, recipes (P3) | modifiers, prep station | Meals, Tea & coffee, Juice, Snacks | plate, cup, pcs | table/tab, kitchen print |
| Bakery | production/waste entry, pre-order deposit | shelf-life days | Bread, Cakes, Pastries, Ingredients | pcs, kg, dozen | pre-order deposit |
| Butcher | weight, scale barcode | - | Beef, Goat, Camel, Chicken, Offal | kg | scale barcode |
| Furniture & household | orders+deposit, delivery, warranty | dimensions, material | Beds, Sofas, Tables, Kitchenware | pcs, set | deposit/instalments |
| Stationery & books | packs, attributes | ISBN/author | Books, Pens, Paper, School bags | pcs, ream, dozen, pack | - |
| Wholesale | packs, wholesale tiers, quotation/invoice, delivery | carton/pack, tier prices | (by trade) | carton, dozen, pcs, sack | quotation, delivery note |
| Gas & water | deposits (returnable), full/empty stock, delivery | cylinder size | LPG, Accessories, Water | cylinder, litre, jerrycan | exchange, deposit, delivery |
| Salon / barber | services, staff on line | duration | Hair, Beard, Braids, Nails, Products | service, pcs | commission (P3) |

**Implementation rules**
- `business.features: string[]` read by a single `useFeature("serials")` hook; UI hides, API still accepts (no data loss on toggle).
- Product form = core fields + "More details" section rendered from `attributeDefs` (preset-seeded, owner editable).
- Seed categories once, as editable data (not code); offer "skip".
- Build order: P1 = `features` flag + presets screen + **unit conversion** + **attributes**; then serials/warranty; then deposits/orders; then jobs, quotations, tables.

---

# PART B - Barcode scan-to-add

## B1. In-browser camera scanning

**BarcodeDetector support [src: MDN, caniuse]**

| Browser | Status |
|---|---|
| Chrome / Chromium Android, Samsung Internet, Opera Mobile | Supported (uses Google Play Services/ML Kit on device) |
| Chrome desktop | Partial (macOS/ChromeOS; not all OS) |
| Safari iOS / macOS | **Disabled by default** (17.0 to 26.5 per caniuse) - treat as unsupported |
| Firefox (incl. Android) | Not supported |
| Requirement | HTTPS, camera permission, start from user tap |

**Libraries**

| Option | Size / engine | EAN-13/UPC/Code128 | Cheap-Android perf | Licence / cost | Verdict |
|---|---|---|---|---|---|
| **Native `BarcodeDetector`** | 0 KB, hardware-assisted | Yes (also QR etc.) | Best | Free | **Primary** on Android Chrome (most Somali phones) |
| **`barcode-detector` ponyfill** (ZXing-C++ via `zxing-wasm`) | wasm ~1 MiB full reader build (zxing-wasm reader-only ~966 KiB; ~1.37 MiB full) [src] | Yes | Good (WASM, much faster than old JS ZXing) [gk] | Apache-2.0 (ZXing) [gk] | **Fallback** for iOS/Firefox/old WebViews. Self-host the `.wasm` (default fetches from jsDelivr [src]) and cache it in the service worker so it works offline |
| `@zxing/browser` (zxing-js) | JS, larger, slower | Yes | Poor on cheap phones [gk] | Apache-2.0 | Upstream zxing-js is unmaintained [src: Scanbot, a vendor] - skip |
| `html5-qrcode` | wraps zxing-js | Yes, QR-oriented | Camera init problems on some Samsung phones; unmaintained [src: Scanbot] | Apache-2.0 | Skip |
| Quagga2 | pure JS, 1D focus | Yes (1D) | Mediocre in low light, sensitive to blur [gk] | MIT | Skip unless wasm blocked |
| STRICH | commercial JS+wasm | Yes | Strong [gk] | Paid per domain/year [gk, price unverified] | Only if accuracy complaints persist |
| Scandit / Dynamsoft | commercial SDK | Best | Best | Expensive, enterprise licences [gk] | Not for this price point |

**Recommendation:** feature-detect `BarcodeDetector` (`getSupportedFormats()` includes `ean_13`) > use it; else dynamically import the `barcode-detector` ponyfill (lazy, only on first scan; not in the main bundle). Restrict formats to `ean_13, ean_8, upc_a, upc_e, code_128, code_39, qr_code, itf` (faster). Always keep **manual barcode typing** and a USB/Bluetooth scanner path (keyboard wedge) as the third fallback. Tips: request `facingMode: environment`, 1280x720, enable torch/zoom when `track.getCapabilities()` offers it, debounce duplicate reads, beep/vibrate on success, confirm with check digit validation.

## B2. Product databases by barcode

| Source | Coverage | Fields | Terms / limits | Cost | Use? |
|---|---|---|---|---|---|
| **Open Food Facts** (OFF) | Strong in France/EU/US; **very thin for Africa/Gulf**: country snapshots show Kenya ~33, Ethiopia ~15, Turkey ~55-83 products (mirrors disagree, old) [src] | Name, brand, quantity ("500 g"), categories, images, ingredients, nutrition | ODbL (attribution + share-alike on derived **databases**); images CC-BY-SA; custom User-Agent required; **15 req/min/IP product reads, 10/min search**; bulk via CSV/JSONL dumps; limits apply per end-user IP if calls come from the client [src] | Free | **Yes, via server** |
| Open Beauty Facts / Open Products Facts / Open Pet Food Facts | Same engine, same ODbL. Beauty reported small and slowed [src, weak]; OPF small | Name, brand, size, image | Same as OFF; same API shape (`/api/v2/product/{code}`) | Free | Yes as 2nd/3rd fallbacks (query only if OFF miss) |
| **UPCitemdb** | US-centric; some global EAN [gk] | Title, brand, category, images, size, offers | Free: 100 lookups/day (20 search) per IP, no signup; paid DEV $99/mo (20k lookups/day), PRO $699/mo [src] | Free tier is **too small for a shared service**; DEV is the realistic tier | Optional, behind cache, only on miss |
| Go-UPC | US/global retail | Name, brand, category, image, specs | Plans from about $20/mo (one 3rd-party source, unverified) [src weak] | Paid | Optional |
| Barcode Lookup (barcodelookup.com) | Large (claims 1B+ [gk]) | Rich + stores/prices | Trial via Zyla; own pricing page not confirmed [src weak]. Terms often restrict storing/redistributing results [gk] - **check before caching into shared catalog** | Paid | Evaluate only if OFF+community catalog under-perform |
| EAN-Search.org | Good EU/Global EAN [gk] | Name, category, issuing country | Pricing not confirmed this round [src weak] | Paid (cheap) [gk] | Evaluate; issuing-country field helps flag origin |
| Verified by GS1 / GS1 GEPIR | Authoritative **licence owner** data (company, brand), not retail attributes | Company name, brand, product description (limited) | Membership/API access via GS1; pricing not found [src gap] | Paid/member | Not worth it for v1 |
| Edamam, Nutritionix | Nutrition-focused, US/EU | Nutrition | Commercial terms | Paid | Skip (we do not need nutrition) |
| Google/web scraping | - | - | Violates terms | - | No |

**Realistic Somalia coverage [gk estimate, not measured]:** imported branded FMCG (Coca-Cola, Indomie, Nido, Dettol, Nivea, Colgate, Pampers, Samsung chargers) - likely 40-60% hit rate across OFF + paid DBs. Turkish/UAE/Kenya/Ethiopia/Oman/India/China goods: low OFF coverage, higher in UPC/EAN paid DBs. Local goods, loose items, repacked sugar/rice, shop-packed oud, tea-shop items: **no barcode or in-store barcode** -> 0%. Plan for the **first lookups to miss**, and treat the shared community catalog as the main engine. Test: scan 100 real shelf items at 3 Mogadishu/Hargeisa shops before paying for any API.

**Medicines**

| Source | Reality |
|---|---|
| openFDA NDC (US) | US labelers only; irrelevant for most Somali imports [gk] |
| Turkey ITS | National track-and-trace on GS1 DataMatrix (GTIN+serial+batch+expiry) but **not a public lookup** [src] |
| Kenya PPB / DHA | Unique identifier (DataMatrix) required on imported medicines **from 1 Jan 2027**; no public GTIN database found [src] |
| Somalia | No national drug GTIN registry found [gk] |
| Practical | Medicine boxes carry EAN-13 or GS1 DataMatrix. Decode GTIN, batch, expiry from DataMatrix **on-device** (GS1 element strings AI 01/10/17) - this fills **batch + expiry** without any API. Name/strength comes from community catalog or manual. Parse GS1-128/DataMatrix AIs in our scanner (cheap win for pharmacy) |

**Phone IMEI / TAC:** First 8 digits of IMEI = TAC. Osmocom TAC database (tacdb.osmocom.org): free, community, **CC-BY-SA 3.0**, full dataset downloadable, no official API - import into our own table and index by TAC [src]. Community GitHub dumps exist (~255k rows, MIT, accuracy unverified) [src]. Coverage of newer and Chinese models is incomplete [src: Kaggle note] so show "model guess, confirm". The GSMA database is partner-only [src]. Validate IMEI with the Luhn check locally. Many Somali shops sell used phones, so also offer "IMEI.info" style manual check link (opens external, no API) [gk].

## B3. Shared community catalog

**How others do it:** Square for Retail "create items by scanning barcodes" suggests category, description, price from web information for the GTIN [src]. Odoo has no built-in shared catalog; third-party module `ts_pos_barcodelookup` calls Barcode Lookup API with the shop's own key and checks for duplicates [src]. I found nothing on Loyverse's behaviour this round [src gap]. No competitor publicly runs a multi-tenant "network effect" catalog among these; it is a differentiator but also a risk area [inference].

**Design**

| Topic | Decision |
|---|---|
| Table `catalog` (global, not tenant-scoped) | `barcode` (unique), `name`, `brand`, `size` (text e.g. "500 ml"), `categoryHint`, `imageId?`, `confirmCount`, `lastSource` (community / off / upcitemdb), `status` (pending / verified / hidden), `createdAt` |
| What is shared | **Only** barcode, name, brand, size, category hint, image. **Never**: price, cost, stock, supplier, customer data, shop identity |
| Who owns data | Our ToS: shops grant a licence to share non-sensitive catalog fields; no per-shop attribution shown. Add opt-out toggle in Settings for privacy-sensitive owners |
| Quality | When a shop saves a product with a barcode: if no catalog row -> insert as `pending`. If exists and name matches (normalized) -> `confirmCount++`. If differs -> store as alternative candidate. Auto-promote to `verified` at N=2 independent shops (distinct businesses). Show top candidate by confirmations. Flag/report button; admin queue for flagged. Reject names with phone numbers/prices/URLs (anti-spam). Rate limit writes per business |
| Language | Store `name` as typed + optional `nameSo`/`nameEn` later; auto-fill whichever language the user typed in, keep original |
| Images | Own uploads only when user took the photo; for OFF images respect CC-BY-SA (store attribution URL) or just hotlink thumbnail and avoid copying until needed |
| ODbL caution | Mixing OFF data into our catalog makes our **catalog database** a derived ODbL database if we publicly redistribute it. Mitigate: do not expose bulk export or public catalog API; keep OFF results as a per-lookup cache labelled with source, or confirm with reuse@openfoodfacts.org [src]. Paid APIs often forbid caching into a redistributed DB [gk] - read their terms before copying their results to the shared catalog |
| Lookup order | 1) shop's own products (by barcode and `extraBarcodes`) > 2) shared catalog (`verified`, then `pending`) > 3) external APIs (server-side, only on miss) > 4) manual entry (always possible) |
| Cache | Store external hits in `catalog` marked `source` + `fetchedAt`; store negative results (`notFound` with TTL 30 days) so repeated scans do not hit rate limits |

## B4. Products without barcodes

| Need | Approach |
|---|---|
| In-store EAN-13 | GS1 reserves prefixes **20-29** for retailer-internal use (GS1 UK: use in a closed environment, not across retailers) [src]. Generate `2` + business-scoped counter (e.g. `20` + 10-digit item id) + check digit; unique per business only. Mark as `internal` so it never enters the shared catalog |
| Alternative | Code 128 with SKU text - simpler, any length, scanners read it; preferred for short SKUs and bins |
| Labels | Printable A4 sheet (e.g. 3x8, 65 per sheet) via browser print + SVG barcode; 58 mm thermal label roll for shops with a thermal printer (WebUSB/Bluetooth is flaky; use `window.print()` with CSS page size) [gk]. Include name, price, barcode, optional shop name. Barcode font/SVG: JsBarcode (MIT) or bwip-js [gk] |
| Scale / weight barcodes | EAN-13 starting 2x: `2x` + item code (PLU) + price or weight digits + check digit; item code+value length = 10 digits; some include a price verifier; exact layout varies by scale and retailer [src]. Support a configurable parser: prefix, PLU digits, value digits, value = price or weight, divisor. Look up product by PLU (a number set on product), compute qty or amount |
| Bulk labelling | "Generate barcodes for all products without one" action + print queue (P2) |

## B5. Phone as wireless scanner for desktop POS

| Aspect | Finding |
|---|---|
| Done by others? | Yes: apps like TEC-IT Wireless Barcode Scanner send scans via Bluetooth, TCP/IP, HTTP or WebSocket, with keyboard-wedge option; TEC-IT says development discontinued [src]. A Flutter package `wifi_barcode_scanner` exists (very low adoption) [src]. No QR-paired in-browser product found in results |
| Our approach | Pairing by QR: POS shows QR with `https://app/scan/{pairCode}`; phone opens (no install, same login or one-time token); phone sends each decoded code via **Convex mutation** `scans.push(pairCode, barcode)`; POS subscribes to a Convex query (realtime already built in) and handles it like a scanned barcode. No WebSocket server to run and works across networks (no same-Wi-Fi requirement) |
| Security | Pair code is single-use, expires (e.g. 8 h or on POS sign-out), bound to one business + one POS session; phone must be signed in as a member of the same business or hold the token; rate limit pushes; rows auto-deleted after consumption |
| Offline | Needs internet (or LAN); fall back to manual entry or USB scanner. For fully offline, phone and POS cannot talk without a LAN channel - skip |
| UX | "Continuous mode": phone camera stays open, flashes green/beep on each accepted code, shows last 3 items |

## B6. Recommended architecture

```
Phone camera -> BarcodeDetector | barcode-detector (wasm) -> code (validated: check digit, GS1 parse)
     |
     v
Convex mutation/action: lookupBarcode(code)   [auth + business context]
   1. products by_business_barcode / extraBarcodes   -> "Already in your shop" (open product)
   2. catalog (global) verified/pending              -> prefill + show "confirmed by N shops"
   3. external fetch (server action only):
        OFF (+ Beauty/Products/Pet) -> optional paid API (UPCitemdb/EAN-Search) with API key in env
        cache result in catalog; cache misses with TTL
   4. none -> blank form with barcode filled
     |
     v
Client form: name, brand, size, category (mapped from hint to shop categories), image; user types price + stock (+ cost, expiry)
     |
     v
Save: products.insert; catalog.contribute(code, fields) (non-sensitive only); stockMovements OPENING
```

Server-side requirements

| Concern | Rule |
|---|---|
| API keys | Only in Convex env vars, used in `action`s; never shipped to browser. Browser never calls OFF/UPCitemdb directly (OFF limit is per IP: one shared server IP would be throttled at 15 req/min, so queue + cache) |
| Rate limiting | Per business and per user (e.g. 60 lookups/min, 2,000/day), global token bucket per upstream (OFF 15/min product reads; UPCitemdb 100/day free) |
| Caching | `catalog` table is the cache; dedupe in-flight lookups for the same code; negative cache 30 days; refresh pending entries on confirm |
| User-Agent | Custom, e.g. `Dukaan/1.0 (contact email)` for OFF [src] |
| Validation | Check digit for EAN-13/8/UPC; reject internal 2x prefix for external lookups |
| Abuse | Moderation fields and flag button; strip URLs/phones from names |
| Licensing | Keep `source` per row; no public export; legal review before mixing paid-API data into shared catalog |
| Cost | OFF is free; paid APIs only on catalog miss after N community attempts; monitor hit rate and enable paid tier only if hit rate < target |

## B7. Screens / flows

**Scan to add (single)**
| Step | Screen | Behaviour |
|---|---|---|
| 1 | Products > "+ Scan" | Full-screen camera, torch toggle, "type barcode" link, "no barcode" -> generate internal |
| 2 | Result sheet (≈1 s) | State chip: *In your shop* (jump to product / add stock) / *Found* (source + "confirmed by N shops") / *New* (blank) |
| 3 | Quick-add form | Prefilled name, brand, size, category, image. **Focus on Price.** Fields: price, cost (optional), stock qty, unit (preset default), expiry (if preset needs it) |
| 4 | Save | Toast "Added. Scan next" returns to camera (continuous) |

**Bulk scan stock-in**
| Step | Behaviour |
|---|---|
| 1 | Stock > Receive > "Scan items" (optionally pick supplier) |
| 2 | Camera stays open; each scan adds/increments a line; known products show name and current stock; unknown barcode drops a "needs details" line (quick sheet: name, price) without blocking the scan flow |
| 3 | Line list with +/- qty, unit (carton/piece), cost, batch/expiry (pharmacy/grocery presets); duplicates merge |
| 4 | Review: totals, paid now vs credit (reuses Receive-stock form) > Save > creates purchase, batches, movements |
| Extras | "Count mode" variant for stocktake using the same scanner; GS1 DataMatrix scans prefill batch+expiry |

**Measure of success (suggested):** time-to-add per product (target < 20 s), % of scans auto-filled, % of auto-fills edited (quality signal), catalog size and confirmation rate.

**Build order:** (1) scanner component + native/ponyfill + product lookup by own barcode; (2) `catalog` table + contribute/confirm; (3) OFF server lookup with cache + rate limit; (4) bulk stock-in; (5) phone-as-scanner pairing; (6) label printing + internal barcodes + scale parser; (7) paid API only if needed; (8) GS1 DataMatrix parse for pharmacy; (9) TAC import for IMEI model hint.

---

# Sources
- BarcodeDetector support: https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector , https://caniuse.com/mdn-api_barcodedetector
- `barcode-detector` ponyfill / zxing-wasm: https://cdn.jsdelivr.net/npm/barcode-detector@3.2.1/README.md , https://cdn.jsdelivr.net/npm/zxing-wasm@3.0.2/README.md , https://socket.dev/npm/package/barcode-detector/overview/3.0.7 , https://jsr.io/@marianmeres/scanner
- Open-source scanner status (vendor blog, treat as biased): https://scanbot.io/blog/popular-open-source-javascript-barcode-scanners/ ; html5-qrcode summary: https://best-of-web.builder.io/library/mebjas/html5-qrcode
- Open Food Facts API, limits, ODbL: https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/ , https://support.openfoodfacts.org/help/en-gb/12-api-data-reuse/94-are-there-conditions-to-use-the-api , https://wiki.openfoodfacts.org/ODBL_License
- OFF country counts (snapshots, inconsistent): https://world.openproductsfacts.org/countries , https://world.openfoodfacts.org/origins
- Open Beauty Facts: https://linuxfr.org/news/open-beauty-facts-que-contiennent-vraiment-nos-produits-cosmetiques
- UPCitemdb plans: https://www.upcitemdb.com/wp/docs/main/development/plan/
- Go-UPC / Barcode Lookup / EAN-Search (weak, third-party): https://geekflare.com/upc-lookup-apis , https://www.g2.com/products/barcode-lookup-api/pricing , https://publicapis.io/alternatives/ean-search-api
- GS1 in Africa / GEPIR gap: https://apify.com/caulleonard/gtin-barcode-validator , https://gna.org.gh/2023/10/gsa-director-general-urges-smes-to-use-global-standards-to-expand-trade-under-afcfta/
- Medicines: https://www.kenyans.co.ke/news/126289-imported-medicines-face-new-identification-requirement-january-moh-confirms , https://www.lspedia.com/regulation/turkiye , https://www.tigahealth.com/turkiye-saving-1-billion-dollars-annually-with-its
- TAC / IMEI: https://tacdb.osmocom.org/ , https://en.wikipedia.org/wiki/Type_Allocation_Code , https://github.com/MoazEb/tac-database
- Shared catalog / scan-to-create: https://squareup.com/help/us/en/article/7992-automate-item-creation-with-square-for-retail , https://apps.odoo.com/apps/modules/18.0/ts_pos_barcodelookup
- In-store / variable-weight EAN: https://en.wikipedia.org/wiki/International_Article_Number , https://gs1uk.org/support-training/help-to-use-and-implement-gs1-standards/barcode-variable-measure-items , https://www.keyence.com/ss/products/auto_id/codereader/basic/ean.jsp
- Phone as scanner: https://www.tec-it.com/en/software/android/wireless-barcode-scanner/overview/Default.aspx , https://pub.dev/packages/wifi_barcode_scanner/example
- Vertical software: pharmacy https://ecosire.com/apps/odoo/pharmacy-retail-pos ; repair POS https://www.cellsmartpos.com/blog/repair-ticket-systems , https://phppointofsale.com/cell-phone-repair-software.php ; auto parts https://www.cleverence.com/articles/business-blogs/best-odoo-for-auto-parts-63827415/ , https://ecosire.com/apps/erpnext/erpnext-automotive-spare-parts ; LPG exchange https://www.lpgasmagazine.com/cylinder-exchange-software
- Somalia mobile money context: https://www.cnbcafrica.com/2021/somalia-issues-its-first-mobile-money-licence-to-hormuud-telecom/
- Not found / unverified this round: Loyverse catalog behaviour; Go-UPC, Barcode Lookup, EAN-Search official pricing; Verified by GS1 API pricing; actual hit rates for Somali goods; EVC agent commission/float rules; STRICH/Scandit/Dynamsoft pricing.
