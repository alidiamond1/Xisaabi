"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { BadgeCheck, EyeOff, Flag, Pencil, ScanBarcode } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Banner, DataTable, EmptyState, Field, FilterChips, PageHeader, Panel, Pill, SubmitButton, Toolbar, type Col } from "@/components/common";
import { usePlatform } from "@/components/guard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { act } from "@/lib/run";

type Status = "ALL" | "PENDING" | "VERIFIED" | "HIDDEN" | "NOT_FOUND";
type Row = FunctionReturnType<typeof api.catalog.adminList>[number] & { _id: string };

const TABS: { value: Status; label: string }[] = [
  { value: "ALL", label: "All" }, { value: "PENDING", label: "Pending" }, { value: "VERIFIED", label: "Verified" },
  { value: "HIDDEN", label: "Hidden" }, { value: "NOT_FOUND", label: "Not found" },
];
const TONE = { PENDING: "amber", VERIFIED: "green", HIDDEN: "red", NOT_FOUND: "slate" } as const;

export default function CatalogPage() {
  const sup = usePlatform().member.role === "SUPER_ADMIN";
  const [tab, setTab] = useState<Status>("ALL");
  const data = useQuery(api.catalog.adminList, tab === "ALL" ? {} : { status: tab });
  const set = useMutation(api.catalog.adminSet);
  const [edit, setEdit] = useState<Row | null>(null);
  // flagged entries first, then newest
  const rows: Row[] | undefined = data?.map((r) => ({ ...r, _id: r.barcode })).sort((a, b) => b.flagCount - a.flagCount || b.fetchedAt - a.fetchedAt);

  const cols: Col<Row>[] = [
    { header: "Product", cell: (r) => (
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {r.imageUrl ? <img src={r.imageUrl} alt="" referrerPolicy="no-referrer" className="size-full object-contain" loading="lazy" /> : <ScanBarcode className="size-4" />}
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium">{r.name || <span className="text-muted-foreground">(no name)</span>}</p>
          <p className="truncate text-xs text-muted-foreground tabular-nums">{r.barcode}</p>
        </div>
      </div>
    ) },
    { header: "Brand / size", cell: (r) => [r.brand, r.size].filter(Boolean).join(" · ") || <span className="text-muted-foreground">-</span> },
    { header: "Source", cell: (r) => <span className="text-muted-foreground">{r.source === "OPEN_FOOD_FACTS" ? "Open Food Facts" : r.source === "COMMUNITY" ? "Shops" : "Other"}</span> },
    { header: "Shops", className: "text-right", cell: (r) => <span className="tabular-nums">{r.confirmCount}</span> },
    { header: "Flags", className: "text-right", cell: (r) => r.flagCount > 0 ? <Pill tone="red"><Flag className="size-3" />{r.flagCount}</Pill> : <span className="text-muted-foreground">0</span> },
    { header: "Status", cell: (r) => <Pill tone={TONE[r.status]} dot>{r.status === "NOT_FOUND" ? "Not found" : r.status.charAt(0) + r.status.slice(1).toLowerCase()}</Pill> },
    { header: "", cell: (r) => sup && r.status !== "NOT_FOUND" ? (
      <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="outline" className="h-11 md:h-8" onClick={() => setEdit(r)}><Pencil />Edit</Button>
        {r.status !== "VERIFIED" && <Button size="sm" variant="outline" className="h-11 md:h-8" onClick={() => act(set({ barcode: r.barcode, status: "VERIFIED" }), "Verified")}><BadgeCheck />Verify</Button>}
        {r.status !== "HIDDEN" && <Button size="sm" variant="outline" className="h-11 text-danger md:h-8" onClick={() => act(set({ barcode: r.barcode, status: "HIDDEN" }), "Hidden from shops")}><EyeOff />Hide</Button>}
      </div>
    ) : null },
  ];

  return (
    <>
      <PageHeader title="Barcode catalog" desc="Product names shared between shops. Flagged entries are listed first." />
      {!sup && <div className="mb-4"><Banner tone="info">Read-only. Only super admins can verify, hide or edit entries.</Banner></div>}
      <Panel>
        <Toolbar><FilterChips options={TABS} value={tab} onChange={setTab} /></Toolbar>
        <DataTable rows={rows} cols={cols} pageSize={25}
          empty={<EmptyState icon={ScanBarcode} title={tab === "ALL" ? "The catalog is empty" : "No entries here"} desc="Entries appear when shops scan products or save them with a barcode." />} />
      </Panel>
      <EditDialog row={edit} onClose={() => setEdit(null)} />
    </>
  );
}

function EditDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{row && <EditBody key={row.barcode} row={row} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function EditBody({ row, onClose }: { row: Row; onClose: () => void }) {
  const set = useMutation(api.catalog.adminSet);
  const [name, setName] = useState(row.name);
  const [brand, setBrand] = useState(row.brand);
  const [size, setSize] = useState(row.size);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    // keeps the current status; the backend locks the entry so shop contributions stop changing it
    const ok = await act(set({ barcode: row.barcode, status: row.status, name: name.trim(), brand: brand.trim(), size: size.trim() }), "Saved");
    setBusy(false);
    if (ok) onClose();
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="grid gap-4">
      <DialogHeader><DialogTitle className="font-display">Edit catalog entry</DialogTitle><p className="text-xs text-muted-foreground tabular-nums">{row.barcode}</p></DialogHeader>
      <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Brand"><Input value={brand} onChange={(e) => setBrand(e.target.value)} /></Field>
        <Field label="Size"><Input value={size} onChange={(e) => setSize(e.target.value)} /></Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <SubmitButton type="submit" busy={busy} disabled={!name.trim()}>Save</SubmitButton>
      </DialogFooter>
    </form>
  );
}
