"use client";
import { useRef } from "react";
import { useQuery } from "convex/react";
import { BarChart3, Lock, Percent, Receipt, TrendingUp, Users, Wallet } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { EmptyState, Money, Panel, Stat } from "@/components/common";
import { useBiz } from "@/components/guard";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/convex/shared/money";
import { hasPermission } from "@/convex/shared/permissions";
import { cn } from "@/lib/utils";
import { cents2, ExportBar, LOCKED_NOTE, METHODS, METHOD_LABEL, tzNow, type DateRange, type Method } from "./bits";

type Day = { date: string; revenueCents: number; profitCents: number | null };
const METHOD_BAR: Record<Method, string> = {
  CASH: "bg-success", EVC: "bg-brand-600", ZAAD: "bg-info", EDAHAB: "bg-gold", BANK: "bg-brand-300", CREDIT: "bg-warning",
};

function niceMax(v: number) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  // steps divisible by 4 so the four gridlines land on tidy values
  return (([1, 1.2, 1.6, 2, 2.4, 3.2, 4, 6, 8, 10].find((m) => m * p >= v) ?? 10)) * p;
}
const short = (c: number) => { const v = c / 100; return Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(Math.round(v * 100) / 100); };

/** Revenue bars + optional profit line, plain SVG. Scrolls sideways inside its card on phones. */
function DailyChart({ days, currency }: { days: Day[]; currency: string }) {
  const scrolled = useRef(false);
  const W = 640, H = 240, L = 44, R = 8, T = 12, B = 28;
  const iw = W - L - R, ih = H - T - B;
  const hasProfit = days.some((d) => d.profitCents !== null);
  const profits = days.map((d) => d.profitCents ?? 0);
  const max = niceMax(Math.max(...days.map((d) => d.revenueCents), ...profits, 0));
  const min = Math.min(0, ...profits);
  const lo = min < 0 ? -niceMax(-min) : 0;
  const y = (v: number) => T + ih - ((v - lo) / (max - lo)) * ih;
  const step = iw / days.length;
  const bw = Math.max(2, Math.min(28, step * 0.62));
  const x = (i: number) => L + step * i + step / 2;
  const every = Math.ceil(days.length / 8);
  const line = days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.profitCents ?? 0).toFixed(1)}`).join(" ");
  return (
    <div className="overflow-x-auto" ref={(el) => { if (el && !scrolled.current) { scrolled.current = true; el.scrollLeft = el.scrollWidth; } }}>{/* newest days in view on phones */}
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto max-h-72 w-full min-w-[520px]" role="img" aria-label={`Daily revenue${hasProfit ? " and profit" : ""} in ${currency}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const v = lo + (max - lo) * f;
          return (
            <g key={f}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-border" strokeDasharray={f ? "3 3" : undefined} />
              <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" className="fill-muted-foreground">{short(v)}</text>
            </g>
          );
        })}
        {days.map((d, i) => (
          <g key={d.date}>
            <rect x={x(i) - bw / 2} y={y(Math.max(d.revenueCents, 0))} width={bw} height={Math.max(0, y(0) - y(Math.max(d.revenueCents, 0)))} rx="2" className="fill-brand-500">
              <title>{`${d.date}: ${formatCents(d.revenueCents, currency)}`}</title>
            </rect>
            {i % every === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" className="fill-muted-foreground">{d.date.slice(5)}</text>}
          </g>
        ))}
        {hasProfit && (
          <>
            <path d={line} fill="none" strokeWidth="2" strokeLinejoin="round" className="stroke-gold" />
            {days.length <= 31 && days.map((d, i) => (
              <circle key={d.date} cx={x(i)} cy={y(d.profitCents ?? 0)} r="3" className="fill-gold stroke-card" strokeWidth="1.5">
                <title>{`${d.date} profit: ${formatCents(d.profitCents ?? 0, currency)}`}</title>
              </circle>
            ))}
          </>
        )}
      </svg>
    </div>
  );
}

export function OverviewView({ r }: { r: DateRange }) {
  const me = useBiz();
  const cur = me.business.currency;
  const seeCost = hasPermission(me.member, "seeCost");
  const s = useQuery(api.reports.summary, r.valid ? { from: r.fromMs, to: r.toMs, tzOffsetMinutes: tzNow() } : "skip");

  if (s === undefined) {
    return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)}</div>;
  }
  const netSales = s.revenueCents - s.refundsCents;
  const split = METHODS.reduce((n, m) => n + Math.max(s.byPaymentMethod[m], 0), 0);
  const margin = s.grossProfitCents !== null && netSales > 0 ? Math.round((s.grossProfitCents / netSales) * 100) : null;
  const locked = <Lock className="size-5 text-muted-foreground" aria-label="Hidden" />;
  const rows = [
    ["Measure", `Amount (${cur})`],
    ["Revenue", cents2(s.revenueCents)], ["Refunds", cents2(s.refundsCents)], ["Expenses", cents2(s.expensesCents)],
    ["Cost of goods", cents2(s.costCents)], ["Gross profit", cents2(s.grossProfitCents)], ["Net profit", cents2(s.netProfitCents)],
    ["Sales", s.salesCount], ["Discounts given", cents2(s.discountsCents)], ["Customer debt", cents2(s.outstandingDebtCents)],
    [], ["Payment method", `Collected (${cur})`], ...METHODS.map((m) => [METHOD_LABEL[m], cents2(s.byPaymentMethod[m])]),
    [], ["Top product", "Qty sold", `Revenue (${cur})`], ...s.topProducts.map((p) => [p.name, p.qty, cents2(p.revenueCents)]),
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2"><ExportBar filename={`overview-${r.from}-${r.to}`} title="Business overview" sub={`${r.label} · ${me.business.name}`} rows={rows} /></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Receipt} label="Revenue" value={formatCents(s.revenueCents, cur)} sub={`${s.salesCount} sale${s.salesCount === 1 ? "" : "s"}, before refunds`} />
        <Stat icon={TrendingUp} label="Gross profit" value={s.grossProfitCents === null ? locked : formatCents(s.grossProfitCents, cur)}
          sub={s.grossProfitCents === null ? "Ask the owner for access" : margin !== null ? `${margin}% margin` : undefined} />
        <Stat icon={Wallet} label="Expenses" value={formatCents(s.expensesCents, cur)} />
        <Stat icon={Percent} label="Net profit" value={s.netProfitCents === null ? locked : formatCents(s.netProfitCents, cur)}
          tone={s.netProfitCents !== null ? (s.netProfitCents < 0 ? "text-danger" : "text-success") : undefined} sub={s.netProfitCents === null ? "Ask the owner for access" : "after expenses"} />
        <Stat label="Refunds" value={formatCents(s.refundsCents, cur)} sub={`${s.refundsCount} refund${s.refundsCount === 1 ? "" : "s"}`} />
        <Stat label="Average sale" value={s.salesCount ? formatCents(Math.round(s.revenueCents / s.salesCount), cur) : "-"} />
        <Stat label="Discounts given" value={formatCents(s.discountsCents, cur)} />
        <Stat icon={Users} label="Customer debt" value={formatCents(s.outstandingDebtCents, cur)} sub="owed right now" />
      </div>

      <Panel className="p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-base font-semibold">Daily revenue{seeCost && " and profit"}</h2>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-brand-500" />Revenue</span>
            {seeCost && <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-gold" />Profit</span>}
          </div>
        </div>
        {s.salesCount === 0 ? <EmptyState icon={BarChart3} title="No sales in this period" desc="Pick another date range, or make a sale." /> : <DailyChart days={s.daily} currency={cur} />}
        {!seeCost && <p className="mt-2 text-xs text-muted-foreground">Profit is hidden. {LOCKED_NOTE}</p>}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-4">
          <h2 className="mb-3 font-display text-base font-semibold">Payment methods</h2>
          <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
            {METHODS.map((m) => <div key={m} className={METHOD_BAR[m]} style={{ width: `${split ? (Math.max(s.byPaymentMethod[m], 0) / split) * 100 : 0}%` }} />)}
          </div>
          <ul className="space-y-2.5 text-sm">
            {METHODS.map((m) => (
              <li key={m} className="flex items-center gap-2">
                <i className={cn("size-2.5 rounded-full", METHOD_BAR[m])} />
                <span className="flex-1">{METHOD_LABEL[m]}</span>
                <span className="tnum text-muted-foreground">{split ? Math.round((Math.max(s.byPaymentMethod[m], 0) / split) * 100) : 0}%</span>
                <Money className="w-28 text-right font-medium">{formatCents(s.byPaymentMethod[m], cur)}</Money>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel className="p-4">
          <h2 className="mb-3 font-display text-base font-semibold">Top products</h2>
          {s.topProducts.length === 0 ? <p className="text-sm text-muted-foreground">No sales in this period.</p> : (
            <ol className="space-y-2.5">
              {s.topProducts.map((p, i) => (
                <li key={p.name + i} className="flex items-center gap-3 text-sm">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-800">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="tnum hidden text-muted-foreground sm:inline">{p.qty} sold</span>
                  <Money className="w-24 text-right font-medium">{formatCents(p.revenueCents, cur)}</Money>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}
