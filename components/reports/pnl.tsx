"use client";
import { useQuery } from "convex/react";
import { Lock } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { EmptyState, Money, Panel } from "@/components/common";
import { useBiz } from "@/components/guard";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/convex/shared/money";
import { hasPermission } from "@/convex/shared/permissions";
import { cn } from "@/lib/utils";
import { cents2, ExportBar, LOCKED_NOTE, type DateRange } from "./bits";

function Line({ label, cents, cur, sign, indent, strong, total, note }: {
  label: string; cents: number; cur: string; sign?: "-" | "+"; indent?: boolean; strong?: boolean; total?: boolean; note?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm", strong && "bg-muted/50 font-semibold", total && "bg-brand-50 text-base font-semibold text-brand-800")}>
      <span className={cn(indent && "pl-5 text-muted-foreground")}>{label}{note && <span className="ml-2 text-xs font-normal text-muted-foreground">{note}</span>}</span>
      <Money className={cn(total && cents < 0 && "text-danger", total && cents >= 0 && "text-success")}>{sign}{formatCents(sign ? Math.abs(cents) : cents, cur)}</Money>
    </div>
  );
}

export function PnlView({ r }: { r: DateRange }) {
  const me = useBiz();
  const cur = me.business.currency;
  const allowed = hasPermission(me.member, "seeCost");
  const p = useQuery(api.reports.profitAndLoss, allowed && r.valid ? { from: r.fromMs, to: r.toMs } : "skip");

  if (!allowed) return <Panel><EmptyState icon={Lock} title="Profit is hidden for you" desc={LOCKED_NOTE} /></Panel>;
  if (p === undefined) return <Panel className="p-4"><Skeleton className="h-96 w-full" /></Panel>;

  const margin = p.netSalesCents > 0 ? Math.round((p.grossProfitCents / p.netSalesCents) * 100) : null;
  const rows = [
    ["Line", `Amount (${cur})`],
    ["Revenue", cents2(p.revenueCents)], ["Refunds", -cents2(p.refundsCents)], ["Net sales", cents2(p.netSalesCents)],
    ["Cost of goods sold", -cents2(p.cogsCents)], ["Gross profit", cents2(p.grossProfitCents)],
    ...p.expensesByCategory.map((e) => [`Expense: ${e.category}`, -cents2(e.amountCents)]),
    ["Total expenses", -cents2(p.totalExpensesCents)], ["Stock write-offs (at cost)", -cents2(p.writeOffsCostCents)], ["Net profit", cents2(p.netProfitCents)],
  ];
  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2"><ExportBar filename={`profit-and-loss-${r.from}-${r.to}`} title="Profit & loss" sub={`${r.label} · ${me.business.name}`} rows={rows} /></div>
      <Panel className="mx-auto max-w-2xl">
        <div className="border-b px-4 py-3">
          <h2 className="font-display text-base font-semibold">Profit &amp; loss</h2>
          <p className="text-xs text-muted-foreground">{r.label}</p>
        </div>
        <div className="divide-y">
          <Line label="Revenue" cents={p.revenueCents} cur={cur} />
          <Line label="Refunds" cents={p.refundsCents} cur={cur} sign="-" indent />
          <Line label="Net sales" cents={p.netSalesCents} cur={cur} strong />
          <Line label="Cost of goods sold" cents={p.cogsCents} cur={cur} sign="-" indent />
          <Line label="Gross profit" cents={p.grossProfitCents} cur={cur} strong note={margin !== null ? `${margin}% margin` : undefined} />
          <div className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Expenses</div>
          {p.expensesByCategory.length === 0 && <p className="px-4 py-2.5 pl-9 text-sm text-muted-foreground">No expenses in this period.</p>}
          {p.expensesByCategory.map((e) => <Line key={e.category} label={e.category} cents={e.amountCents} cur={cur} sign="-" indent />)}
          <Line label="Total expenses" cents={p.totalExpensesCents} cur={cur} sign="-" strong />
          <Line label="Stock write-offs" cents={p.writeOffsCostCents} cur={cur} sign="-" note="damaged, expired, lost - at cost" />
          <Line label="Net profit" cents={p.netProfitCents} cur={cur} total />
        </div>
      </Panel>
    </div>
  );
}
