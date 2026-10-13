"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { PackageCheck, Truck } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Col, DataTable, EmptyState, PageHeader, Panel, Pill } from "@/components/common";
import { useBiz } from "@/components/guard";
import { Button } from "@/components/ui/button";
import { canOpenApp } from "@/convex/shared/modules";
import { fmtQty } from "./bits";

type Row = FunctionReturnType<typeof api.inventory.lowStock>[number];
const receiveHref = (rows: Row[]) => `/apps/purchases?view=receive&items=${rows.map((r) => `${r._id}:${r.suggestedQty}`).join(",")}`;

export function LowStockView() {
  const me = useBiz();
  const router = useRouter();
  const rows = useQuery(api.inventory.lowStock);
  const canReceive = canOpenApp(me.member.role as never, me.plan.modules, "purchases");
  const sorted = rows && [...rows].sort((a, b) => a.stock - b.stock);

  const cols: Col<Row>[] = [
    { header: "Product", cell: (p) => <div className="min-w-0"><p className="truncate font-medium">{p.name}</p>{p.variantLabel && <p className="truncate text-xs text-muted-foreground">{p.variantLabel}</p>}</div> },
    { header: "In stock", className: "text-right", cell: (p) => <span className="flex items-center justify-end gap-2"><span className="tabular-nums">{fmtQty(p.stock)} {p.unit}</span>{p.stock <= 0 ? <Pill tone="red">Out</Pill> : <Pill tone="amber">Low</Pill>}</span> },
    { header: "Reorder at", className: "text-right", cell: (p) => <span className="tabular-nums text-muted-foreground">{fmtQty(p.reorderLevel)}</span> },
    { header: "Suggested order", className: "text-right", cell: (p) => <span className="font-medium tabular-nums">{fmtQty(p.suggestedQty)} {p.unit}</span> },
    { header: "Supplier", cell: (p) => p.supplierName ?? <span className="text-muted-foreground">-</span> },
    {
      header: "",
      cell: (p) => canReceive ? (
        <Button variant="outline" size="sm" className="h-11 md:h-8" asChild onClick={(e) => e.stopPropagation()}><Link href={receiveHref([p])}><Truck />Receive stock</Link></Button>
      ) : null,
    },
  ];

  return (
    <>
      <PageHeader title="Low stock" desc="Products at or below their reorder level."
        actions={canReceive && sorted && sorted.length > 0 ? <Button size="lg" asChild><Link href={receiveHref(sorted)}><Truck />Receive all ({sorted.length})</Link></Button> : undefined} />
      <Panel>
        <DataTable rows={sorted} cols={cols} onRowClick={(p) => router.push(`/apps/inventory/${p._id}`)}
          empty={<EmptyState icon={PackageCheck} title="Nothing is running low" desc="All your stocked products are above their reorder level." />} />
      </Panel>
    </>
  );
}
