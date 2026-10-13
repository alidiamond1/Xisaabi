import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export const platformRole = v.union(v.literal("SUPER_ADMIN"), v.literal("PLATFORM_ADMIN"));
export const businessRole = v.union(v.literal("OWNER"), v.literal("MANAGER"), v.literal("CASHIER"));
export const role = v.union(platformRole, businessRole);

export const moduleKey = v.union(
  v.literal("pos"),
  v.literal("inventory"),
  v.literal("sales"),
  v.literal("customers"),
  v.literal("expiry"),
  v.literal("expenses"),
  v.literal("reports"),
  v.literal("staff"),
  v.literal("purchases"),
);

// EVC = Hormuud EVC Plus, ZAAD = Telesom Zaad, EDAHAB = Somtel eDahab
export const paymentMethod = v.union(
  v.literal("CASH"),
  v.literal("EVC"),
  v.literal("ZAAD"),
  v.literal("EDAHAB"),
  v.literal("BANK"),
  v.literal("CREDIT"),
);

export const productType = v.union(
  v.literal("STOCKABLE"), // stock counted
  v.literal("CONSUMABLE"), // sold without counting stock
  v.literal("SERVICE"), // no stock (repair, delivery, fees)
);

export const movementType = v.union(
  v.literal("OPENING"),
  v.literal("SALE"),
  v.literal("REFUND"),
  v.literal("PURCHASE"),
  v.literal("ADJUSTMENT"),
  v.literal("STOCKTAKE"),
  v.literal("WRITE_OFF"),
);

// Optional capabilities switched on by business-type presets (convex/shared/presets.ts).
export const feature = v.union(
  v.literal("units"), // packs: carton/box/strip with conversion factor
  v.literal("attributes"), // custom product fields (generic name, part no., ...)
  v.literal("serials"), // IMEI / serial numbers + warranty
  v.literal("variants"),
  v.literal("expiry"),
  v.literal("weight"), // sold by kg / metre
  v.literal("wholesale"),
  v.literal("services"),
);

// A selling/buying unit of a product. factor = how many base units it contains.
export const productUnit = v.object({
  name: v.string(), // "carton", "strip"
  factor: v.number(), // e.g. carton = 24 (pcs)
  barcode: v.string(), // "" if none — scanning it sells this unit
  priceCents: v.optional(v.number()), // unset = factor × base price
});

// Fine-grained toggles for MANAGER/CASHIER. OWNER always has all.
export const permissions = v.object({
  seeCost: v.boolean(), // cost price, profit
  giveDiscount: v.boolean(),
  refund: v.boolean(),
  adjustStock: v.boolean(),
  editPrice: v.boolean(),
});

export default defineSchema({
  ...authTables,

  // ───────────── Platform (SaaS owner side) ─────────────

  // Pricing plans — fully editable by SUPER_ADMIN.
  plans: defineTable({
    name: v.string(),
    description: v.string(),
    priceCents: v.number(), // per month, USD
    trialDays: v.number(), // >0 only on the plan new signups get
    maxUsers: v.number(), // 0 = unlimited
    maxProducts: v.number(), // 0 = unlimited
    modules: v.array(moduleKey),
    features: v.array(v.string()), // marketing bullets on the pricing page
    isDefaultTrial: v.boolean(), // exactly one plan should be true
    isActive: v.boolean(),
    sortOrder: v.number(),
  }).index("by_sort", ["sortOrder"]),

  // One row per tenant. ALL business data hangs off businessId.
  businesses: defineTable({
    name: v.string(),
    logoId: v.optional(v.id("_storage")),
    businessType: v.string(), // "Grocery", "Pharmacy", "Electronics", ...
    phone: v.string(),
    email: v.optional(v.string()),
    address: v.string(),
    city: v.string(),
    country: v.string(),
    currency: v.string(), // "USD"
    ownerUserId: v.id("users"),
    status: v.union(v.literal("ACTIVE"), v.literal("SUSPENDED")),
    suspendedReason: v.optional(v.string()),
    planId: v.id("plans"),
    subscriptionStatus: v.union(v.literal("TRIAL"), v.literal("ACTIVE"), v.literal("CANCELLED")),
    subscriptionEndsAt: v.number(),
    settings: v.object({
      receiptHeader: v.optional(v.string()),
      receiptFooter: v.optional(v.string()),
      taxRatePercent: v.number(), // 0 = no tax
      lowStockThreshold: v.number(),
      allowNegativeStock: v.boolean(), // needed for offline POS sales
      paymentMethods: v.array(paymentMethod), // enabled at POS
      maxCashierDiscountPercent: v.number(), // 0–100
      defaultCreditLimitCents: v.number(),
      expenseCategories: v.array(v.string()),
      discountPresets: v.array(v.number()), // percents shown as one-tap buttons
      shareToCatalog: v.optional(v.boolean()), // undefined = true; contributes name/brand/size/image only
    }),
    // v3 — optional so v2 rows stay valid; code treats undefined as [] / general shop
    businessTypes: v.optional(v.array(v.string())), // preset keys, max 3
    features: v.optional(v.array(feature)),
    attributeDefs: v.optional(
      v.array(
        v.object({
          key: v.string(), // "generic", "strength", "partNo"
          label: v.string(),
          type: v.union(v.literal("text"), v.literal("number"), v.literal("select")),
          options: v.optional(v.array(v.string())),
          searchable: v.boolean(),
        }),
      ),
    ),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerUserId"])
    .index("by_logo", ["logoId"])
    .index("by_status", ["status"])
    .index("by_subscription_end", ["subscriptionEndsAt"]),

  // Manual payments (EVC / Zaad / bank) recorded by platform staff.
  subscriptionPayments: defineTable({
    businessId: v.id("businesses"),
    planId: v.id("plans"),
    amountCents: v.number(),
    months: v.number(),
    method: v.string(), // "EVC", "ZAAD", "EDAHAB", "BANK", "CASH"
    reference: v.optional(v.string()),
    recordedBy: v.id("members"),
    createdAt: v.number(),
    // v4 — voided payments stay for the record but count nowhere
    voidedAt: v.optional(v.number()),
    voidReason: v.optional(v.string()),
    voidedBy: v.optional(v.id("members")),
  })
    .index("by_business", ["businessId", "createdAt"])
    .index("by_created", ["createdAt"]),

  // Support: business ↔ platform.
  tickets: defineTable({
    businessId: v.id("businesses"),
    subject: v.string(),
    category: v.union(
      v.literal("BILLING"),
      v.literal("TECHNICAL"),
      v.literal("FEATURE_REQUEST"),
      v.literal("OTHER"),
    ),
    priority: v.union(v.literal("LOW"), v.literal("NORMAL"), v.literal("HIGH")),
    status: v.union(v.literal("OPEN"), v.literal("ANSWERED"), v.literal("CLOSED")),
    createdBy: v.id("members"),
    unreadByPlatform: v.boolean(),
    unreadByBusiness: v.boolean(),
    lastMessageAt: v.number(),
    createdAt: v.number(),
    assignedTo: v.optional(v.id("members")), // v4 — platform staff handling it
    firstResponseAt: v.optional(v.number()),
  })
    .index("by_business", ["businessId", "lastMessageAt"])
    .index("by_status", ["status", "lastMessageAt"]),

  ticketMessages: defineTable({
    ticketId: v.id("tickets"),
    businessId: v.id("businesses"),
    authorMemberId: v.id("members"),
    authorName: v.string(),
    fromPlatform: v.boolean(),
    body: v.string(),
    createdAt: v.number(),
  }).index("by_ticket", ["ticketId", "createdAt"]),

  // Who did what. businessId absent = platform-level action.
  auditLog: defineTable({
    businessId: v.optional(v.id("businesses")),
    actorMemberId: v.id("members"),
    actorName: v.string(),
    action: v.string(), // "staff.create", "business.suspend", "plan.update", ...
    details: v.optional(v.string()),
    createdAt: v.number(),
    // v4 — what was changed
    module: v.optional(v.string()), // prefix of `action`: "product", "business", ...
    targetId: v.optional(v.string()),
    targetName: v.optional(v.string()),
    changes: v.optional(v.array(v.object({ field: v.string(), from: v.string(), to: v.string() }))),
  })
    .index("by_business", ["businessId", "createdAt"])
    .index("by_created", ["createdAt"])
    .index("by_module", ["module", "createdAt"])
    .index("by_actor", ["actorMemberId", "createdAt"]),

  // v4 — per-business rollup refreshed hourly by cron (never scan sales on page load).
  businessStats: defineTable({
    businessId: v.id("businesses"),
    lastSaleAt: v.optional(v.number()),
    lastLoginAt: v.optional(v.number()),
    sales30dCents: v.number(),
    sales30dCount: v.number(),
    gmvThisMonthCents: v.number(),
    gmvLastMonthCents: v.number(),
    products: v.number(),
    customers: v.number(),
    staff: v.number(),
    updatedAt: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_lastSale", ["lastSaleAt"]),

  // v4 — internal platform-side notes about a business (never visible to tenants).
  businessNotes: defineTable({
    businessId: v.id("businesses"),
    body: v.string(),
    authorMemberId: v.id("members"),
    authorName: v.string(),
    createdAt: v.number(),
  }).index("by_business", ["businessId", "createdAt"]),

  // v4 — platform → business banners. Empty audience arrays = everyone.
  announcements: defineTable({
    title: v.string(),
    body: v.string(),
    level: v.union(v.literal("INFO"), v.literal("WARNING"), v.literal("SUCCESS")),
    audience: v.object({ planIds: v.array(v.id("plans")), businessTypes: v.array(v.string()) }),
    startsAt: v.number(),
    endsAt: v.optional(v.number()),
    isActive: v.boolean(),
    createdBy: v.id("members"),
    createdAt: v.number(),
  }).index("by_created", ["createdAt"]),

  // v4 — singleton (first row). Contact info is public; nothing secret goes here.
  platformSettings: defineTable({
    paymentInstructions: v.string(),
    supportPhone: v.string(),
    supportWhatsApp: v.string(),
    supportEmail: v.string(),
    signupsOpen: v.boolean(),
    updatedAt: v.number(),
  }),

  // ───────────── People ─────────────

  // Role + profile for every auth user. Platform roles have no businessId.
  members: defineTable({
    userId: v.id("users"),
    businessId: v.optional(v.id("businesses")),
    role,
    username: v.string(), // lowercase; equals the auth account id
    fullName: v.string(),
    phone: v.optional(v.string()),
    permissions: v.optional(permissions), // undefined = role defaults (shared/permissions.ts)
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_username", ["username"])
    .index("by_business", ["businessId"]),


  // ───────────── Business data (every row has businessId) ─────────────

  categories: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    parentId: v.optional(v.id("categories")), // max 2 levels
  }).index("by_business", ["businessId"]),

  // A product with variants is a template (hasVariants=true, never sold itself);
  // each variant is a normal product row with parentId + variantLabel.
  products: defineTable({
    businessId: v.id("businesses"),
    type: productType,
    name: v.string(),
    sku: v.string(), // "" if none
    barcode: v.string(), // primary, "" if none
    extraBarcodes: v.array(v.string()),
    categoryId: v.optional(v.id("categories")),
    brand: v.string(),
    unit: v.string(), // "pcs", "kg", "litre", "box", "metre"
    allowDecimal: v.boolean(), // sold by weight/length
    costCents: v.number(), // weighted average, updated on purchase
    priceCents: v.number(),
    wholesalePriceCents: v.optional(v.number()), // used for WHOLESALE customers
    stock: v.number(), // total on hand (sum of batches when trackExpiry)
    reorderLevel: v.number(), // low-stock alert at or below this
    trackExpiry: v.boolean(), // stock lives in batches with expiry dates
    supplierId: v.optional(v.id("suppliers")),
    imageId: v.optional(v.id("_storage")),
    parentId: v.optional(v.id("products")),
    variantLabel: v.optional(v.string()), // "Red / XL"
    hasVariants: v.boolean(),
    units: v.optional(v.array(productUnit)), // extra units besides the base `unit`
    attrs: v.optional(v.record(v.string(), v.string())), // values for business.attributeDefs
    attrsText: v.optional(v.string()), // searchable attrs joined, for the search index
    trackSerial: v.optional(v.boolean()), // each unit has an IMEI/serial (stock = IN_STOCK serials)
    warrantyMonths: v.optional(v.number()),
    isArchived: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_business", ["businessId", "isArchived"])
    .index("by_business_barcode", ["businessId", "barcode"])
    .index("by_business_sku", ["businessId", "sku"])
    .index("by_parent", ["parentId"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["businessId", "isArchived"] })
    .searchIndex("search_attrs", { searchField: "attrsText", filterFields: ["businessId", "isArchived"] }),

  // Stock with an expiry date. Sold first-expiry-first-out.
  batches: defineTable({
    businessId: v.id("businesses"),
    productId: v.id("products"),
    batchNo: v.string(),
    qty: v.number(), // remaining
    costCents: v.number(),
    expiryDate: v.number(),
    receivedAt: v.number(),
    purchaseId: v.optional(v.id("purchases")),
  })
    .index("by_product_expiry", ["productId", "expiryDate"])
    .index("by_business_expiry", ["businessId", "expiryDate"]),

  // Every stock change. Written ONLY through convex/lib/stock.ts.
  stockMovements: defineTable({
    businessId: v.id("businesses"),
    productId: v.id("products"),
    productName: v.string(),
    batchId: v.optional(v.id("batches")),
    type: movementType,
    qty: v.number(), // signed: + in, − out
    balanceAfter: v.number(),
    unitCostCents: v.number(),
    reason: v.optional(v.string()), // adjustment reason code
    note: v.optional(v.string()),
    ref: v.optional(v.string()), // "Sale #12", "Purchase #3"
    memberId: v.id("members"),
    memberName: v.string(),
    createdAt: v.number(),
  })
    .index("by_business_created", ["businessId", "createdAt"])
    .index("by_product", ["productId", "createdAt"]),

  suppliers: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    company: v.string(),
    phone: v.string(),
    whatsapp: v.string(),
    address: v.string(),
    notes: v.string(),
    balanceCents: v.number(), // what the business owes the supplier
    isArchived: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_business", ["businessId", "isArchived"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["businessId"] }),

  supplierLedger: defineTable({
    businessId: v.id("businesses"),
    supplierId: v.id("suppliers"),
    type: v.union(
      v.literal("OPENING"),
      v.literal("PURCHASE"),
      v.literal("PAYMENT"),
      v.literal("ADJUST_UP"),
      v.literal("ADJUST_DOWN"),
    ),
    amountCents: v.number(), // always positive
    balanceAfterCents: v.number(),
    purchaseId: v.optional(v.id("purchases")),
    method: v.optional(paymentMethod),
    reference: v.optional(v.string()),
    note: v.optional(v.string()),
    createdBy: v.id("members"),
    createdAt: v.number(),
  }).index("by_supplier", ["supplierId", "createdAt"]),

  // Goods received (stock in), optionally on supplier credit.
  purchases: defineTable({
    businessId: v.id("businesses"),
    number: v.number(), // per-business running number
    supplierId: v.optional(v.id("suppliers")),
    supplierName: v.string(),
    items: v.array(
      v.object({
        productId: v.id("products"),
        name: v.string(),
        qty: v.number(),
        unitCostCents: v.number(), // per base unit
        batchNo: v.optional(v.string()),
        expiryDate: v.optional(v.number()),
        unitName: v.optional(v.string()), // unit bought in; qty above is in base units
        unitQty: v.optional(v.number()), // qty in that unit (for display)
        serials: v.optional(v.array(v.string())),
      }),
    ),
    otherCostCents: v.number(), // transport etc.
    totalCents: v.number(),
    paidCents: v.number(), // the rest goes to the supplier balance
    paidMethod: v.optional(paymentMethod),
    note: v.string(),
    createdBy: v.id("members"),
    createdAt: v.number(),
  })
    .index("by_business_created", ["businessId", "createdAt"])
    .index("by_business_number", ["businessId", "number"])
    .index("by_supplier", ["supplierId", "createdAt"]),

  customers: defineTable({
    businessId: v.id("businesses"),
    fullName: v.string(),
    phone: v.string(),
    whatsapp: v.string(),
    type: v.union(v.literal("INDIVIDUAL"), v.literal("COMPANY")),
    companyName: v.string(),
    group: v.union(v.literal("RETAIL"), v.literal("WHOLESALE"), v.literal("VIP")),
    address: v.string(),
    district: v.string(),
    notes: v.string(),
    creditLimitCents: v.number(), // 0 = no credit allowed
    creditBlocked: v.boolean(),
    balanceCents: v.number(), // amount the customer owes; negative = store credit
    lastPaymentAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_phone", ["businessId", "phone"])
    .index("by_business_balance", ["businessId", "balanceCents"])
    .searchIndex("search_name", { searchField: "fullName", filterFields: ["businessId"] }),

  // Customer debt history.
  ledger: defineTable({
    businessId: v.id("businesses"),
    customerId: v.id("customers"),
    type: v.union(
      v.literal("OPENING"),
      v.literal("DEBT"), // credit sale
      v.literal("PAYMENT"),
      v.literal("REVERSAL"), // refund of a credit sale
      v.literal("ADJUST_UP"), // manual + add debt
      v.literal("ADJUST_DOWN"), // manual − reduce debt
      v.literal("WRITE_OFF"), // debt forgiven
    ),
    amountCents: v.number(), // always positive
    balanceAfterCents: v.number(),
    saleId: v.optional(v.id("sales")),
    method: v.optional(paymentMethod), // for PAYMENT
    reference: v.optional(v.string()),
    note: v.optional(v.string()), // required for ADJUST_* / WRITE_OFF
    shiftId: v.optional(v.id("shifts")), // cash repayments taken in this cashier shift
    createdBy: v.id("members"),
    createdAt: v.number(),
  })
    .index("by_customer", ["customerId", "createdAt"])
    .index("by_shift", ["shiftId"]),

  // Cash register session.
  shifts: defineTable({
    businessId: v.id("businesses"),
    memberId: v.id("members"),
    memberName: v.string(),
    status: v.union(v.literal("OPEN"), v.literal("CLOSED")),
    openingFloatCents: v.number(),
    openedAt: v.number(),
    closedAt: v.optional(v.number()),
    expectedCashCents: v.optional(v.number()), // computed at close
    countedCashCents: v.optional(v.number()),
    note: v.optional(v.string()),
  })
    .index("by_business_opened", ["businessId", "openedAt"])
    .index("by_member_status", ["memberId", "status"]),

  cashMovements: defineTable({
    businessId: v.id("businesses"),
    shiftId: v.id("shifts"),
    type: v.union(v.literal("IN"), v.literal("OUT")),
    amountCents: v.number(),
    reason: v.string(),
    memberId: v.id("members"),
    createdAt: v.number(),
  }).index("by_shift", ["shiftId", "createdAt"]),

  sales: defineTable({
    businessId: v.id("businesses"),
    clientSaleId: v.string(), // uuid from the device — offline retries are idempotent
    receiptNo: v.number(),
    cashierId: v.id("members"),
    cashierName: v.string(),
    shiftId: v.optional(v.id("shifts")),
    customerId: v.optional(v.id("customers")),
    customerName: v.optional(v.string()),
    items: v.array(
      v.object({
        productId: v.id("products"),
        name: v.string(), // includes variant label
        qty: v.number(),
        priceCents: v.number(), // unit price charged (retail or wholesale)
        discountCents: v.number(), // line discount total
        costCents: v.number(), // unit cost snapshot
        refundedQty: v.number(),
        batches: v.optional(v.array(v.object({ batchId: v.id("batches"), qty: v.number() }))),
        unitName: v.optional(v.string()), // unit sold in; qty/price are per this unit
        unitFactor: v.optional(v.number()), // base units per sold unit (stock moves qty × factor)
        serials: v.optional(v.array(v.string())),
        warrantyUntil: v.optional(v.number()),
      }),
    ),
    subtotalCents: v.number(), // Σ price×qty − line discounts
    discountCents: v.number(), // order discount
    taxCents: v.number(),
    totalCents: v.number(),
    payments: v.array(
      v.object({ method: paymentMethod, amountCents: v.number(), reference: v.optional(v.string()) }),
    ),
    changeCents: v.number(), // cash returned
    refundedCents: v.number(),
    status: v.union(v.literal("COMPLETED"), v.literal("PARTIALLY_REFUNDED"), v.literal("REFUNDED")),
    note: v.optional(v.string()),
    createdAt: v.number(), // device time of the sale
    syncedAt: v.number(),
  })
    .index("by_business_created", ["businessId", "createdAt"])
    .index("by_business_client_id", ["businessId", "clientSaleId"])
    .index("by_business_receipt", ["businessId", "receiptNo"])
    .index("by_business_cashier", ["businessId", "cashierId", "createdAt"])
    .index("by_shift", ["shiftId"])
    .index("by_customer", ["customerId", "createdAt"]),

  refunds: defineTable({
    businessId: v.id("businesses"),
    saleId: v.id("sales"),
    receiptNo: v.number(),
    items: v.array(
      v.object({
        productId: v.id("products"),
        name: v.string(),
        qty: v.number(),
        amountCents: v.number(),
        restock: v.boolean(),
        unitName: v.optional(v.string()), // matches the sale line's unit
      }),
    ),
    amountCents: v.number(),
    method: paymentMethod, // CREDIT = reduce customer debt
    reason: v.string(),
    shiftId: v.optional(v.id("shifts")),
    createdBy: v.id("members"),
    createdAt: v.number(),
  })
    .index("by_sale", ["saleId"])
    .index("by_shift", ["shiftId"])
    .index("by_business_created", ["businessId", "createdAt"]),

  expenses: defineTable({
    businessId: v.id("businesses"),
    category: v.string(), // from settings.expenseCategories
    amountCents: v.number(),
    paidVia: paymentMethod, // CASH from the drawer counts against the open shift
    payee: v.string(),
    note: v.string(),
    shiftId: v.optional(v.id("shifts")),
    spentAt: v.number(),
    createdBy: v.id("members"),
    createdAt: v.number(),
  })
    .index("by_business_spent", ["businessId", "spentAt"])
    .index("by_shift", ["shiftId"]),

  // ───────────── v3: serials & barcode catalog ─────────────

  // One row per physical unit of a trackSerial product (phones by IMEI, laptops by S/N).
  serials: defineTable({
    businessId: v.id("businesses"),
    productId: v.id("products"),
    serial: v.string(), // normalized: uppercase, no spaces
    status: v.union(v.literal("IN_STOCK"), v.literal("SOLD"), v.literal("RETURNED"), v.literal("WRITTEN_OFF")),
    costCents: v.number(),
    purchaseId: v.optional(v.id("purchases")),
    saleId: v.optional(v.id("sales")),
    customerId: v.optional(v.id("customers")),
    soldAt: v.optional(v.number()),
    warrantyUntil: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_business_and_serial", ["businessId", "serial"])
    .index("by_product_and_status", ["productId", "status"]),

  // GLOBAL shared product catalog (not tenant data). Only non-sensitive fields:
  // never price, cost, stock, supplier or which shop contributed.
  catalog: defineTable({
    barcode: v.string(),
    status: v.union(v.literal("PENDING"), v.literal("VERIFIED"), v.literal("HIDDEN"), v.literal("NOT_FOUND")),
    name: v.string(),
    brand: v.string(),
    size: v.string(), // "500 ml"
    categoryHint: v.string(),
    imageUrl: v.optional(v.string()), // external (e.g. Open Food Facts), with attribution
    imageId: v.optional(v.id("_storage")), // shop-uploaded photo
    source: v.union(v.literal("COMMUNITY"), v.literal("OPEN_FOOD_FACTS"), v.literal("OTHER")),
    confirmCount: v.number(), // distinct businesses that saved the same name
    flagCount: v.number(),
    locked: v.optional(v.boolean()), // edited by a SUPER_ADMIN: shop contributions no longer change name/brand/size
    fetchedAt: v.number(),
  })
    .index("by_barcode", ["barcode"])
    .index("by_status", ["status", "fetchedAt"]),

  // Which business contributed what for a barcode (private; used to count distinct confirmations).
  catalogContributions: defineTable({
    barcode: v.string(),
    businessId: v.id("businesses"),
    name: v.string(),
    brand: v.string(),
    size: v.string(),
    createdAt: v.number(),
  })
    .index("by_barcode_and_business", ["barcode", "businessId"])
    .index("by_barcode", ["barcode"]),

  // One row per (barcode, business) flag so a shop can flag a catalog entry only once.
  catalogFlags: defineTable({
    barcode: v.string(),
    businessId: v.id("businesses"),
  }).index("by_barcode_and_business", ["barcode", "businessId"]),

  // Phone-as-scanner pairing for a desktop POS / receive screen.
  scanSessions: defineTable({
    businessId: v.id("businesses"),
    memberId: v.id("members"), // the desktop user who created it
    code: v.string(), // random, shown as QR
    target: v.union(v.literal("POS"), v.literal("RECEIVE"), v.literal("STOCKTAKE"), v.literal("PRODUCTS")),
    expiresAt: v.number(),
    active: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_member", ["memberId", "createdAt"]),

  scans: defineTable({
    sessionId: v.id("scanSessions"),
    businessId: v.id("businesses"),
    barcode: v.string(),
    consumed: v.boolean(),
    createdAt: v.number(),
  }).index("by_session_and_consumed", ["sessionId", "consumed", "createdAt"]),
});
