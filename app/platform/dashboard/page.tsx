"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { EmptyState, PageHeader, Panel, Pill, Stat } from "@/components/common";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/convex/shared/money";
import { fmtDate } from "@/lib/session";

export default function PlatformDashboard() {
  const s = useQuery(api.platformStats.overview);
  if (!s) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      </>
    );
  }
  const b = s.businesses;
  return (
    <>
      <PageHeader title="Dashboard" desc="Platform health at a glance." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Businesses" value={b.total} sub={`${s.newBusinesses30d} new in 30 days`} />
        <Stat label="Active" value={b.active} tone="text-emerald-600" />
        <Stat label="On trial" value={b.trial} />
        <Stat label="Expired" value={b.expired} tone={b.expired ? "text-amber-600" : undefined} />
        <Stat label="Suspended" value={b.suspended} tone={b.suspended ? "text-red-600" : undefined} />
        <Stat label="MRR" value={formatCents(s.mrrCents)} sub="active subscriptions" />
        <Stat label="Payments this month" value={formatCents(s.paymentsThisMonthCents)} />
        <Stat label="GMV this month" value={formatCents(s.gmvThisMonthCents)} sub="sales through the platform" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <div className="border-b p-4 font-semibold">Expiring in 7 days</div>
          {s.expiringIn7Days.length === 0 ? <EmptyState title="Nothing expiring soon" /> : (
            <ul className="divide-y">
              {s.expiringIn7Days.map((e) => (
                <li key={e._id}>
                  <Link href={`/platform/businesses/${e._id}`} className="flex items-center justify-between gap-3 p-3 text-sm hover:bg-muted">
                    <span><span className="font-medium">{e.name}</span><span className="block text-xs text-muted-foreground">{e.planName}</span></span>
                    <span className="flex items-center gap-2"><Pill tone="amber">{e.subscriptionStatus}</Pill>{fmtDate(e.subscriptionEndsAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Open tickets</p>
          <p className="mt-1 text-4xl font-semibold tabular-nums">{s.openTickets}</p>
          <Link href="/platform/support" className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:underline">Open support inbox</Link>
        </Panel>
      </div>
    </>
  );
}
