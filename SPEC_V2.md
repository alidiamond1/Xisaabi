# Dukaan v2 — Deep modules (contract for all agents)

Read `SPEC.md` first: tenancy rules (Section 1) still apply to EVERY function, unchanged.
Then `RESEARCH.md` "Recommended Scope" (this build = that P1 list) and `DESIGN.md` (UI contract).

Fresh database (new Convex deployment): no data migration needed.

## Foundation already written by the organizer — use, don't rewrite
- `convex/schema.ts` v2: categories, products (type, sku, extraBarcodes, brand, unit, allowDecimal, wholesale price, reorderLevel, trackExpiry, variants via parentId), batches, stockMovements, suppliers, supplierLedger, purchases, customers (extended), ledger (OPENING/ADJUST_UP/ADJUST_DOWN/WRITE_OFF), shifts, cashMovements, sales (payments[], line discounts, refundedQty, batches used, shiftId), refunds, expenses (paidVia, payee, shiftId), members.permissions, business.settings (paymentMethods, maxCashierDiscountPercent, defaultCreditLimitCents, expenseCategories, discountPresets).
- `convex/lib/stock.ts`: `stockOut` / `stockIn` / `roundQty`. **The ONLY way to change `products.stock` or batch qty.** Writes stockMovements. FEFO, expiry block, weighted-average cost on PURCHASE.
- `convex/lib/access.ts`: + `requirePermission(member, perm)`; getOwned supports all new tables.
- `convex/shared/permissions.ts`: `hasPermission`, `ROLE_DEFAULTS`, `PERMISSION_LABELS`.
- `convex/shared/modules.ts`: + module `purchases` (OWNER, MANAGER).
- `convex/shared/errors.ts`: new codes (EXPIRY_REQUIRED, NO_PERMISSION, DISCOUNT_TOO_HIGH, CREDIT_BLOCKED, SHIFT_REQUIRED, SHIFT_ALREADY_OPEN, PAYMENT_MISMATCH, REFUND_TOO_MUCH, REASON_REQUIRED, SKU_EXISTS).

Payment methods: `CASH | EVC | ZAAD | EDAHAB | BANK | CREDIT` (EVC = Hormuud EVC Plus, ZAAD = Telesom Zaad, EDAHAB = Somtel eDahab).
Quantities may be decimal only when `product.allowDecimal`; otherwise positive integers. Money always integer cents.
Permission checks: cost/profit fields are returned only if `hasPermission(member, "seeCost")` (strip `costCents` etc. otherwise).

---

## Backend API v2

### Inventory — owner: BACKEND-A
`categories.ts` [inventory; `list` also pos]
- `list` (Q) → `{_id, name, parentId}[]`; `create` (M) `{name, parentId?}`; `rename` (M) `{categoryId, name}`; `remove` (M) `{categoryId}` (fails INVALID_INPUT if used by products or has children)

`products.ts`
- `list` (Q) [inventory] `{search?, categoryId?, type?, filter?: "LOW"|"OUT"|"EXPIRING"|"ARCHIVED"}` → products (variants included, with `parentName`), + `imageUrl`, `categoryName`, `nearestExpiry?`, `expiryStatus`; cost stripped without seeCost
- `get` (Q) [inventory] `{productId}` → `{product, imageUrl, variants, batches, movements (latest 100), supplier}`
- `posCatalog` (Q) [pos] → sellable rows (not archived, not `hasVariants` templates): `{_id, name (with variant label), barcode, extraBarcodes, sku, categoryId, unit, allowDecimal, type, priceCents, wholesalePriceCents, stock, trackExpiry, sellableUntil? (nearest non-expired batch expiry), allExpired: boolean, imageUrl}`
- `create` (M) [inventory] `{type, name, sku, barcode, extraBarcodes, categoryId?, brand, unit, allowDecimal, costCents, priceCents, wholesalePriceCents?, reorderLevel, trackExpiry, supplierId?, imageId?, openingStock?, openingBatch?: {batchNo, expiryDate}, variants?: [{label, sku, barcode, priceCents, costCents, openingStock}]}` → productId. Opening stock via `stockIn(..., "OPENING")`. With variants: parent `hasVariants:true, stock 0`, one child product per variant. Barcode/SKU unique per business across barcode + extraBarcodes (BARCODE_EXISTS / SKU_EXISTS). Plan maxProducts.
- `update` (M) [inventory] `{productId, ...same fields minus opening*/variants}` — price/cost changes need `editPrice`. Stock is NOT editable here.
- `addVariant` (M) `{parentId, label, sku, barcode, priceCents, costCents}`
- `archive` (M) `{productId, archived}`
- `generateUploadUrl` (M) [inventory]
- `exportCsv` (Q) [inventory] → rows for CSV (client builds file)
- `importCsv` (M) [inventory] `{rows: [{name, sku, barcode, category, brand, unit, costCents, priceCents, wholesalePriceCents?, stock, reorderLevel}]}` (≤500 rows) → `{created, skipped: [{row, reason}]}`; creates categories by name

`inventory.ts` [inventory]
- `adjust` (M) `{productId, delta, reason: "DAMAGED"|"EXPIRED"|"LOST"|"FOUND"|"CORRECTION"|"OWN_USE"|"OTHER", note?, batch?: {batchNo, expiryDate}}` — needs `adjustStock`; uses stockIn/stockOut with type ADJUSTMENT
- `movements` (Q) `{productId?, type?, from, to}` → ≤500 newest
- `stocktake` (M) `{counts: [{productId, counted}], note?}` → applies differences as STOCKTAKE movements; returns `{adjusted, varianceValueCents}`; needs `adjustStock`
- `valuation` (Q) → `{totalCostCents, totalRetailCents, byCategory: [{name, costCents, retailCents, items}]}` (needs seeCost)
- `lowStock` (Q) → products with stock ≤ reorderLevel (STOCKABLE only) + supplier name, suggested qty = max(reorderLevel×2 − stock, 1)

`expiry.ts` [expiry] (batch based now)
- `watchlist` (Q) → `{expired, oneMonth, threeMonths}` each `[{batch, product, daysLeft, valueCents}]` (batches with qty > 0)
- `alertCount` (Q) [any member; null if no access] → `{expired, oneMonth}`
- `writeOff` (M) `{batchId, note?}` → stockOut(type WRITE_OFF, batchId); needs adjustStock
- `setPrice` (M) `{productId, priceCents}` — needs editPrice

### Suppliers & Purchases — owner: BACKEND-A  [purchases]
`suppliers.ts`
- `list` (Q) `{search?, withBalance?}`; `get` (Q) `{supplierId}` → `{supplier, ledger (200), purchases (50)}`
- `create` (M) `{name, company, phone, whatsapp, address, notes, openingBalanceCents}` (OPENING ledger row if > 0); `update` (M); `archive` (M)
- `pay` (M) `{supplierId, amountCents, method, reference?, note?}` → PAYMENT; > balance → PAYMENT_EXCEEDS_BALANCE
- `adjust` (M) `{supplierId, direction: "UP"|"DOWN", amountCents, note}` (note required → REASON_REQUIRED)

`purchases.ts`
- `list` (Q) `{from, to, supplierId?}`; `get` (Q) `{purchaseId}`
- `create` (M) `{supplierId?, items: [{productId, qty, unitCostCents, batchNo?, expiryDate?}], otherCostCents, paidCents, paidMethod?, note}` → `{purchaseId, number}`. Per line `stockIn(type PURCHASE, unitCostCents, batch if trackExpiry → EXPIRY_REQUIRED if missing)`. `otherCostCents` spread over lines by value into unit cost. Unpaid part → supplier balance + PURCHASE ledger row (requires supplierId if paidCents < total). Sets `product.supplierId` if empty.

### POS, Shifts, Sales — owner: BACKEND-B
`shifts.ts` [pos]
- `current` (Q) → caller's OPEN shift + live totals `{cashSalesCents, cashRefundsCents, cashInCents, cashOutCents, cashExpensesCents, expectedCashCents, salesCount, byMethod}` or null
- `open` (M) `{openingFloatCents}` (SHIFT_ALREADY_OPEN); `cashMove` (M) `{type: "IN"|"OUT", amountCents, reason}`
- `close` (M) `{countedCashCents, note?}` → stores expected + counted; returns Z-report
- `list` (Q) [sales] `{from, to}` → shifts with difference; `report` (Q) [pos or sales] `{shiftId}` → Z-report (sales by method, refunds, cash moves, expenses, expected, counted, difference)
- Expected cash = float + CASH payments − change + cash IN − cash OUT − CASH refunds − CASH expenses in this shift.

`sales.ts`
- `create` (M) [pos] `{clientSaleId, items: [{productId, qty, discountCents}], orderDiscountCents, payments: [{method, amountCents, reference?}], customerId?, note?, createdAt}` → `{saleId, receiptNo, duplicate}`.
  Idempotent (as v1). Shift: attach caller's OPEN shift if any (don't require — offline outbox may sync after close). Unit price = wholesalePriceCents when customer.group = WHOLESALE and set, else priceCents. Discounts: line + order discount; if total discount % > settings.maxCashierDiscountPercent for non-OWNER → DISCOUNT_TOO_HIGH; any discount needs `giveDiscount`. Templates (`hasVariants`) and archived → INVALID_INPUT. `stockOut(type SALE, allowNegative from settings)` per line; store returned batches on the item. Tax as v1. Payments: methods must be enabled in settings; Σ non-cash ≤ total; CASH may exceed (change = Σpayments − total); Σ < total → PAYMENT_MISMATCH. CREDIT portion → customer required, not creditBlocked (CREDIT_BLOCKED), limit check, ledger DEBT. `customerName` snapshot. createdAt clamp as v1 (≤ now, ≥ now − 30 days).
- `get` (Q) [pos or sales] `{saleId}` → sale + refunds + receipt business info (as v1, flattened)
- `list` (Q) [sales] `{from, to, method?, cashierId?, customerId?, status?, shiftId?}` → ≤500 + totals
- `recentForCashier` (Q) [pos] → last 20 of caller; `findByReceipt` (Q) [pos] `{receiptNo}`
- `refund` (M) [pos or sales; needs `refund` permission] `{saleId, items: [{productId, qty, restock}], method, reason}` → partial/full; qty ≤ sold − refundedQty (REFUND_TOO_MUCH); amount = line net unit price × qty (pro-rated line + order discount, + tax share); restock → `stockIn(type REFUND, restore: that item's batches pro-rata)`; method CREDIT → reduces customer balance (REVERSAL ledger), requires sale.customerId; updates refundedQty/refundedCents/status; inserts `refunds` row with current shift. Reason required.
- `exportCsv` (Q) [sales] `{from, to}`

### Customers & Credit — owner: BACKEND-B  [customers]
`customers.ts`
- `list` (Q) `{search?, group?, filter?: "DEBT"|"OVER_LIMIT"|"OVERDUE"|"BLOCKED"}` → + `daysSinceLastPayment`
- `get` (Q) `{customerId}` → `{customer, ledger (200), sales (50)}`
- `create` (M) `{fullName, phone, whatsapp, type, companyName, group, address, district, notes, creditLimitCents, openingBalanceCents}` — CASHIER: creditLimit forced 0 and opening balance must be 0; opening ≠ 0 → OPENING ledger row (negative allowed = store credit)
- `update` (M) — CASHIER may not change creditLimitCents / creditBlocked / group (FORBIDDEN)
- `setCreditBlocked` (M) `{customerId, blocked}` [OWNER/MANAGER]
- `recordPayment` (M) `{customerId, amountCents, method (not CREDIT), reference?, note?}` → `{ledgerId, balanceAfterCents}` (for payment receipt)
- `adjustBalance` (M) [OWNER/MANAGER] `{customerId, direction: "UP"|"DOWN", amountCents, note}` → ADJUST_UP / ADJUST_DOWN (+ / −), note required
- `writeOff` (M) [OWNER only] `{customerId, note}` → WRITE_OFF of whole positive balance
- `statement` (Q) `{customerId, from, to}` → `{customer, business info, openingBalanceCents, rows (ledger in range), closingBalanceCents}`
- `exportCsv` (Q), `importCsv` (M) `{rows: [{fullName, phone, group?, openingBalanceCents?, creditLimitCents?}]}` ≤500 [OWNER/MANAGER]
- WhatsApp reminder is client-side: `https://wa.me/<digits>?text=<encoded>`.

### Expenses — BACKEND-B  [expenses]
- `list` (Q) `{from, to, category?}` → + totals by category; `create` (M) `{category, amountCents, paidVia, payee, note, spentAt}` (category must be in settings; CASH links caller's open shift); `update` (M) `{expenseId, ...}`; `remove` (M)

### Reports — BACKEND-B  [reports]  (all need seeCost for profit numbers)
- `summary` (Q) `{from, to, tzOffsetMinutes?}` → v1 fields + `refundsCents`, `byPaymentMethod` per method (6), `discountsCents`
- `profitAndLoss` (Q) `{from, to}` → `{revenue, refunds, netSales, cogs, grossProfit, expensesByCategory, totalExpenses, writeOffsCostCents, netProfit}`
- `salesBy` (Q) `{from, to, dimension: "product"|"category"|"cashier"|"customer"|"hour"}` → rows `{key, label, qty, revenueCents, profitCents}`
- `debtors` (Q) → customers with balance > 0 sorted desc + total; `creditors` (Q) → suppliers with balance > 0 + total (only if plan has purchases)
- Date range cap 366 days, sales cap 8000 (as v1).

### Staff, Settings, Dashboard — BACKEND-B
- `staff.create` / `staff.update` gain `permissions?` (Permissions object; only OWNER may set them; MANAGER creating a CASHIER → role defaults)
- `settings.updateSettings` gains `paymentMethods` (CASH always on), `maxCashierDiscountPercent`, `defaultCreditLimitCents`, `expenseCategories` (1–40, each ≤40 chars), `discountPresets` (≤6, 1–100)
- `onboarding.createBusiness` default settings: paymentMethods `["CASH","EVC","ZAAD","EDAHAB","CREDIT"]`, maxCashierDiscountPercent 10, defaultCreditLimitCents 0, expenseCategories `["Rent","Electricity","Water","Salaries","Transport","Airtime & Internet","Generator fuel","Licence & Tax","Supplies","Other"]`, discountPresets `[5,10]`. Also create default categories: none.
- `dashboard.home` + `lowStockCount` uses reorderLevel, + `openShift`, + `payablesCents` (supplier balances, if purchases module)
- `seed.plans`: Trial & Pro include `purchases`; Starter does not.

---

## Frontend v2 (after DESIGN.md exists — follow it strictly)
New/changed screens:
- **Inventory** app menu: Products · Categories · Stock moves · Stocktake · Low stock · Valuation. Product form = full-page or wide sheet with sections: Basics (type segmented control, name, category picker w/ inline create, brand, unit, decimal toggle), Codes (SKU, barcode, extra barcodes chips), Pricing (cost, price, wholesale, **live margin %**), Stock (opening stock, reorder level, track expiry + first batch), Variants (rows editor), Supplier, Image upload. Product detail with tabs: Overview · Stock & batches · Movements. Adjust stock dialog with reason. CSV import (paste/upload, preview, errors) & export.
- **Purchases** app (new tile "Purchases", icon truck): Suppliers list/detail (ledger, Pay, +/− adjust, WhatsApp) · Receive stock form (supplier picker, product lines with qty/cost/batch/expiry, other costs, paid now vs credit) · Purchases history.
- **POS**: shift bar (open shift dialog with float; cash in/out; close shift with counted cash → Z-report print). Line discount & order discount (presets), price shown wholesale for wholesale customers, decimal qty keypad for weighed items, variants picker, hold/park orders (client-side, persisted in localStorage, list + resume), split payment dialog (add multiple method rows with references, cash change), refund/return dialog (find by receipt no, pick lines & qty, restock toggle, method, reason), reprint, WhatsApp share text of receipt.
- **Customers**: list with filters & group chips, balance column (red owes / green store credit). Detail header: big balance + buttons **Take payment · + Add debt · − Reduce debt · Statement · WhatsApp reminder**; tabs Ledger · Sales · Info. Write-off (owner). Printable statement & payment receipt. CSV import/export. Full form with all fields.
- **Sales**: filters (date presets, cashier, method, customer, status, shift), detail drawer (lines, payments, refunds, profit if seeCost), partial refund, CSV export, Shifts tab with Z-reports.
- **Expenses**: categories from settings, paidVia, payee, edit, totals by category, CSV.
- **Reports**: date presets (Today, Yesterday, This week, This month, Last month, Custom), tabs Overview · P&L · Sales by (dimension) · Debtors & Creditors · Stock valuation; CSV export & print on each.
- **Staff**: permission toggles per user (OWNER only).
- **Settings**: payment methods toggles, max cashier discount, default credit limit, expense categories editor, discount presets.
- Everywhere: hide cost/profit when `!hasPermission(me.member, "seeCost")`.
