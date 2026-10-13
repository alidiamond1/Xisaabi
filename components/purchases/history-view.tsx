"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Download, Plus, Receipt } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Col, DataTable, EmptyState, Money, PageHeader, Panel, Pill, SearchInput, Stat, Toolbar } from "@/components/common";
import { useBiz } from "@/components/guard";
import { Button } from "@/components/ui/button";
import { NativeSelect, RangeBar, useRange } from "@/components/inventory/bits";
import { formatCents } from "@/convex/shared/money";
import { downloadCsv } from "@/lib/csv";
import { fmtDateTime } from "@/lib/session";
import { PurchaseDrawer, methodLabel, type PurchaseView } from "./shared";

type Row = FunctionReturnType<typeof api.purchases.list>[number];

export function HistoryView() {
  const cur = useBiz().business.currency;
  const range = useRange("30d");
  const [supplier, setSupplier] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<PurchaseView | null>(null);
  const suppliers = useQuery(api.suppliers.list, {});
  const rows = useQuery(api.purchases.list, { from: range.fromMs, to: range.toMs, supplierId: supplier ? (supplier as Id<"suppliers">) : undefined });
  const needle = q.trim().toLowerCase();
  const shown = rows?.filter((p) => !needle || String(p.number) === needle.replace("#", "") || p.supplierName.toLowerCase().includes(needle) || p.items.some((i) => i.name.toLowerCase().includes(needle)));
  const spent = shown?.reduce((s, p) => s + p.totalCents, 0) ?? 0;
  const owed = shown?.reduce((s, p) => s + (p.totalCents - p.paidCents), 0) ?? 0;

  const cols: Col<Row>[] = [
    { header: "No.", cell: (p) => <span className="font-medium tabular-nums">#{p.number}</span> },
    { header: "Date", cell: (p) => <span className="whitespace-nowrap text-muted-foreground">{fmtDateTime(p.createdAt)}</span> },
    { header: "Supplier", cell: (p) => p.supplierName || <span className="text-muted-foreground">No supplier</span> },
    { header: "Items", className: "text-right", cell: (p) => <span className="tabular-nums">{p.items.length}</span> },
    { header: "Total", className: "text-right", cell: (p) => <span className="font-medium tabular-nums">{formatCents(p.totalCents, cur)}</span> },
    { header: "Paid", className: "text-right", cell: (p) => <Money>{formatCents(p.paidCents, cur)}{p.paidMethod && <span className="ml-1 text-xs text-muted-foreground">{methodLabel(p.paidMethod)}</span>}</Money> },
    { header: "Status", cell: (p) => p.totalCents - p.paidCents > 0 ? <Pill tone="amber">Owing {formatCents(p.totalCents - p.paidCents, cur)}</Pill> : <Pill tone="green">Paid</Pill> },
  ];

  return (
    <>
      <PageHeader title="Purchases" desc="Stock you received from suppliers." actions={<Button size="lg" asChild><Link href="/apps/purchases?view=receive"><Plus />Receive stock</Link></Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Purchases" value={shown?.length ?? "-"} sub="in this period" />
        <Stat label="Total bought" value={shown ? formatCents(spent, cur) : "-"} />
        <Stat label="Still owed" value={shown ? formatCents(owed, cur) : "-"} tone={owed > 0 ? "text-danger" : undefined} sub="from these purchases" />
      </div>
      <Panel>
        <Toolbar actions={
          <Button variant="outline" disabled={!shown?.length} onClick={() => shown && downloadCsv("purchases.csv", [["No", "Date", "Supplier", "Items", "Total", "Paid", "Method", "Note"], ...shown.map((p) => [p.number, new Date(p.createdAt).toISOString(), p.supplierName, p.items.length, (p.totalCents / 100).toFixed(2), (p.paidCents / 100).toFixed(2), p.paidMethod, p.note])])}>
            <Download /><span className="hidden sm:inline">Export CSV</span>
          </Button>
        }>
          <SearchInput value={q} onChange={setQ} placeholder="Search purchases" />
          <RangeBar r={range} />
          <NativeSelect aria-label="Supplier" className="w-auto max-w-48" value={supplier} onChange={setSupplier} placeholder="All suppliers" options={(suppliers ?? []).map((s) => ({ value: s._id, label: s.name }))} />
        </Toolbar>
        <DataTable rows={shown} cols={cols} onRowClick={(p) => setOpen(p)}
          empty={<EmptyState icon={Receipt} title="No purchases in this period" desc="Receive stock from a supplier and it will be listed here." action={<Button asChild><Link href="/apps/purchases?view=receive"><Plus />Receive stock</Link></Button>} />} />
      </Panel>
      <PurchaseDrawer p={open} cur={cur} onClose={() => setOpen(null)} />
    </>
  );
}
