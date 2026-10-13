"use client";
import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { AlertTriangle, ArrowRight, Clock, PackageMinus, Receipt, ShoppingCart, Truck, Users } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useBiz } from "@/components/guard";
import { Banner, Stat } from "@/components/common";
import { Skeleton } from "@/components/ui/skeleton";
import { canOpenApp } from "@/convex/shared/modules";
import { formatCents } from "@/convex/shared/money";
import { DAY_MS } from "@/convex/shared/expiry";
import { BUSINESS_APPS } from "@/lib/apps";
import { fmtDate } from "@/lib/session";
import { cn } from "@/lib/utils";

const GROUPS: { title: string; keys: string[] }[] = [
  { title: "Sell", keys: ["pos", "sales", "customers"] },
  { title: "Stock", keys: ["inventory", "purchases", "expiry"] },
  { title: "Run the business", keys: ["expenses", "reports", "staff"] },
  { title: "Account", keys: ["settings", "billing", "support"] },
];

/** Makes a KPI tile tappable when the destination app is available. */
function KpiLink({ href, children }: { href?: string; children: React.ReactNode }) {
  return href ? <Link href={href} className="block rounded-xl transition-transform active:scale-[0.99]">{children}</Link> : <>{children}</>;
}

export default function Launcher() {
  const me = useBiz();
  const role = me.member.role as "OWNER" | "MANAGER" | "CASHIER";
  const tz = useMemo(() => -new Date().getTimezoneOffset(), []);
  const showKpi = role !== "CASHIER" && !me.lockReason;
  const kpi = useQuery(api.dashboard.home, showKpi ? { tzOffsetMinutes: tz } : "skip");
  const alerts = useQuery(api.expiry.alertCount, me.lockReason ? "skip" : {});
  const cur = me.business.currency;

  const apps = BUSINESS_APPS.filter(
    (a) => canOpenApp(role, me.plan.modules, a.key) && (!me.lockReason || ["billing", "support", "settings"].includes(a.key)),
  );
  const hasPos = apps.some((a) => a.key === "pos");
  const daysLeft = Math.ceil((me.business.subscriptionEndsAt - Date.now()) / DAY_MS);
  const trial = me.business.subscriptionStatus === "TRIAL";
  const endingSoon = !me.lockReason && daysLeft <= 7;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{greet}, {me.member.fullName.split(" ")[0]}</h1>
        </div>
        <p className="rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-card">
          {me.plan.name} plan · <span className="capitalize">{role.toLowerCase()}</span>
        </p>
      </div>

      {me.lockReason && (
        <Banner tone="danger" icon={AlertTriangle}>
          {me.lockReason === "BUSINESS_SUSPENDED" ? "This business is suspended." : "Your subscription has expired."}{" "}
          Open <Link className="font-semibold underline" href="/apps/billing">Billing</Link> or <Link className="font-semibold underline" href="/apps/support">Support</Link>.
        </Banner>
      )}
      {!me.lockReason && (trial || endingSoon) && role === "OWNER" && (
        <Banner tone={endingSoon ? "warning" : "info"} icon={Clock}>
          {trial ? "Free trial" : "Subscription"} ends {fmtDate(me.business.subscriptionEndsAt)} ({daysLeft} day{daysLeft === 1 ? "" : "s"} left).{" "}
          <Link className="font-semibold underline" href="/apps/billing">Choose a plan</Link>
        </Banner>
      )}
      {alerts && (alerts.expired > 0 || alerts.oneMonth > 0) && (
        <Banner tone="danger" icon={AlertTriangle}>
          {alerts.expired > 0 && <>{alerts.expired} product{alerts.expired === 1 ? " is" : "s are"} expired. </>}
          {alerts.oneMonth > 0 && <>{alerts.oneMonth} product{alerts.oneMonth === 1 ? "" : "s"} expire{alerts.oneMonth === 1 ? "s" : ""} within a month. </>}
          <Link className="font-semibold underline" href="/apps/expiry">Review</Link>
        </Banner>
      )}

      {hasPos && !me.lockReason && (
        <Link href="/apps/pos" className="group relative flex items-center gap-4 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-900 p-5 text-white shadow-pop transition-transform active:scale-[0.99] sm:p-6">
          <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 size-44 rounded-full bg-white/10" />
          <span aria-hidden className="pointer-events-none absolute -bottom-16 right-24 size-40 rounded-full bg-gold/20" />
          <span className="relative grid size-14 shrink-0 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/25"><ShoppingCart className="size-7" /></span>
          <span className="relative min-w-0 flex-1">
            <span className="block font-display text-xl font-semibold tracking-tight sm:text-2xl">Start selling</span>
            <span className="block text-sm text-brand-100">Open the register. Works offline too.</span>
          </span>
          <ArrowRight className="relative size-6 transition-transform group-hover:translate-x-1" />
        </Link>
      )}

      {showKpi && (
        kpi === undefined ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)}</div>
        ) : kpi && (
          <div className={cn("grid grid-cols-2 gap-3", kpi.payablesCents === null ? "lg:grid-cols-4" : "lg:grid-cols-5")}>
            <Stat icon={Receipt} label="Today's sales" value={formatCents(kpi.todaySalesCents, cur)} sub={`${kpi.todaySalesCount} sale${kpi.todaySalesCount === 1 ? "" : "s"}`} />
            <KpiLink href={apps.some((a) => a.key === "inventory") ? "/apps/inventory?view=low" : undefined}>
              <Stat icon={PackageMinus} label="Low stock" value={kpi.lowStockCount} sub="products to reorder" tone={kpi.lowStockCount ? "text-warning" : undefined} />
            </KpiLink>
            <KpiLink href={apps.some((a) => a.key === "customers") ? "/apps/customers?view=debt" : undefined}>
              <Stat icon={Users} label="Customer debt" value={formatCents(kpi.outstandingDebtCents, cur)} sub="owed to you" />
            </KpiLink>
            {kpi.payablesCents !== null && (
              <KpiLink href="/apps/purchases">
                <Stat icon={Truck} label="You owe suppliers" value={formatCents(kpi.payablesCents, cur)} sub="payables" tone={kpi.payablesCents ? "text-danger" : undefined} />
              </KpiLink>
            )}
            <Stat icon={Clock} label="My shift" value={kpi.openShift ? "Open" : "Closed"} tone={kpi.openShift ? "text-success" : "text-muted-foreground"}
              sub={kpi.openShift ? `since ${new Date(kpi.openShift.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "open one in the POS"} />
          </div>
        )
      )}

      {GROUPS.map((g) => {
        const list = g.keys.map((k) => apps.find((a) => a.key === k)).filter((a) => !!a);
        if (list.length === 0) return null;
        return (
          <section key={g.title} aria-label={g.title}>
            <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</h2>
            <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
              {list.map((a) => (
                <Link key={a.key} href={a.href}
                  className="group flex items-center gap-3.5 rounded-xl border bg-card p-3.5 shadow-card transition-all hover:-translate-y-px hover:border-brand-300 hover:shadow-pop active:scale-[0.99]">
                  <span className={cn("grid size-12 shrink-0 place-items-center rounded-xl transition-transform group-hover:scale-105", a.tile)}><a.icon className="size-6" /></span>
                  <span className="min-w-0">
                    <span className="block font-semibold leading-tight">{a.name}</span>
                    <span className="block truncate text-sm text-muted-foreground">{a.desc}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
