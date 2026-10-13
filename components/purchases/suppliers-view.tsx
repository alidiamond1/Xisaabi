"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Plus, Users } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Col, DataTable, EmptyState, FilterChips, Money, PageHeader, Panel, SearchInput, Stat, Toolbar } from "@/components/common";
import { useBiz } from "@/components/guard";
import { Button } from "@/components/ui/button";
import { useDebounced } from "@/components/inventory/bits";
import { formatCents } from "@/convex/shared/money";
import { SupplierSheet } from "./supplier-form";

type Row = FunctionReturnType<typeof api.suppliers.list>[number];

export function SuppliersView() {
  const cur = useBiz().business.currency;
  const router = useRouter();
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim());
  const [owing, setOwing] = useState<"all" | "owing">("all");
  const [adding, setAdding] = useState(false);
  const rows = useQuery(api.suppliers.list, { search: search || undefined, withBalance: owing === "owing" || undefined });
  const all = useQuery(api.suppliers.list, {});
  const totalOwed = all?.reduce((s, x) => s + Math.max(0, x.balanceCents), 0);

  const cols: Col<Row>[] = [
    { header: "Supplier", cell: (s) => <div className="min-w-0"><p className="truncate font-medium">{s.name}</p>{s.company && <p className="truncate text-xs text-muted-foreground">{s.company}</p>}</div> },
    { header: "Phone", cell: (s) => <span className="tabular-nums text-muted-foreground">{s.phone || s.whatsapp || "-"}</span> },
    { header: "You owe", className: "text-right", cell: (s) => s.balanceCents > 0 ? <Money tone="out" className="font-semibold">{formatCents(s.balanceCents, cur)}</Money> : s.balanceCents < 0 ? <Money tone="in">{formatCents(-s.balanceCents, cur)} credit</Money> : <span className="text-muted-foreground">Nothing</span> },
  ];

  return (
    <>
      <PageHeader title="Suppliers" desc="The people you buy stock from, and what you owe them." actions={<Button size="lg" onClick={() => setAdding(true)}><Plus />New supplier</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-lg">
        <Stat label="Suppliers" value={all?.length ?? "-"} />
        <Stat label="Total you owe" value={totalOwed === undefined ? "-" : formatCents(totalOwed, cur)} tone={totalOwed ? "text-danger" : undefined} />
      </div>
      <Panel>
        <Toolbar>
          <SearchInput value={q} onChange={setQ} placeholder="Search suppliers" />
          <FilterChips value={owing} onChange={setOwing} options={[{ value: "all", label: "All" }, { value: "owing", label: "I owe them" }]} />
        </Toolbar>
        <DataTable rows={rows} cols={cols} onRowClick={(s) => router.push(`/apps/purchases/suppliers/${s._id}`)}
          empty={search || owing === "owing" ? (
            <EmptyState icon={Users} title="No suppliers match" desc="Try another name or show all suppliers." action={<Button variant="outline" onClick={() => { setQ(""); setOwing("all"); }}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={Users} title="No suppliers yet" desc="Add a supplier to track purchases and what you owe." action={<Button size="lg" onClick={() => setAdding(true)}><Plus />New supplier</Button>} />
          )} />
      </Panel>
      <SupplierSheet open={adding} onOpenChange={setAdding} onSaved={(id) => router.push(`/apps/purchases/suppliers/${id}`)} />
    </>
  );
}
