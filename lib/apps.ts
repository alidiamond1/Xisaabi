import {
  BarChart3, CalendarClock, CreditCard, FileClock, Headset, LifeBuoy, LayoutDashboard, Package,
  Megaphone, Receipt, ScanBarcode, Settings, ShieldCheck, ShoppingCart, Store, Tags, Truck, UserCog, Users, Wallet, type LucideIcon,
} from "lucide-react";
import type { AppKey } from "@/convex/shared/modules";

export type AppDef = {
  key: string;
  name: string;
  desc: string;
  href: string;
  icon: LucideIcon;
  tile: string; // tile bg + icon color classes
  tabs?: { label: string; href: string }[];
};

export const BUSINESS_APPS: (AppDef & { key: AppKey })[] = [
  { key: "pos", name: "Point of Sale", desc: "Sell fast, even offline", href: "/apps/pos", icon: ShoppingCart, tile: "bg-indigo-100 text-indigo-600" },
  { key: "inventory", name: "Inventory", desc: "Products & stock", href: "/apps/inventory", icon: Package, tile: "bg-sky-100 text-sky-600" },
  { key: "purchases", name: "Purchases", desc: "Suppliers & stock in", href: "/apps/purchases", icon: Truck, tile: "bg-lime-100 text-lime-700" },
  { key: "sales", name: "Sales", desc: "History & refunds", href: "/apps/sales", icon: Receipt, tile: "bg-emerald-100 text-emerald-600" },
  { key: "customers", name: "Customers", desc: "Credit & repayments", href: "/apps/customers", icon: Users, tile: "bg-violet-100 text-violet-600" },
  { key: "expiry", name: "Expiry", desc: "Watch dated stock", href: "/apps/expiry", icon: CalendarClock, tile: "bg-rose-100 text-rose-600" },
  { key: "expenses", name: "Expenses", desc: "Track spending", href: "/apps/expenses", icon: Wallet, tile: "bg-amber-100 text-amber-600" },
  { key: "reports", name: "Reports", desc: "Profit & trends", href: "/apps/reports", icon: BarChart3, tile: "bg-teal-100 text-teal-600" },
  { key: "staff", name: "Staff", desc: "Users & access", href: "/apps/staff", icon: UserCog, tile: "bg-fuchsia-100 text-fuchsia-600" },
  { key: "settings", name: "Settings", desc: "Business profile & tax", href: "/apps/settings", icon: Settings, tile: "bg-slate-200 text-slate-700" },
  { key: "billing", name: "Billing", desc: "Plan & payments", href: "/apps/billing", icon: CreditCard, tile: "bg-orange-100 text-orange-600" },
  { key: "support", name: "Support", desc: "Talk to our team", href: "/apps/support", icon: LifeBuoy, tile: "bg-cyan-100 text-cyan-600" },
];

export const PLATFORM_APPS: (AppDef & { superOnly?: boolean })[] = [
  { key: "dashboard", name: "Dashboard", desc: "Platform KPIs", href: "/platform/dashboard", icon: LayoutDashboard, tile: "bg-indigo-100 text-indigo-600" },
  { key: "businesses", name: "Businesses", desc: "Tenants & subscriptions", href: "/platform/businesses", icon: Store, tile: "bg-emerald-100 text-emerald-600" },
  { key: "billing", name: "Billing", desc: "Payments & revenue", href: "/platform/billing", icon: CreditCard, tile: "bg-orange-100 text-orange-600" },
  { key: "activity", name: "Activity", desc: "Every change, live", href: "/platform/activity", icon: FileClock, tile: "bg-slate-200 text-slate-700" },
  { key: "support", name: "Support Inbox", desc: "Customer tickets", href: "/platform/support", icon: Headset, tile: "bg-cyan-100 text-cyan-600" },
  { key: "announcements", name: "Announcements", desc: "Banners for businesses", href: "/platform/announcements", icon: Megaphone, tile: "bg-rose-100 text-rose-600" },
  { key: "catalog", name: "Barcode Catalog", desc: "Moderate shared products", href: "/platform/catalog", icon: ScanBarcode, tile: "bg-lime-100 text-lime-700" },
  { key: "plans", name: "Plans & Pricing", desc: "Edit plans", href: "/platform/plans", icon: Tags, tile: "bg-amber-100 text-amber-600" },
  { key: "staff", name: "Platform Staff", desc: "Platform admins", href: "/platform/staff", icon: UserCog, tile: "bg-fuchsia-100 text-fuchsia-600", superOnly: true },
  { key: "security", name: "Security", desc: "Logins & lockouts", href: "/platform/security", icon: ShieldCheck, tile: "bg-teal-100 text-teal-600" },
  { key: "settings", name: "Settings", desc: "Contact & signups", href: "/platform/settings", icon: Settings, tile: "bg-violet-100 text-violet-600", superOnly: true },
];

export const MODULE_LABELS: Record<string, string> = {
  pos: "Point of Sale", inventory: "Inventory", sales: "Sales", customers: "Customers",
  expiry: "Expiry", purchases: "Purchases", expenses: "Expenses", reports: "Reports", staff: "Staff",
};
