"use client";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { RefreshCw } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { EmptyState, PageHeader, Panel, Pill, Stat } from "@/components/common";
import { HealthPill, ago, useNow } from "@/components/platform";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/convex/shared/money";
import { run } from "@/lib/run";
import { fmtDate } from "@/lib/session";

/** "+12% vs last month" (or "new" when there is no baseline). */
function delta(cur: number, prev: number) {
  if (prev === 0) return cur === 0 ? "same as last month" : "new this month";
  const p = Math.round(((cur - prev) / prev) * 100);
  return `${p > 0 ? "▲ +" : p < 0 ? "▼ " : ""}${p}% vs last month`;
}

/** 12 plain-CSS bars. Month initial under each bar; exact values in the title / screen-reader label. */
function BarChart({ title, data, fmt }: { title: string; data: { month: string; v: number }[]; fmt: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.v));
  return (
    <Panel className="p-4">
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground">This month: {fmt(data[data.length - 1].v)}</p>
      <div role="img" aria-label={`${title}: ${data.map((d) => `${d.month} ${fmt(d.v)}`).join(", ")}`} className="mt-3 flex h-36 items-end gap-1">
        {data.map((d, i) => (
          <div key={d.month} title={`${d.month}: ${fmt(d.v)}`} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            <div className={i === data.length - 1 ? "rounded-t bg-brand-600" : "rounded-t bg-brand-200"} style={{ height: `${Math.max(2, (d.v / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1" aria-hidden>
        {data.map((d) => <span key={d.month} className="min-w-0 flex-1 text-center text-[10px] text-muted-foreground">{new Date(d.month + "-01").toLocaleString("en-GB", { month: "short", timeZone: "UTC" }).slice(0, 1)}</span>)}
      </div>
    </Panel>
  );
}

type BizRow = { _id: string; name: string; sub: string; right: React.ReactNode };
function BizList({ title, rows, empty }: { title: string; rows: BizRow[]; empty: string }) {
  return (
    <Panel>
      <div className="border-b p-4 font-semibold">{title}</div>
      {rows.length === 0 ? <EmptyState title={empty} /> : (
        <ul className="max-h-80 divide-y overflow-y-auto">
          {rows.map((r) => (
            <li key={r._id}>
              <Link href={`/platform/businesses/${r._id}`} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-muted">
                <span className="min-w-0"><span className="block truncate font-medium">{r.name}</span><span className="block truncate text-xs text-muted-foreground">{r.sub}</span></span>
                <span className="shrink-0 text-right">{r.right}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { key: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Panel className="p-4">
      <p className="mb-2 text-sm font-semibold">{title}</p>
      <ul className="max-h-64 space-y-2 overflow-y-auto">
        {rows.slice(0, 12).map((r) => (
          <li key={r.key} className="text-sm">
            <div className="flex justify-between gap-2"><span className="truncate capitalize">{r.key}</span><span className="tabular-nums text-muted-foreground">{r.count}</span></div>
            <div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(r.count / max) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default function PlatformDashboard() {
  const now = useNow();
  const s = useQuery(api.platformStats.overview, { now });
  const refresh = useMutation(api.platformStats.refreshNow);
  const actions = <Button variant="outline" onClick={() => run(refresh(), "Refreshing stats. Numbers update in a moment.")}><RefreshCw /> Refresh stats</Button>;
  if (!s) {
    return (
      <>
        <PageHeader title="Dashboard" actions={actions} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      </>
    );
  }
  const c = s.counts;
  const money = (n: number) => formatCents(n);
  return (
    <>
      <PageHeader title="Dashboard" desc="Platform health at a glance." actions={actions} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="MRR" value={money(s.mrrCents)} sub="active subscriptions" />
        <Stat label="ARR" value={money(s.arrCents)} sub="MRR x 12" />
        <Stat label="Collected" value={money(s.collectedThisMonthCents)} sub={delta(s.collectedThisMonthCents, s.collectedLastMonthCents)} />
        <Stat label="GMV this month" value={money(s.gmvThisMonthCents)} sub={delta(s.gmvThisMonthCents, s.gmvLastMonthCents)} />
        <Stat label="Paying" value={s.payingCount} tone="text-emerald-600" sub={`${c.total} businesses · ${s.newBusinesses30d} new in 30d`} />
        <Stat label="On trial" value={c.trial} sub={`${c.expired} expired · ${c.suspended} suspended`} />
        <Stat label="Trial conversion" value={`${s.trialConversionPercent}%`} sub="paid, of businesses older than 14d" />
        <Stat label="Churned (30d)" value={s.churned30d} tone={s.churned30d ? "text-red-600" : undefined} />
        <Link href="/platform/support" className="col-span-2 lg:col-span-4 [&>div]:h-full">
          <Stat label="Open tickets" value={s.openTickets}
            sub={s.oldestWaitingTicketAt ? `Oldest waiting for a reply: ${ago(s.oldestWaitingTicketAt, now)}` : "Nobody is waiting for a reply"}
            tone={s.oldestWaitingTicketAt && now - s.oldestWaitingTicketAt > 86_400_000 ? "text-amber-600" : undefined} />
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Health</span>
        {(["ACTIVE", "QUIET", "DORMANT", "NEW"] as const).map((h) => (
          <Link key={h} href={`/platform/businesses?health=${h}`} className="inline-flex min-h-8 items-center gap-1.5"><HealthPill h={h} /><span className="font-semibold tabular-nums">{s.health[h]}</span></Link>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <BarChart title="Signups, last 12 months" data={s.series.map((x) => ({ month: x.month, v: x.signups }))} fmt={String} />
        <BarChart title="Collected, last 12 months" data={s.series.map((x) => ({ month: x.month, v: x.collectedCents }))} fmt={money} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <BizList title="Expiring in 7 days" empty="Nothing expiring soon"
          rows={s.expiringIn7Days.map((e) => ({ _id: e._id, name: e.name, sub: e.planName, right: <><Pill tone="amber">{e.subscriptionStatus}</Pill><span className="block text-xs text-muted-foreground">{fmtDate(e.subscriptionEndsAt)}</span></> }))} />
        <BizList title="Overdue (expired)" empty="No overdue businesses"
          rows={s.overdue.map((e) => ({ _id: e._id, name: e.name, sub: e.planName, right: <><Pill tone="red">{e.subscriptionStatus}</Pill><span className="block text-xs text-muted-foreground">ended {fmtDate(e.subscriptionEndsAt)}</span></> }))} />
        <BizList title="At risk (paying, going quiet)" empty="No paying business is going quiet"
          rows={s.atRisk.map((e) => ({ _id: e._id, name: e.name, sub: `${e.planName} · ${e.lastSaleAt ? `last sale ${fmtDate(e.lastSaleAt)}` : "never sold"}`, right: <HealthPill h={e.health} /> }))} />
        <BizList title="Top by sales (30 days)" empty="No sales yet"
          rows={s.topByGmv.map((e) => ({ _id: e._id, name: e.name, sub: `${e.sales30dCount} sales`, right: <span className="font-medium tabular-nums">{money(e.sales30dCents)}</span> }))} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Breakdown title="By business type" rows={s.byType} />
        <Breakdown title="By plan" rows={s.byPlan} />
        <Breakdown title="By city" rows={s.byCity} />
      </div>
    </>
  );
}
