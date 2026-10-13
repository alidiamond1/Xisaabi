"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeftRight, Download } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Col, DataTable, EmptyState, PageHeader, Panel, Pill, SearchInput, Toolbar } from "@/components/common";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv";
import { fmtDateTime } from "@/lib/session";
import { MOVE_TYPES, NativeSelect, RangeBar, fmtQty, moveLabel, reasonLabel, signedQty, useRange, type MoveType } from "./bits";

type Move = FunctionReturnType<typeof api.inventory.movements>[number];

/** Signed quantity: green in, red out. Keeps the sign so color is never the only cue. */
export function QtyCell({ qty }: { qty: number }) {
  return <span className={`font-medium tabular-nums ${qty > 0 ? "text-success" : qty < 0 ? "text-danger" : ""}`}>{signedQty(qty)}</span>;
}

export function MovesView() {
  const range = useRange("30d");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const rows = useQuery(api.inventory.movements, { from: range.fromMs, to: range.toMs, type: (type || undefined) as MoveType | undefined });
  const needle = q.trim().toLowerCase();
  const shown = rows?.filter((m) => !needle || m.productName.toLowerCase().includes(needle) || (m.ref ?? "").toLowerCase().includes(needle));

  const cols: Col<Move>[] = [
    { header: "Date", cell: (m) => <span className="whitespace-nowrap text-muted-foreground">{fmtDateTime(m.createdAt)}</span> },
    { header: "Product", cell: (m) => <Link href={`/apps/inventory/${m.productId}`} onClick={(e) => e.stopPropagation()} className="font-medium text-brand-700 hover:underline">{m.productName}</Link> },
    { header: "Type", cell: (m) => <Pill tone={m.type === "SALE" ? "blue" : m.type === "WRITE_OFF" ? "red" : "slate"}>{moveLabel(m.type)}</Pill> },
    { header: "Quantity", className: "text-right", cell: (m) => <QtyCell qty={m.qty} /> },
    { header: "Balance", className: "text-right", cell: (m) => <span className="tabular-nums">{fmtQty(m.balanceAfter)}</span> },
    { header: "Reason", cell: (m) => <span className="text-muted-foreground">{[m.ref, reasonLabel(m.reason), m.note].filter(Boolean).join(" · ") || "-"}</span> },
    { header: "By", cell: (m) => m.memberName },
  ];

  return (
    <>
      <PageHeader title="Stock moves" desc="Every change to your stock, newest first. Shows up to 500 moves." />
      <Panel>
        <Toolbar actions={
          <Button variant="outline" disabled={!shown?.length} onClick={() => shown && downloadCsv("stock-moves.csv", [["Date", "Product", "Type", "Quantity", "Balance", "Reference", "Reason", "Note", "By"], ...shown.map((m) => [new Date(m.createdAt).toISOString(), m.productName, moveLabel(m.type), m.qty, m.balanceAfter, m.ref, reasonLabel(m.reason), m.note, m.memberName])])}>
            <Download /><span className="hidden sm:inline">Export CSV</span>
          </Button>
        }>
          <SearchInput value={q} onChange={setQ} placeholder="Search product or reference" />
          <RangeBar r={range} />
          <NativeSelect aria-label="Move type" className="w-auto" value={type} onChange={setType} placeholder="All types" options={MOVE_TYPES.map((m) => ({ value: m.value, label: m.label }))} />
        </Toolbar>
        <DataTable rows={shown} cols={cols} empty={<EmptyState icon={ArrowLeftRight} title="No stock moves" desc="Nothing moved in this period. Try a wider date range or another type." />} />
      </Panel>
    </>
  );
}
