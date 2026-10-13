"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Archive, Banknote, History, MessageCircle, Minus, Pencil, Plus, Receipt } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Col, ConfirmDialog, DataTable, DetailLayout, EmptyState, Field, KeyValue, ListSkeleton, Money, PageHeader, Panel, Pill, SubmitButton } from "@/components/common";
import { useBiz } from "@/components/guard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { MoneyInput, NativeSelect } from "@/components/inventory/bits";
import { formatCents, parseToCents } from "@/convex/shared/money";
import { act } from "@/lib/run";
import { fmtDate, fmtDateTime } from "@/lib/session";
import { PAY_METHODS, PurchaseDrawer, methodLabel, type PayMethod, type PurchaseView } from "./shared";
import { SupplierSheet } from "./supplier-form";

type Detail = NonNullable<FunctionReturnType<typeof api.suppliers.get>>;
type Entry = Detail["ledger"][number];

const LEDGER: Record<Entry["type"], { label: string; up: boolean }> = {
  OPENING: { label: "Opening balance", up: true }, PURCHASE: { label: "Purchase on credit", up: true }, PAYMENT: { label: "Payment", up: false },
  ADJUST_UP: { label: "Increase", up: true }, ADJUST_DOWN: { label: "Decrease", up: false },
};

export function SupplierDetail({ id }: { id: Id<"suppliers"> }) {
  const d = useQuery(api.suppliers.get, { supplierId: id });
  if (d === undefined) return <div className="space-y-4"><Skeleton className="h-16 w-full max-w-md" /><div className="grid gap-4 lg:grid-cols-[1fr_320px]"><Panel><ListSkeleton rows={6} /></Panel><Skeleton className="h-48 rounded-xl" /></div></div>;
  return <Loaded d={d} />;
}

function Loaded({ d }: { d: Detail }) {
  const me = useBiz();
  const router = useRouter();
  const cur = me.business.currency;
  const s = d.supplier;
  const archive = useMutation(api.suppliers.archive);
  const [pay, setPay] = useState(false);
  const [adj, setAdj] = useState<"UP" | "DOWN" | null>(null);
  const [edit, setEdit] = useState(false);
  const [arch, setArch] = useState(false);
  const [open, setOpen] = useState<PurchaseView | null>(null);

  const wa = (s.whatsapp || s.phone).replace(/\D/g, "");
  const msg = s.balanceCents > 0
    ? `Hello ${s.name}, this is ${me.business.name}. Our records show we owe you ${formatCents(s.balanceCents, cur)}. Please confirm your balance.`
    : `Hello ${s.name}, this is ${me.business.name}.`;

  const ledgerCols: Col<Entry & { _id: string }>[] = [
    { header: "Date", cell: (e) => <span className="whitespace-nowrap text-muted-foreground">{fmtDateTime(e.createdAt)}</span> },
    { header: "What", cell: (e) => <div><p className="font-medium">{LEDGER[e.type].label}{e.method && ` · ${methodLabel(e.method)}`}</p>{(e.note || e.reference) && <p className="text-xs text-muted-foreground">{[e.reference, e.note].filter(Boolean).join(" · ")}</p>}</div> },
    { header: "Amount", className: "text-right", cell: (e) => <Money tone={LEDGER[e.type].up ? "out" : "in"} className="font-medium">{LEDGER[e.type].up ? "+" : "-"}{formatCents(e.amountCents, cur)}</Money> },
    { header: "You owe after", className: "text-right", cell: (e) => <span className="tabular-nums">{formatCents(e.balanceAfterCents, cur)}</span> },
  ];

  return (
    <>
      <PageHeader title={s.name} back={{ href: "/apps/purchases?view=suppliers", label: "Suppliers" }} desc={s.company || undefined}
        meta={s.isArchived ? <Pill tone="slate">Archived</Pill> : undefined}
        actions={s.isArchived ? <Button size="lg" onClick={() => act(archive({ supplierId: s._id, archived: false }), "Supplier restored")}>Restore</Button> : (
          <>
            <Button size="lg" disabled={s.balanceCents <= 0} onClick={() => setPay(true)}><Banknote />Pay supplier</Button>
            <Button size="lg" variant="outline" onClick={() => setAdj("UP")}><Plus />Increase</Button>
            <Button size="lg" variant="outline" onClick={() => setAdj("DOWN")}><Minus />Decrease</Button>
            <Button size="lg" variant="outline" disabled={!wa} onClick={() => window.open(`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`, "_blank", "noopener")}><MessageCircle />WhatsApp</Button>
          </>
        )} />
      <DetailLayout
        main={
          <Tabs defaultValue="ledger" className="gap-4">
            <TabsList variant="line" className="h-auto w-full justify-start overflow-x-auto border-b">
              <TabsTrigger value="ledger" className="h-11 flex-none px-3">Ledger</TabsTrigger>
              <TabsTrigger value="purchases" className="h-11 flex-none px-3">Purchases</TabsTrigger>
              <TabsTrigger value="info" className="h-11 flex-none px-3">Info</TabsTrigger>
            </TabsList>
            <TabsContent value="ledger">
              <Panel><DataTable rows={d.ledger} cols={ledgerCols} empty={<EmptyState icon={History} title="No activity yet" desc="Purchases on credit, payments and adjustments will show here." />} /></Panel>
            </TabsContent>
            <TabsContent value="purchases">
              <Panel>
                <DataTable rows={d.purchases} onRowClick={(p) => setOpen(p)}
                  cols={[
                    { header: "No.", cell: (p) => <span className="font-medium tabular-nums">#{p.number}</span> },
                    { header: "Date", cell: (p) => <span className="text-muted-foreground">{fmtDate(p.createdAt)}</span> },
                    { header: "Items", className: "text-right", cell: (p) => <span className="tabular-nums">{p.items.length}</span> },
                    { header: "Total", className: "text-right", cell: (p) => <span className="font-medium tabular-nums">{formatCents(p.totalCents, cur)}</span> },
                    { header: "Owing", className: "text-right", cell: (p) => p.totalCents - p.paidCents > 0 ? <Money tone="out">{formatCents(p.totalCents - p.paidCents, cur)}</Money> : <Pill tone="green">Paid</Pill> },
                  ] satisfies Col<Detail["purchases"][number]>[]}
                  empty={<EmptyState icon={Receipt} title="No purchases from this supplier" desc="Choose this supplier when you receive stock." />} />
              </Panel>
            </TabsContent>
            <TabsContent value="info">
              <Panel>
                <KeyValue items={[
                  { label: "Company", value: s.company || "-" }, { label: "Phone", value: s.phone || "-" }, { label: "WhatsApp", value: s.whatsapp || "-" },
                  { label: "Address", value: s.address || "-" }, { label: "Notes", value: s.notes || "-" }, { label: "Added", value: fmtDate(s.createdAt) },
                ]} />
                <div className="flex flex-wrap gap-2 border-t p-4">
                  <Button variant="outline" size="lg" onClick={() => setEdit(true)}><Pencil />Edit</Button>
                  <Button variant="outline" size="lg" onClick={() => setArch(true)}><Archive />Archive</Button>
                </div>
              </Panel>
            </TabsContent>
          </Tabs>
        }
        side={
          <Panel className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.balanceCents < 0 ? "Supplier owes you" : "You owe"}</p>
            <p className={`mt-1 font-display text-4xl font-semibold tabular-nums tracking-tight ${s.balanceCents > 0 ? "text-danger" : s.balanceCents < 0 ? "text-success" : ""}`}>{formatCents(Math.abs(s.balanceCents), cur)}</p>
            <p className="mt-1 text-sm text-muted-foreground">{s.balanceCents === 0 ? "All settled." : s.balanceCents > 0 ? "Pay it from the button above." : "You have paid more than you owed."}</p>
          </Panel>
        }
      />
      <PayDialog open={pay} onOpenChange={setPay} s={s} cur={cur} />
      <AdjustDialog dir={adj} onClose={() => setAdj(null)} s={s} cur={cur} />
      <SupplierSheet open={edit} onOpenChange={setEdit} supplier={s} />
      <ConfirmDialog open={arch} onOpenChange={setArch} title={`Archive ${s.name}?`} desc="They will be hidden from lists and pickers. Their history stays and you can restore them later."
        confirmLabel="Archive" onConfirm={async () => { if (await act(archive({ supplierId: s._id, archived: true }), "Supplier archived")) router.push("/apps/purchases?view=suppliers"); }} />
      <PurchaseDrawer p={open} cur={cur} onClose={() => setOpen(null)} />
    </>
  );
}

function PayDialog({ open, onOpenChange, s, cur }: { open: boolean; onOpenChange: (o: boolean) => void; s: Doc<"suppliers">; cur: string }) {
  const pay = useMutation(api.suppliers.pay);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayMethod>("CASH");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const c = parseToCents(amount);
    if (c === null || c <= 0) return setErr("Enter an amount like 50.00.");
    if (c > s.balanceCents) return setErr(`You only owe ${formatCents(s.balanceCents, cur)}.`);
    setErr(""); setBusy(true);
    const ok = await act(pay({ supplierId: s._id, amountCents: c, method, reference: ref.trim() || undefined, note: note.trim() || undefined }), "Payment recorded");
    setBusy(false);
    if (ok) { onOpenChange(false); setAmount(""); setRef(""); setNote(""); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Pay {s.name}</DialogTitle><DialogDescription>You owe {formatCents(s.balanceCents, cur)}.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <Field label="Amount" required error={err}>
            <MoneyInput cur={cur} value={amount} onChange={setAmount} placeholder="0.00" autoFocus aria-invalid={!!err} />
          </Field>
          <Button type="button" variant="outline" size="sm" onClick={() => setAmount((s.balanceCents / 100).toFixed(2))}>Pay everything ({formatCents(s.balanceCents, cur)})</Button>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Paid with"><NativeSelect value={method} onChange={(v) => setMethod(v as PayMethod)} options={PAY_METHODS.map((m) => ({ value: m.value, label: m.label }))} /></Field>
            <Field label="Reference" hint="Optional, e.g. EVC code"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
          </div>
          <Field label="Note" hint="Optional"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><SubmitButton busy={busy} onClick={save}>Record payment</SubmitButton></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ dir, onClose, s, cur }: { dir: "UP" | "DOWN" | null; onClose: () => void; s: Doc<"suppliers">; cur: string }) {
  const adjust = useMutation(api.suppliers.adjust);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<{ amount?: string; note?: string }>({});
  const [busy, setBusy] = useState(false);
  const up = dir === "UP";

  async function save() {
    const c = parseToCents(amount);
    const e: typeof err = {};
    if (c === null || c <= 0) e.amount = "Enter an amount like 50.00.";
    if (!note.trim()) e.note = "Say why, so the history makes sense.";
    setErr(e);
    if (Object.keys(e).length || c === null || !dir) return;
    setBusy(true);
    const ok = await act(adjust({ supplierId: s._id, direction: dir, amountCents: c, note: note.trim() }), "Balance updated");
    setBusy(false);
    if (ok) { onClose(); setAmount(""); setNote(""); }
  }

  return (
    <Dialog open={!!dir} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{up ? "Increase what you owe" : "Decrease what you owe"}</DialogTitle>
          <DialogDescription>{up ? "Use when the supplier is owed more, e.g. a missed invoice." : "Use for returns, discounts or corrections."} Now: {formatCents(s.balanceCents, cur)}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Amount" required error={err.amount}><MoneyInput cur={cur} value={amount} onChange={setAmount} placeholder="0.00" autoFocus aria-invalid={!!err.amount} /></Field>
          <Field label="Reason" required error={err.note}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!err.note} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><SubmitButton busy={busy} onClick={save}>{up ? "Increase balance" : "Decrease balance"}</SubmitButton></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
