"use client";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Banknote, Lock } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Col, DataTable, EmptyState, Money, PageHeader, Panel, Stat } from "@/components/common";
import { useBiz } from "@/components/guard";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/convex/shared/money";
import { hasPermission } from "@/convex/shared/permissions";

type Group = FunctionReturnType<typeof api.inventory.valuation>["byCategory"][number];

export function ValuationView() {
  const me = useBiz();
  const cur = me.business.currency;
  const allowed = hasPermission(me.member, "seeCost");
  const v = useQuery(api.inventory.valuation, allowed ? {} : "skip");

  if (!allowed) {
    return (<><PageHeader title="Stock valuation" /><Panel><EmptyState icon={Lock} title="Cost prices are hidden for you" desc="Ask the owner for the See cost price & profit permission." /></Panel></>);
  }
  const rows = v?.byCategory.map((g) => ({ ...g, _id: g.name }));
  const cols: Col<Group & { _id: string }>[] = [
    { header: "Category", cell: (g) => <span className="font-medium">{g.name}</span> },
    { header: "Products", className: "text-right", cell: (g) => <span className="tabular-nums">{g.items}</span> },
    { header: "Cost value", className: "text-right", cell: (g) => <Money>{formatCents(g.costCents, cur)}</Money> },
    { header: "Retail value", className: "text-right", cell: (g) => <Money>{formatCents(g.retailCents, cur)}</Money> },
    { header: "Potential profit", className: "text-right", cell: (g) => <Money cents={g.retailCents - g.costCents} tone="auto">{formatCents(g.retailCents - g.costCents, cur)}</Money> },
  ];

  return (
    <>
      <PageHeader title="Stock valuation" desc="What your stock on hand is worth right now." />
      {v === undefined ? (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)}</div>
      ) : (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat icon={Banknote} label="Stock at cost" value={formatCents(v.totalCostCents, cur)} sub="what you paid" />
          <Stat label="Stock at retail" value={formatCents(v.totalRetailCents, cur)} sub="if all sold at full price" />
          <Stat label="Potential profit" value={formatCents(v.totalRetailCents - v.totalCostCents, cur)} tone="text-success" sub="retail minus cost" />
        </div>
      )}
      <Panel>
        <DataTable rows={rows} cols={cols} empty={<EmptyState icon={Banknote} title="No stock to value" desc="Receive or add stock and its value will appear here." />} />
      </Panel>
    </>
  );
}
