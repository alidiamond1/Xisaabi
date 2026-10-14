import {
  BarChart3, Camera, Clock, Coins, Package, Settings, ShieldCheck, ShoppingCart, UserCog, Users, Wallet, Wifi, WifiOff, type LucideIcon,
} from "lucide-react";

export const NAV = [
  { href: "/features", label: "Features" },
  { href: "/business-types", label: "Business types" },
  { href: "/pricing", label: "Pricing" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export type Feature = { icon: LucideIcon; title: string; text: string; points?: string[] };

/** The 6 headline features on the home page. */
export const KEY_FEATURES: Feature[] = [
  { icon: WifiOff, title: "Works without internet", text: "Internet down? Keep selling. Every sale syncs when you are back online." },
  { icon: Camera, title: "Scan barcodes with your phone", text: "Add or sell products by pointing your phone camera at the barcode. No extra scanner needed." },
  { icon: Wallet, title: "Cash, EVC Plus, Zaad, eDahab", text: "Record every way a customer pays, or put it on their credit tab." },
  { icon: Users, title: "Customer credit", text: "Know who owes you. Set credit limits, take repayments and send a WhatsApp reminder." },
  { icon: BarChart3, title: "Profit every day", text: "See sales, expenses and net profit. Your numbers are clear every evening." },
  { icon: ShieldCheck, title: "The right access for each person", text: "Owner, manager and cashier each see only what they need." },
];

/** Full module descriptions for /features. */
export const MODULES: Feature[] = [
  {
    icon: ShoppingCart, title: "Point of Sale", text: "The register: fast and simple.",
    points: [
      "Works offline. Sales are saved on the phone and sync when internet returns.",
      "Sell by scanning barcodes with the phone camera.",
      "Sell by piece, pack or box (for example box, strip, tablet).",
      "Hold an order and come back to it later.",
      "Returns and refunds, with a reason.",
      "Receipts you can print or share on WhatsApp.",
    ],
  },
  {
    icon: Package, title: "Inventory", text: "Know what you have and what is running out.",
    points: [
      "Products, categories, prices and stock levels.",
      "Expiry dates: the batch that expires first is sold first (FEFO).",
      "Stocktake: count the shelf, enter it, and the app fixes your stock.",
      "Low stock warnings.",
      "Purchases and suppliers: record stock coming in and what you owe.",
    ],
  },
  {
    icon: Users, title: "Customers and credit", text: "Every credit sale is written down in one place.",
    points: [
      "A credit limit for each customer.",
      "Take repayments, or add (+) and reduce (−) a balance.",
      "Printable customer statements.",
      "WhatsApp reminders for customers who owe you.",
    ],
  },
  {
    icon: Clock, title: "Shifts", text: "Stop cash mistakes and losses.",
    points: [
      "The cashier counts the drawer without seeing the expected amount (blind count).",
      "Reconcile each payment method: cash, EVC Plus, Zaad and eDahab.",
      "A Z-report when the shift closes.",
    ],
  },
  {
    icon: Coins, title: "Expenses", text: "Record rent, electricity, salaries and more.",
    points: ["Expense categories you choose.", "Note who was paid and how.", "Expenses count in your profit."],
  },
  {
    icon: BarChart3, title: "Reports", text: "See how your business is really doing.",
    points: ["Profit and loss (P&L).", "Sales by product and by cashier.", "Who owes you and who you owe."],
  },
  {
    icon: UserCog, title: "Staff and permissions", text: "Owner, manager and cashier.",
    points: ["Choose what each person can do.", "Hide cost prices and profit from cashiers.", "Limit the discount a cashier can give."],
  },
  {
    icon: Settings, title: "Settings", text: "Make the app fit your shop.",
    points: ["Choose payment methods: cash, EVC Plus, Zaad, eDahab, credit.", "Expense categories and discount presets.", "Shop name and receipt logo."],
  },
  {
    icon: Wifi, title: "Many devices, in real time", text: "The same data on every phone.",
    points: ["Sales and stock update live across devices.", "Owner and cashier can use different phones."],
  },
  {
    icon: ShieldCheck, title: "Security and privacy", text: "Your data is yours alone.",
    points: ["Each shop's data is kept separate. No other shop can see it.", "Password sign-in and staff permissions.", "Export your data to CSV."],
  },
];

export const STEPS = [
  { title: "Sign up", text: "Enter your shop name and a password. It takes two minutes." },
  { title: "Choose your business type", text: "Pharmacy, electronics, grocery, clothing and more. The app adjusts to your type." },
  { title: "Add your products", text: "Type them in, or scan the barcode with your phone camera. Set price and stock." },
  { title: "Start selling", text: "Open the register, sell and take payment. See your profit in the evening." },
  { title: "Close your shift", text: "Count the cash drawer and the app checks it for you. You get a Z-report." },
];

export const FAQ: { q: string; a: string }[] = [
  { q: "Is my data safe?", a: "Yes. Each shop's data is kept separate and no other shop can see it. Sign-in is protected by a password, and each staff member sees only what they are allowed to." },
  { q: "Does it work without internet?", a: "Yes, selling works offline. Each sale is saved on the phone and syncs when internet returns. Other parts, such as reports, need internet." },
  { q: "Which phones can I use?", a: "Any phone with a modern browser (Chrome or Safari), plus tablets and computers. You do not need to download anything from an app store." },
  { q: "Do I need a barcode scanner?", a: "No. Your phone camera reads barcodes. You need a secure page (HTTPS) and to allow camera access." },
  { q: "Are EVC Plus, Zaad and eDahab payments automatic?", a: "No, not yet. The cashier records the payment method and reference when the customer pays. It goes into your books, but XisabSax does not move the money." },
  { q: "How do I pay for my subscription?", a: "You can pay by EVC Plus or Zaad. Payment instructions are inside the app (Billing), and our team confirms your payment." },
  { q: "Is there a free trial?", a: "Yes. When you sign up you get a free trial, and no bank card is needed. See the Pricing page for the exact length." },
  { q: "Can several staff use it?", a: "Yes. Add cashiers and managers. How many depends on the plan you choose." },
  { q: "Can I export my data?", a: "Yes. You can export sales, customers and products to CSV and open them in Excel." },
  { q: "How do I add many products at once?", a: "Add them one by one, scan their barcodes, or import a CSV file." },
  { q: "Can I hide my profit from staff?", a: "Yes. Only people with permission to see cost can see cost prices and profit. You can hide them from cashiers." },
  { q: "How do I get help?", a: "Open Support inside the app, or contact us by WhatsApp, phone or email on the Contact page." },
];

/** What XisabSax does for each business type (keyed by convex/shared/presets key). */
export const BIZ: Record<string, { label: string; text: string }> = {
  general: { label: "General shop", text: "A bit of everything. Sell by piece or pack and track your stock." },
  grocery: { label: "Grocery / mini-market", text: "Rice, oil, sugar, drinks. Expiry dates, selling by weight and wholesale prices." },
  pharmacy: { label: "Pharmacy", text: "Medicine by box, strip or tablet. Expiry dates (FEFO), generic name, strength and manufacturer." },
  electronics: { label: "Electronics and phones", text: "IMEI or serial number for each device, with warranty. Models, conditions and repair services." },
  mobile_money: { label: "Mobile money and airtime", text: "Airtime, data bundles and fees, recorded simply." },
  clothing: { label: "Clothing, shoes and fabric", text: "Sizes and colours, and fabric sold by the metre." },
  cosmetics: { label: "Cosmetics and perfume", text: "Perfume, oud and uunsi sold by weight, with shades or scents and expiry dates." },
  hardware: { label: "Hardware and building", text: "Cement, steel, paint, plumbing. Bags, tonnes and metres, plus wholesale prices." },
  auto_parts: { label: "Auto spare parts", text: "Part number, OEM number and the vehicles a part fits. Search fast." },
  restaurant: { label: "Restaurant / cafe", text: "Meals, tea and juice. Quick sales with no stock to track." },
  bakery: { label: "Bakery", text: "Bread, cakes and pastries. Expiry dates and selling by count or weight." },
  butcher: { label: "Butcher", text: "Meat sold by the kilo: beef, goat, camel, chicken." },
  furniture: { label: "Furniture and household", text: "Beds, sofas, tables. Dimensions, materials and serial numbers." },
  stationery: { label: "Stationery and books", text: "Books (ISBN), pens, paper and school bags." },
  wholesale: { label: "Wholesale / distributor", text: "Cartons, sacks and dozens. Wholesale prices, supplier purchases and expiry." },
  gas_water: { label: "Gas and water", text: "Gas cylinders, water and jerrycans. Products and services together." },
  salon: { label: "Salon / barber", text: "Services (hair, beard, braids, nails) and products, with no stock needed for services." },
};
