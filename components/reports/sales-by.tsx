"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { BarChart3 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Col, DataTable, EmptyState, FilterChips, Money, Panel, Toolbar } from "@/components/common";
import { useBiz } from "@/components/guard";
import { formatCents } from "@/convex/shared/money";
import { hasPermission } from "@/convex/shared/permissions";
import { cents2, ExportBar, tzNow, type DateRange } from "./bits";

type Dim = "product" | "category" | "cashier" | "customer" | "hour";
const DIMS: { value: Dim; label: string }[] = [
  { value: "product", label: "Product" }, { value: "category", label: "Category" }, { value: "cashier", label: "Cashier" },
  { value: "customer", label: "Customer" }, { value: "hour", label: "Hour of day" },
];

export function SalesByView({ r }: { r: DateRange }) {
  const me = useBiz();
  const cur = me.business.currency;
  const seeCost = hasPermission(me.member, "seeCost");
  const [dim, setDim] = useState<Dim>("product");
  const data = useQuery(api.reports.salesBy, r.valid ? { from: r.fromMs, to: r.toMs, dimension: dim, tzOffsetMinutes: tzNow() } : "skip");

  const rows = data?.map((x) => ({ ...x, _id: x.key }));
  const max = Math.max(1, ...(data ?? []).map((x) => x.revenueCents));
  const total = (data ?? []).reduce((n, x) => n + x.revenueCents, 0);
  const label = DIMS.find((d) => d.value === dim)!.label;
  const csv = [
    [label, "Qty", `Revenue (${cur})`, ...(seeCost ? [`Profit (${cur})`] : [])],
    ...(data ?? []).map((x) => [x.label, x.qty, cents2(x.revenueCents), ...(seeCost ? [cents2(x.profitCents)] : [])]),
  ];
  type Row = NonNullable<typeof rows>[number];
  const cols: Col<Row>[] = [
    {
      header: label,
      cell: (x) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{x.label}</p>
          <div className="mt-1 h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(0, (x.revenueCents / max) * 100)}%` }} />
          </div>
        </div>
      ),
    },
    { header: "Qty sold", className: "text-right", cell: (x) => <span className="tnum">{x.qty}</span> },
    { header: "Share", className: "text-right", cell: (x) => <span className="tnum text-muted-foreground">{total ? Math.round((x.revenueCents / total) * 100) : 0}%</span> },
    { header: "Revenue", className: "text-right", cell: (x) => <Money className="font-medium">{formatCents(x.revenueCents, cur)}</Money> },
    ...(seeCost ? [{ header: "Profit", className: "text-right", cell: (x: Row) => <Money cents={x.profitCents ?? 0} tone="auto">{formatCents(x.profitCents ?? 0, cur)}</Money> }] : []),
  ];

  return (
    <Panel>
      <Toolbar actions={<ExportBar filename={`sales-by-${dim}-${r.from}-${r.to}`} title={`Sales by ${label.toLowerCase()}`} sub={`${r.label} · ${me.business.name}`} rows={csv} disabled={!data?.length} />}>
        <FilterChips options={DIMS} value={dim} onChange={setDim} />
      </Toolbar>
      <DataTable rows={rows} cols={cols} pageSize={dim === "hour" ? 24 : 25}
        empty={<EmptyState icon={BarChart3} title="No sales in this period" desc="Pick another date range to see the breakdown." />} />
    </Panel>
  );
}
