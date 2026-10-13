"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ScanBarcode, ShieldCheck, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Col, DataTable, EmptyState, Field, FilterChips, PageHeader, Panel, Pill, SearchInput, SubmitButton, Toolbar } from "@/components/common";
import { useBiz } from "@/components/guard";
import { SERIAL_STATUS, WarrantyDialog } from "@/components/pos/warranty-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { hasPermission } from "@/convex/shared/permissions";
import { useFeature } from "@/lib/features";
import { act } from "@/lib/run";
import { fmtDate } from "@/lib/session";
import { useDebounced } from "./bits";

type Row = FunctionReturnType<typeof api.serials.list>[number];
type Status = "" | Row["status"];
const FILTERS: { value: Status; label: string }[] = [
  { value: "", label: "All" }, { value: "IN_STOCK", label: "In stock" }, { value: "SOLD", label: "Sold" }, { value: "RETURNED", label: "Returned" }, { value: "WRITTEN_OFF", label: "Written off" },
];

function Warranty({ until }: { until?: number }) {
  if (until === undefined) return <span className="text-muted-foreground">-</span>;
  const active = until >= Date.now();
  return <span className="flex flex-wrap items-center gap-2"><span className="whitespace-nowrap">{fmtDate(until)}</span><Pill tone={active ? "green" : "red"}>{active ? "Active" : "Expired"}</Pill></span>;
}

/** Inventory > Serials: every IMEI / serial number with its status. */
export function SerialsView() {
  const on = useFeature("serials");
  const [check, setCheck] = useState(false);
  return (
    <>
      <PageHeader title="Serials" desc="Every IMEI / serial number, whether it is in stock or sold."
        actions={<Button size="lg" onClick={() => setCheck(true)}><ShieldCheck />Warranty check</Button>} />
      {on ? <SerialsPanel /> : (
        <Panel><EmptyState icon={ScanBarcode} title="IMEI tracking is off" desc="Turn on IMEI / serial numbers in Settings > Features to track each phone or device." /></Panel>
      )}
      <WarrantyDialog open={check} onClose={() => setCheck(false)} />
    </>
  );
}

/** The serial list. With `productId` it is one product's units (product page tab). */
export function SerialsPanel({ productId }: { productId?: Id<"products"> }) {
  const me = useBiz();
  const canWriteOff = hasPermission(me.member, "adjustStock");
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim());
  const [status, setStatus] = useState<Status>("");
  const [look, setLook] = useState<string | null>(null);
  const [off, setOff] = useState<Row | null>(null);
  const rows = useQuery(api.serials.list, { productId, search: search || undefined, status: status || undefined });
  const cols: Col<Row>[] = [
    { header: "IMEI / serial", cell: (s) => <span className="font-mono tabular-nums">{s.serial}</span> },
    ...(productId ? [] : [{ header: "Product", cell: (s: Row) => s.productName }]),
    { header: "Status", cell: (s) => <Pill tone={SERIAL_STATUS[s.status].tone} dot>{SERIAL_STATUS[s.status].label}</Pill> },
    { header: "Sold", cell: (s) => (s.soldAt ? <span className="whitespace-nowrap text-muted-foreground">{fmtDate(s.soldAt)}</span> : <span className="text-muted-foreground">-</span>) },
    { header: "Warranty until", cell: (s) => <Warranty until={s.warrantyUntil} /> },
    {
      header: "",
      cell: (s) => (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={(e) => { e.stopPropagation(); setLook(s.serial); }}><ShieldCheck />Details</Button>
          {canWriteOff && s.status === "IN_STOCK" && (
            <Button variant="outline" size="sm" className="h-11 text-danger md:h-8" onClick={(e) => { e.stopPropagation(); setOff(s); }}><Trash2 />Write off</Button>
          )}
        </div>
      ),
    },
  ];
  const filtered = !!search || !!status;
  return (
    <>
      <Panel>
        <Toolbar>
          <SearchInput value={q} onChange={setQ} placeholder="Search IMEI / serial" />
          <FilterChips options={FILTERS} value={status} onChange={setStatus} />
        </Toolbar>
        <DataTable rows={rows} cols={cols} onRowClick={(s) => setLook(s.serial)}
          empty={filtered ? (
            <EmptyState icon={ScanBarcode} title="No matching numbers" desc="Try fewer digits or clear the filter." action={<Button variant="outline" onClick={() => { setQ(""); setStatus(""); }}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={ScanBarcode} title="No IMEI / serial numbers yet" desc="They appear when you receive stock for a product that tracks serials." />
          )} />
        {rows?.length === 500 && <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">Showing the first 500. Search to narrow it down.</p>}
      </Panel>
      <WarrantyDialog open={look !== null} initial={look ?? ""} onClose={() => setLook(null)} />
      <WriteOffDialog row={off} onClose={() => setOff(null)} />
    </>
  );
}

function WriteOffDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const writeOff = useMutation(api.serials.writeOff);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => { setReason(""); onClose(); };
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Write off this unit?</DialogTitle>
          <DialogDescription>{row?.productName} · <span className="font-mono">{row?.serial}</span>. It leaves your stock for good (lost, stolen or broken).</DialogDescription>
        </DialogHeader>
        <Field label="Reason" required><Input autoFocus value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Dropped and broken" /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <SubmitButton variant="destructive" busy={busy} disabled={!reason.trim()}
            onClick={async () => { if (!row) return; setBusy(true); const ok = await act(writeOff({ serialId: row._id, reason: reason.trim() }), "Written off"); setBusy(false); if (ok) close(); }}>Write off</SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
