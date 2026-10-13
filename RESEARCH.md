# Dukaan - Module Depth Research

Priority: **P1** = must have now, **P2** = next, **P3** = later.
Products: **Odoo** (Odoo), **Sq** (Square for Retail/POS), **Loy** (Loyverse), **Zoho** (Zoho Inventory), **Lsp** (Lightspeed/Vend), **Shp** (Shopify POS), **QB** (QuickBooks Commerce/POS).
Some "Seen in" entries come from my general product knowledge rather than a page I fetched. Sources section lists what the web searches returned.

**Somalia context (drives priorities):** cash USD plus mobile money (EVC Plus, Zaad, eDahab); customer credit ("deen") is the norm; unreliable internet (offline POS already exists); weak/no barcodes on many goods (weighed and loose items, local-language names); owners are the main buyers and often not accountants. I found no Somali-specific POS product with deen tracking, and no confirmed merchant API from Hormuud/Telesom. So there is no local benchmark and a good deen workflow is a differentiator. Keep payment confirmation manual (reference number) for now.

**What exists today (schema/SPEC):** products (single flat record: barcode, name, free-text category, unit, cost, price, stock, ONE expiry date), customers (name, phone, credit limit, balance), sales (items, discount, tax, payment CASH/MOBILE/CREDIT, REFUNDED status), ledger (DEBT/PAYMENT/REVERSAL), expenses (category text, amount, note). No suppliers, no stock movement history, no shifts, no batches, no product types.

---

## 1. Inventory (Products)

### 1.1 Product form fields
| Feature | What it does | Seen in | Pri |
|---|---|---|---|
| Product type: **Stockable / Service / Consumable (no stock tracking)** | Goods tracked by qty; services (e.g. phone repair, delivery, airtime top-up fee) have no stock; consumables sold without counting | Odoo (Goods/Service/Combo + "Track Inventory" toggle), Loy ("track stock" toggle), Sq (track inventory toggle), Shp | **P1** |
| Track stock on/off | Per-product switch; off means never blocks a sale | Odoo, Loy, Sq, Shp | **P1** |
| Unit of measure (pcs, kg, litre, box, carton, metre) + allow decimals | Weighed/loose items (rice, sugar, cloth, fuel) | Odoo, Loy (sold by weight), Zoho | **P1** |
| Packaging / secondary unit (carton = 24 pcs) | Buy by carton, sell by piece; conversion factor | Odoo (UoM categories, packaging), Zoho | **P2** |
| Multiple barcodes per product | Several barcodes (pack vs unit, brand changes) map to one product | Odoo (product.barcode multi), Lsp, Shp | **P1** |
| SKU / internal code | Short code for search when no barcode | all | **P1** |
| Brand | Filter/report dimension (Coca-Cola, Samsung) | Zoho, Lsp, Shp (vendor/brand) | **P2** |
| Category tree (parent > child) | Food > Drinks > Soda; replaces free-text category | Odoo, Lsp, Zoho | **P1** (managed list; 2 levels max) |
| Variants (size, colour, flavour) with per-variant barcode, price, stock | Clothes, shoes, phones (storage/colour) | Odoo (attributes), Loy, Sq, Shp, Zoho (item groups) | **P1** for clothing/electronics; implement as attribute list with variant rows |
| Cost price + selling price | Margin shown live (profit % and amount) | all | **P1** (add live margin display) |
| Wholesale / second price tier | Wholesale customers or bulk price; per-customer price group | Odoo (pricelists), Zoho (price lists), Lsp (customer groups), QB | **P1** (single "wholesale price" field) / **P2** (full price lists) |
| Tiered quantity pricing (buy 10+, price X) | Auto price at quantity thresholds | Odoo pricelist min qty, Zoho volume pricing | **P3** |
| Tax (per product: taxable/exempt, rate override) | Shop-wide rate exists; exempt items such as basic food | Odoo, Sq, Loy (multiple taxes), QB | **P2** |
| Reorder level (min stock) + reorder qty | Low-stock alert and suggested purchase qty, per product | Zoho, Loy, Odoo (reordering rules), Sq | **P1** (replaces shop-wide threshold; keep global as default) |
| Max / par level | Upper stock bound for purchasing suggestions | Odoo reordering rules | **P3** |
| Image | Photo tile in POS grid and list | all | **P1** (upload via existing storage) |
| POS tile colour/shortcut ("favourite") | Pin fast sellers to top of POS | Loy, Sq, Odoo ("available in POS") | **P2** |
| Available in POS / online toggle | Hide items not sold at counter | Odoo | **P2** |
| Default supplier + supplier product code + last cost | Link to purchasing; auto-fill PO | Odoo (vendor pricelist), Zoho (preferred vendor), Loy, Sq | **P1** (needs Suppliers module) |
| Batch / lot tracking with **expiry per batch** (batch no., qty, cost, expiry, received date) | Pharmacy/grocery: sell oldest-expiry first (FEFO), expiry alerts per batch rather than one date per product | Odoo (lots + removal strategy FEFO/expiration date), Zoho (batch tracking), Lsp (limited) | **P1** for pharmacy/grocery; flag "track expiry" on product, batches created at stock-in |
| Serial / IMEI tracking | Unique unit tracking for phones/electronics, warranty | Odoo (serial numbers), Zoho (serial tracking) | **P2** |
| Warranty period (days/months) | Printed on receipt, lookup by serial | Odoo, Zoho | **P3** |
| Composite / bundle / kit (e.g. gift basket, "combo") | Sell group of items at one price; components deducted | Odoo (kits/combo), Zoho (composite items), Loy (composite items) | **P2** |
| Modifiers / add-ons (extra cheese, sugar) | Restaurant/café options with price and optional ingredient deduction | Loy, Sq, Odoo restaurant | **P2** (restaurants only) |
| Recipe / ingredient deduction | Selling a dish deducts raw materials | Odoo (BoM), Loy (composite) | **P3** |
| Description / notes / local-language name (Somali) | Search by alternate name | Odoo, Shp | **P2** |
| Archive (soft delete) | Hide without losing history | Odoo, Zoho (inactive) | exists |
| Opening stock at creation | Enter starting qty (creates first movement) | Zoho, Odoo | **P1** |
| Product label / barcode printing | Print price tag and barcode sticker; generate internal barcode | Sq (labels from PO), Odoo, Zoho, Lsp | **P2** |
| Custom fields | Owner-defined extra attributes | Zoho, Odoo Studio | **P3** |

### 1.2 Screens/views
| Screen | Needed features | Pri |
|---|---|---|
| Product list (table) | Columns: image, name, SKU/barcode, category, price, cost, stock, status; sort; search by name/barcode/SKU; filters: category, brand, supplier, type, low stock, out of stock, expiring, archived | **P1** |
| Cards/grid view (kanban) | Image tiles with stock badge, mobile friendly | **P2** |
| Product detail/form | Tabs: General (type, units, prices), Variants, Stock (per batch/lot, movements), Purchasing (suppliers), Sales history for item | **P1** (tabs: General, Stock, Purchasing) |
| Bulk actions | Select rows: change category, set price (+/- %), archive, print labels, export | **P2** |
| Import / export CSV | Template download, validation preview, map columns; export current list. Many shop owners already hold Excel lists | **P1** (import is the onboarding unlock) |
| Print | Barcode labels, stock list, stock valuation | **P2** |
| Categories manager | Add/rename/reorder categories | **P1** |
| Price update tool | Raise prices by % for a category | **P2** |

---

## 2. Stock Movements and Adjustments (new / extend Inventory)

| Feature | What it does | Seen in | Pri |
|---|---|---|---|
| Stock movement ledger (every change: sale, refund, purchase receive, adjustment, transfer, expiry write-off) with qty in/out, balance after, user, ref, date | Audit trail; answers "where did my stock go?" | Odoo (stock moves), Zoho (inventory history), Loy (inventory history, paid), Sq | **P1** |
| Stock adjustment with reason codes (damaged, expired, lost/theft, found, correction, own use) | Replaces bare `adjustStock` with reasons for reports | Loy, Odoo, Zoho (adjustments + reason), Sq | **P1** |
| Stock count / stocktake (full or by category): count sheet, system qty vs counted qty, variance, apply | Periodic physical count; shop owners do this at month end | Loy (full/partial counts, paid), Odoo (inventory adjustments), Zoho, Lsp | **P1** (simple version: enter counted qty per item, apply differences) |
| Stock valuation report (qty x cost) | Total capital tied up in stock | Odoo, Zoho, Loy | **P1** |
| Stock-in without a PO ("quick receive") | Add goods quickly, optionally with supplier and cost | Odoo (receipts), Loy | **P1** |
| Transfers between branches/warehouses | Move stock between locations | Odoo, Loy, Sq, Zoho | **P3** |
| Write-off of expired batches | One-click expire batch to waste with cost loss shown | Odoo (scrap), Zoho | **P1** (extends Expiry module) |
| Low stock / reorder report with suggested qty and supplier | Shopping list for the next supplier trip | Zoho, Loy, Odoo | **P1** |
| Dead stock / slow movers report | Items with no sales in N days | Lsp, Zoho reports | **P2** |

Screens: movement history table (filters: product, type, user, date), adjustment form (product search, +/- qty, reason, note), stocktake sheet (printable, CSV), valuation report.

---

## 3. Point of Sale

| Feature | What it does | Seen in | Pri |
|---|---|---|---|
| Barcode scan, search, category tiles | exists | all | exists |
| **Cash register session (shift)**: open with opening float, close with counted cash, expected vs counted difference, Z-report | Cashier accountability; also catches theft | Odoo (session + cash control), Loy (shifts, expected vs actual), Sq (cash drawer), Lsp (register close) | **P1** |
| Cash in / cash out during shift (paid-out, float top-up, owner drawing) with reason | Track non-sale cash movements | Odoo, Loy (pay in/out) | **P1** |
| Split payment (part cash, part EVC, part deen) | Very common in Somalia | Odoo, Sq, Loy, Shp | **P1** |
| Payment methods configurable: Cash, EVC Plus, Zaad, eDahab, Bank, Credit | Today MOBILE is one bucket; need per-provider reports | Odoo (payment methods), Loy (custom methods) | **P1** (split MOBILE into EVC/ZAAD/EDAHAB/OTHER) |
| Per-line discount (% or amount) and order discount, with permission | Bargaining is normal | Odoo, Sq, Loy, Lsp | **P1** (line discount; cashier limit setting) |
| Price override with permission (manager PIN) | Haggle price | Odoo, Lsp | **P2** |
| Hold / park orders (open tickets) | Serve next customer while one looks for money | Loy (open tickets), Odoo, Sq | **P1** |
| Customer attach + **wholesale price tier** auto-apply | Wholesale customers get wholesale price | Odoo (pricelist), Lsp (groups) | **P1** |
| Quantity decimals / weight entry; price-by-weight | Loose goods | Loy, Odoo | **P1** |
| Quick custom item / miscellaneous sale | Sell something not in catalogue | Sq, Loy, Odoo | **P2** |
| Notes on order | Delivery info, customer note | all | **P2** |
| Returns/exchange at POS (lookup by receipt no.) with refund method (cash / EVC / reduce deen / store credit), partial refund of selected lines | Refund today is whole-sale only | Odoo (negative qty, credit note), Sq, Loy, Shp | **P1** |
| Reprint / resend receipt (print, WhatsApp text, PDF) | Customers ask for proof | Loy (email), Sq, Shp | **P1** (print + WhatsApp share link/text) / **P2** (PDF) |
| Receipt customisation (logo, footer, language, paper 58/80mm) | Partly exists | Loy, Sq | **P2** |
| Loyalty points earn/redeem | Retention | Loy, Sq, Odoo, Shp | **P3** (see Loyalty) |
| Promotions auto-applied (buy X get Y, % off category) | Auto discount | Odoo, Loy (discount rules), Shp | **P2** |
| Delivery / order type (take-away, delivery, dine-in) and table | Restaurants | Loy, Odoo restaurant | **P2** (restaurants) |
| Kitchen printer / KDS | Kitchen tickets | Loy, Sq, Odoo | **P3** |
| Customer-facing display | 2nd screen | Odoo, Sq | **P3** |
| Offline mode | exists | Loy, Odoo | exists |
| Keyboard shortcuts / hardware: barcode scanner, 58/80mm printer, cash drawer kick | Hardware support | Odoo, Loy | **P2** (drawer kick) |
| Tips | Cafes | Sq, Loy | **P3** |

Screens: sales terminal, hold list, shift open/close dialog, shift report (printable), payment dialog with split lines, return dialog.

---

## 4. Sales (history, orders, invoices, returns)

| Feature | What it does | Seen in | Pri |
|---|---|---|---|
| Sales list with filters (date, cashier, payment method, customer, status, shift) and totals | Partly exists | Odoo, Loy, Sq | **P1** (add customer/status/shift filters) |
| Sale detail: items, payments, profit per line, cashier, refund history, reprint | Today only receipt | Odoo, Loy | **P1** |
| **Partial refund / return** by line with restock choice (back to stock vs damaged) and refund method | Replaces whole-sale refund | Odoo, Sq, Loy, Shp | **P1** |
| Credit note / refund document | Printed proof | Odoo, Zoho | **P2** |
| Void sale (before close) vs refund | Mistake correction with reason | Sq, Lsp | **P2** |
| Quotation / proforma | Quote to wholesale buyer; convert to sale | Odoo Sales, Zoho, QB | **P2** |
| Invoice (A4) for B2B with company name, due date, partial payments | Hotels, NGOs, offices buy on account | Odoo, Zoho, QB | **P2** |
| Sales orders with delivery status (paid/unpaid, delivered) | Wholesale/deliveries | Odoo, Zoho | **P3** |
| Sales by product / category / cashier / hour reports | Insights | all | **P1** (via Reports) |
| Export CSV/PDF | Accountant, owner | all | **P1** |

Screens: list, detail drawer, refund dialog, quotation list/form (P2), invoice print (P2).

---

## 5. Customers and Credit (Deen)

### 5.1 Customer form
| Feature | What it does | Seen in | Pri |
|---|---|---|---|
| Name, phone (primary), second phone / WhatsApp number | Contact, reminders | Odoo Contacts, Loy, Sq | **P1** |
| Customer type: individual / company; company name | Wholesale and B2B buyers | Odoo, Zoho, QB | **P1** |
| Customer group (Retail, Wholesale, VIP, Staff) -> price tier and default discount | Auto pricing | Odoo pricelists, Lsp groups, Zoho price lists | **P1** |
| Address / district / landmark (Somali addresses are landmark based) | Delivery, collection | Odoo, Loy | **P1** (single text field plus district) |
| Notes (internal) and tags | "Pays at month end", "Brother of X" | Odoo, Loy, Sq | **P1** |
| Photo / ID reference | Identify credit customers | Odoo | **P3** |
| Guarantor name + phone (for deen) | Common practice before giving credit | local practice (no benchmark found) | **P2** |
| Credit limit | exists | Odoo credit limit, Zoho | exists |
| Payment terms / due date days (e.g. pay in 15 days) | Overdue tracking | Odoo, Zoho, QB | **P2** |
| Opening balance at creation (existing debt owed to shop, or store credit) | Migrating from the paper deen notebook; mandatory for adoption | Zoho (opening balance), QB, Odoo | **P1** |
| **Manual balance adjustment**: "Add debt (+)" / "Reduce debt (-)" with required reason and date | Cash lent, write-off, correction, forgiven debt. Ledger types DEBT/PAYMENT exist; add ADJUSTMENT_UP / ADJUSTMENT_DOWN / WRITE_OFF | Zoho (journal/opening), QB (adjustments), Odoo (manual journal) | **P1** |
| Record payment: method (cash / EVC / Zaad / eDahab), reference, date, note, **printable payment receipt** | Partly exists; add receipt + provider | Odoo, Zoho (payments received), QB | **P1** |
| Payment allocation to oldest unpaid sale (FIFO) | Know which invoices are paid | Odoo, Zoho | **P3** (running balance is enough) |
| Store credit / prepaid deposit (negative balance) | Customer deposits money | Odoo, Sq (gift cards) | exists (negative balance); **P2** UI label |
| Block sales to customer (blacklist) | Stop credit to bad payers | Odoo (warning/block), Lsp | **P1** (simple "credit blocked" flag) |
| Customer **statement** (all sales + payments + balance, date range), printable / shareable | Hand to customer or send on WhatsApp | Odoo, Zoho, QB | **P1** |
| **Payment reminder** via WhatsApp click-to-chat / SMS text with amount owed | Collects deen; wa.me link with prefilled message needs no API cost | Zoho (reminders), QB, Odoo follow-ups | **P1** (wa.me link + copy text) / **P2** (automatic SMS gateway) |
| Overdue / ageing report (0-7, 8-30, 30+ days) | Who to chase first | Zoho, QB, Odoo | **P1** (simple: days since last payment and balance) |
| Total debt owed to shop summary + top debtors | exists partially | all | **P1** |
| Purchase history and spend, last visit, average basket | CRM | Loy, Sq, Shp | **P2** |
| Loyalty points balance | Loyalty | Loy, Sq, Odoo | **P3** |
| Birthday / marketing SMS | Promotions | Loy, Sq | **P3** |
| Merge duplicates | Cleanup | Odoo, Shp | **P3** |

### 5.2 Screens
| Screen | Needed features | Pri |
|---|---|---|
| List | Columns: name, phone, group, balance, last payment; filters: has debt, over limit, overdue, group; search | **P1** |
| Detail | Header with balance and quick buttons: Take payment, Add debt, Reduce debt, Statement, WhatsApp reminder; tabs Ledger, Sales, Info | **P1** |
| Import / export CSV | Bring over notebook list with opening balances | **P1** |
| Debt collection view | Sorted by oldest/biggest, tick to remind | **P2** |
| Print | Statement, payment receipt | **P1** |
| Bulk | Send reminder to selected | **P2** |

---

## 6. Suppliers and Purchases (NEW module - essential)

| Feature | What it does | Seen in | Pri |
|---|---|---|---|
| Supplier record: name, phone/WhatsApp, company, address, notes, payment terms, opening balance (we owe them) | Contacts | Odoo, Zoho (vendors), Loy, Sq (vendors), QB | **P1** |
| Supplier balance (what the shop owes) + ledger | Credit from wholesalers is as common as customer deen | Odoo, Zoho (bills), QB | **P1** |
| **Receive stock (goods receipt / purchase)**: pick supplier, add lines (product, qty, unit cost, batch no., expiry date), freight/other cost, paid now (cash/mobile) vs on credit | Increases stock, updates cost price, creates batches, creates movement, creates supplier debt | Odoo (receipt + vendor bill), Zoho (PO > bill), Sq (receive vs PO), Loy | **P1** |
| Update product cost on receive (last cost / weighted average) | Correct profit margins | Odoo (costing methods AVCO/FIFO), Zoho | **P1** (weighted average, shown as option) |
| Purchase order (draft > sent > partially received > received) | Order from supplier, send over WhatsApp, receive later against it | Odoo, Zoho, Sq, Loy (paid tier) | **P2** (receive-stock without PO is P1) |
| Pay supplier: method, reference, partial payments | Reduce shop debt | Odoo, Zoho (payments made), QB | **P1** |
| Purchase return to supplier (damaged/expired) | Debit note, stock out | Odoo, Zoho (vendor credits) | **P2** |
| Supplier price history / compare | Cheapest source | Odoo, Zoho | **P3** |
| Reorder suggestions grouped by supplier -> create PO | Fast restocking | Zoho, Odoo, Loy | **P2** |
| Reports: purchases by supplier / period; supplier ageing | Cash planning | Zoho, QB | **P2** |
| Attach invoice photo | Evidence | Zoho, Odoo | **P3** |

Screens: supplier list, supplier detail (ledger, purchases, Pay button), purchase/receive form, PO list (P2), CSV import/export.

---

## 7. Expiry Alerts

| Feature | What it does | Seen in | Pri |
|---|---|---|---|
| Alert **per batch** (not per product) | Right granularity once batches exist | Odoo (expiration alert date on lots), Zoho | **P1** |
| Configurable alert window per product/category (e.g. 30/60/90 days) | Medicines vs dairy differ | Odoo (alert time), Zoho | **P2** |
| FEFO: POS auto-deducts from earliest-expiring batch | Prevent expiry losses | Odoo (removal strategy) | **P1** |
| Block sale of expired batch (exists per product) | Safety | Odoo | exists -> per batch |
| Quick actions: discount, write-off batch, return to supplier | exists partially | Odoo | **P1** (write-off creates movement with loss value) |
| Expiry loss report (value written off) | Quantify waste | Zoho, Odoo | **P2** |
| Notification (in-app badge exists; WhatsApp/SMS digest to owner) | Passive alert | custom | **P3** |

Screens: tabs Expired / 30d / 90d, grouped by product with batches, print list.

---

## 8. Expenses

| Feature | What it does | Seen in | Pri |
|---|---|---|---|
| Managed expense categories (rent, electricity, salary, transport, airtime, generator fuel, licence/tax, supplies, other) | Replaces free text; consistent reports | Odoo Expenses, QB, Zoho | **P1** |
| Paid via (cash drawer / EVC / bank / owner pocket) and optionally linked to shift | Cash drawer reconciliation | Odoo, Loy (pay-out) | **P1** |
| Payee / vendor (free text or supplier) | Who was paid | Odoo, QB | **P1** |
| Receipt photo attachment | Evidence | Odoo (receipt scan), Zoho, QB | **P2** |
| Recurring expenses (rent monthly, salaries) | Auto-create reminders/entries | Zoho, QB | **P2** |
| Edit expense (not just delete) with audit | Fix mistakes | all | **P1** |
| Salary / staff advance | Common in small shops | Odoo HR expenses | **P3** |
| Owner drawings / personal use separated from expense | Correct profit | QB, Zoho | **P2** |
| Approval flow | For manager-entered | Odoo | **P3** |
| Filters (date, category, paid-by), totals by category, CSV export | Basic | all | **P1** |

---

## 9. Reports

| Feature | What it does | Seen in | Pri |
|---|---|---|---|
| Sales summary (exists) + date presets (today, yesterday, this week/month, custom) | Quick | all | **P1** |
| Profit and loss (revenue - COGS - expenses) | Exists in summary; show as statement | Zoho, QB, Odoo | **P1** |
| Sales by product / category / brand / cashier / customer / payment method / hour | Slicing | Loy, Sq, Lsp, Shp | **P1** (product, category, cashier, payment method) |
| **Payment method breakdown** with EVC/Zaad/eDahab split | Reconcile mobile wallets | Loy, Odoo | **P1** |
| Shift (Z) report | Close-of-day | Odoo, Loy, Sq | **P1** |
| Stock valuation, low stock, stock movement | Inventory health | Zoho, Loy | **P1** |
| Debtors list (customers owe) and creditors list (shop owes suppliers) | Cash position | Zoho, QB | **P1** |
| Cash position: cash sales + repayments - expenses - supplier payments - drawings | Daily cash to expect | Loy, QB | **P2** |
| Discounts given, refunds, voids report (fraud watch) | Control | Sq, Lsp | **P2** |
| Tax report | If VAT used | Odoo, Zoho, QB | **P2** |
| Product profitability / margin ranking | Which items earn | Zoho, Lsp | **P2** |
| Scheduled daily summary via WhatsApp/email to owner | Owner away from shop | Sq, Loy | **P3** |
| Export CSV/PDF on every report, print | Accountant | all | **P1** |

---

## 10. Staff and Permissions

| Feature | What it does | Seen in | Pri |
|---|---|---|---|
| Roles: Owner, Manager, Cashier (exists) | Basic | all | exists |
| **Granular permissions toggles** (can give discount, can refund, can see cost/profit, can edit price, can adjust stock, can delete expense, can view reports) | Owner controls what cashiers see; hiding cost is often important | Loy (access rights), Sq (permission sets), Odoo (groups), Lsp | **P1** (small fixed set of toggles on cashier/manager) |
| PIN login for cashiers at POS (fast switch) | Shared tablet | Loy (PIN), Sq (passcode), Odoo (PIN) | **P2** |
| Branch assignment | Multi-store | Loy, Sq | **P3** |
| Time clock (clock in/out, hours) | Payroll | Loy, Sq | **P3** |
| Sales per staff / commission | Motivation | Loy, Sq | **P3** |
| Activity log view (audit exists in DB) | Who did what | Odoo, Zoho | **P2** (surface existing auditLog to owner) |

---

## 11. Settings

| Feature | What it does | Seen in | Pri |
|---|---|---|---|
| Business profile, receipt header/footer, tax (exists) | Basic | all | exists |
| Payment methods on/off and labels (Cash, EVC Plus, Zaad, eDahab, Bank) | Match local wallets | Odoo, Loy | **P1** |
| Multiple currencies display (USD + SOS/SLSH) with rate; show change in local currency | Somali shillings and Somaliland shillings circulate with USD | Odoo, Zoho | **P2** (rate setting, display only) |
| Receipt options: paper size, show cashier/customer, language (EN/Somali), WhatsApp footer | Fits hardware | Loy, Sq | **P2** |
| Number sequences / prefixes (receipt, PO, invoice) | Professional docs | Odoo, Zoho | **P2** |
| Discount rules (max cashier discount %) | Control | Odoo, Lsp | **P1** |
| Credit policy defaults (default credit limit, due days, block when over limit) | Consistent deen rules | Odoo, Zoho | **P1** |
| Expiry defaults (alert days) | Expiry | Odoo | **P2** |
| Data import/export and full backup | Trust and migration | Zoho, Odoo | **P1** (CSV) |
| Language: Somali UI | Adoption among staff | custom | **P2** |
| Branches / warehouses list | Multi-location | Odoo, Loy, Sq, Zoho | **P3** |

---

## 12. Discounts and Promotions (NEW, light)

| Feature | What it does | Seen in | Pri |
|---|---|---|---|
| Manual discounts at POS (see POS) | Bargaining | all | **P1** |
| Saved discount presets (5%, 10%, "Staff 20%") | One tap | Loy (discounts), Sq, Odoo | **P1** |
| Scheduled price promotion (item/category -x% between dates) | Eid, Ramadan sales | Odoo (pricelist rules/promotions), Shp, Loy | **P2** |
| Buy X get Y, bundle price | Offers | Odoo, Shp, Sq | **P2** |
| Coupon codes | Marketing | Odoo, Shp | **P3** |

## 13. Loyalty (NEW, later)

| Feature | What it does | Seen in | Pri |
|---|---|---|---|
| Points per $ spent, redeem as discount | Retention | Loy, Sq, Odoo, Shp | **P3** |
| Stamp card / gift card / store credit | Café punch cards, prepaid | Sq, Odoo | **P3** |
| Customer groups with auto discount | Cheaper alternative (see Customers) | Odoo, Lsp | **P1** via groups |

## 14. Multi-branch / Warehouses (NEW, later)

| Feature | What it does | Seen in | Pri |
|---|---|---|---|
| Branches with separate stock, staff, registers; consolidated reports | Owners with 2+ shops | Odoo, Loy, Sq, Zoho, Lsp | **P3** |
| Stock transfer between branches | Move goods | Odoo, Sq, Zoho, Loy | **P3** |
| Shop vs back-store location within one shop | Simple 2-location split | Odoo | **P3** |

Note: keep `branchId` in mind for schema (optional field) but do not build UI now.

## 15. Quotations / Invoices (NEW, later)
See Sales section. P2 for wholesalers only.

## 16. Accounting basics
| Feature | What it does | Seen in | Pri |
|---|---|---|---|
| Cash/mobile wallet account balances (cash drawer, EVC, Zaad, bank) with transfers (deposit cash to wallet) | Owner sees where money is | QB, Zoho, Odoo | **P2** |
| Double-entry ledger, chart of accounts, journal entries | Full accounting | Odoo, Zoho Books, QB | **P3** |
| Owner capital and drawings | Equity | QB, Zoho | **P3** |

## 17. Billing and Support (platform-side)
Existing; no depth gaps from this research. Optional P2: in-app help articles/video links, WhatsApp support number, data export on cancellation.

---

# Recommended Scope for Next Build (P1 only)

Group by dependency order. Schema additions in brackets.

**A. Foundation (do first)**
1. **Categories** managed list (2 levels) [categories table: name, parentId].
2. **Payment methods** split: CASH, EVC, ZAAD, EDAHAB, BANK(optional), CREDIT; allow SPLIT payments on a sale [sales.payments[] array].
3. **Stock movements ledger** [stockMovements: productId, batchId?, type (SALE/REFUND/PURCHASE/ADJUSTMENT/WRITE_OFF/OPENING/STOCKTAKE), qty, balanceAfter, reason, refId, userId]. All stock changes write here.

**B. Inventory/Products**
4. Product fields: `type` (STOCKABLE/SERVICE/CONSUMABLE), `trackStock`, `sku`, extra barcodes [barcodes: string[]], `brandId?/brand`, `categoryId`, `imageId`, `wholesalePriceCents`, `reorderLevel`, `supplierId?`, `allowDecimal`, `trackExpiry`. Live margin display.
5. **Variants**: simple variant rows under a parent product (size/colour label, own barcode/price/stock) [productVariants].
6. **Batches** with expiry per batch [batches: productId, batchNo, qty, costCents, expiryDate, receivedAt]; POS deducts FEFO; Expiry app reads batches.
7. Adjustments with reason codes; simple stocktake (count -> variance -> apply); stock valuation + low-stock reorder list.
8. **CSV import/export** for products and customers.

**C. Suppliers and Purchases (new app)**
9. Suppliers CRUD with opening balance and ledger [suppliers, supplierLedger].
10. **Receive stock** form (lines with qty, cost, batch, expiry, paid-now vs on credit), updates weighted-average cost and creates movements/batches [purchases, purchaseItems].
11. Pay supplier (partial, method, reference). PO workflow deferred (P2).

**D. Customers and Credit**
12. Fields: second phone/WhatsApp, type (individual/company), group (Retail/Wholesale/VIP), address/district, notes, `creditBlocked`, opening balance.
13. **Manual balance adjustment** (+ add debt / - reduce debt / write-off) with required reason [ledger types ADJUST_UP, ADJUST_DOWN, WRITE_OFF].
14. Payment with provider + reference + printable payment receipt.
15. **Statement** (date range, print/share) and **WhatsApp reminder** (wa.me link with prefilled amount and shop name); overdue ageing (days since last payment).
16. Wholesale group auto-applies `wholesalePriceCents` at POS.

**E. POS and Sales**
17. **Shifts**: open with float, cash in/out, close with counted cash, expected vs counted, Z-report [shifts, cashMovements; sales.shiftId].
18. Per-line + order discount, discount presets, cashier max-discount setting.
19. Hold/park orders; decimal quantity (weight) entry.
20. **Partial refund/return** by line with restock choice and refund method (cash/mobile/reduce deen); reprint receipt + WhatsApp share text.
21. Sales list extra filters (customer, status, shift) and CSV export.

**F. Expenses, Reports, Staff, Settings**
22. Expense categories managed, paid-via, payee, edit.
23. Reports: P&L statement, sales by product/category/cashier/payment method, payment-method split incl. wallets, debtors and creditors lists, stock valuation, shift report, CSV export everywhere, date presets.
24. Staff permission toggles (see cost/profit, give discount, refund, adjust stock, edit price).
25. Settings: payment methods on/off, max cashier discount, credit policy defaults.

**Explicit non-goals this round (P2/P3):** purchase orders, serial/IMEI, composite kits, modifiers/recipes, quotations/invoices, loyalty, promotions engine, multi-branch, double-entry accounting, automated SMS gateway, PIN login, time clock, KDS, multi-currency.

**Suggested build order** to limit risk: A -> B -> C -> D -> E -> F. Items 17 (shifts) and 3 (movements) touch the POS write path, so migrate `sales.create` once with payments[], shiftId, FEFO batch deduction, and movement logging together.

---

# Sources
- Odoo 19 product types / tracking summary (forum + study guide): https://odoo.com/forum/help-1/storable-vs-consumable-what-is-the-difference-between-these-types-of-products-186065 , https://open-exam-prep.com/study-guides/odoo-19/inventory-warehouse/products-warehouse-operations
- Odoo Point of Sale docs (sessions, cash control, refunds, pricelists, credit limits): https://odoo.com/documentation/16.0/applications/sales/point_of_sale.html , https://www.odoo.com/app/point-of-sale-features , https://open-exam-prep.com/study-guides/odoo-19/website-ecommerce-pos/point-of-sale-pos
- Loyverse features (variants, modifiers, shifts, cash mgmt, composite items, advanced inventory: POs, stocktake, history): https://loyverse.com/features , https://loyverse.com/llms.txt , https://www.merchantmaverick.com/reviews/loyverse-review/
- Zoho Inventory (composite items, reorder, bills, POs): https://www.zoho.com/inventory/help/items/composite-items.html , https://www.zoho.com/inventory/help/purchase-orders/bills.html , https://www.zoho.com/inventory/purchase-orders-billing-solution/
- Square for Retail (purchase orders, receiving, labels, multi-location): https://squareup.com/help/au/en/article/5957-inventory-plus , https://community.squareup.com/t5/Archived-Discussions-Read-Only/Square-for-Retail-New-Feature-Roundup/m-p/47845
- Somalia payment context: https://en.wikipedia.org/wiki/Mobile_money_in_Somalia , https://www.transfi.com/id/blog/somalias-payment-rails-how-they-work---evc-plus-mobile-banking-remittance-integration
- Not searched directly (entries marked from general knowledge): Lightspeed/Vend, Shopify POS, QuickBooks Commerce details.
