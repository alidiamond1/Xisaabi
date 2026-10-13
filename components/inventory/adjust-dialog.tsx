"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { Minus, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Field, SubmitButton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { act } from "@/lib/run";
import { NativeSelect, REASONS, Segmented, expiryMs, fmtQty, parseQty, type Reason } from "./bits";

export type AdjustTarget = { _id: Id<"products">; name: string; variantLabel?: string; unit: string; allowDecimal: boolean; trackExpiry: boolean; stock: number };

export function AdjustStockDialog({ product, onClose }: { product: AdjustTarget | null; onClose: () => void }) {
  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{product && <Body key={product._id} p={product} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function Body({ p, onClose }: { p: AdjustTarget; onClose: () => void }) {
  const adjust = useMutation(api.inventory.adjust);
  const [dir, setDir] = useState<"up" | "down">("up");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<Reason>("FOUND");
  const [note, setNote] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [expiry, setExpiry] = useState("");
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const n = parseQty(qty);
  const after = n === null ? null : p.stock + (dir === "up" ? n : -n);

  async function submit() {
    const e: Record<string, string> = {};
    if (n === null || n <= 0) e.qty = "Enter a quantity above 0.";
    else if (!p.allowDecimal && !Number.isInteger(n)) e.qty = `${p.name} is counted in whole ${p.unit}.`;
    else if (dir === "down" && n > p.stock) e.qty = `You only have ${fmtQty(p.stock)} ${p.unit}.`;
    if (dir === "up" && p.trackExpiry && !expiry) e.expiry = "This product tracks expiry. Enter the expiry date.";
    if (reason === "OTHER" && !note.trim()) e.note = "Add a short note for Other.";
    setErr(e);
    if (Object.keys(e).length || n === null) return;
    setBusy(true);
    const ok = await act(adjust({
      productId: p._id, delta: dir === "up" ? n : -n, reason, note: note.trim() || undefined,
      batch: dir === "up" && p.trackExpiry ? { batchNo: batchNo.trim() || "ADJ", expiryDate: expiryMs(expiry) } : undefined,
    }), "Stock updated");
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Adjust stock</DialogTitle>
        <DialogDescription>{p.name}{p.variantLabel && ` (${p.variantLabel})`} · now {fmtQty(p.stock)} {p.unit}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <Segmented label="Direction" value={dir} onChange={(d) => { setDir(d); setReason(d === "up" ? "FOUND" : "DAMAGED"); }}
          options={[{ value: "up", label: "Add stock", icon: <Plus className="size-4" /> }, { value: "down", label: "Remove stock", icon: <Minus className="size-4" /> }]} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Quantity (${p.unit})`} required error={err.qty}>
            <Input inputMode={p.allowDecimal ? "decimal" : "numeric"} value={qty} onChange={(e) => setQty(e.target.value)} className="tabular-nums" autoFocus aria-invalid={!!err.qty} />
          </Field>
          <Field label="Reason" required>
            <NativeSelect value={reason} onChange={(v) => setReason(v as Reason)} options={REASONS.map((r) => ({ value: r.value, label: r.label }))} />
          </Field>
        </div>
        {dir === "up" && p.trackExpiry && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Batch no" hint="Optional"><Input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} /></Field>
            <Field label="Expiry date" required error={err.expiry}><Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-invalid={!!err.expiry} /></Field>
          </div>
        )}
        <Field label="Note" error={err.note} hint="Optional"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {after !== null && (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">New stock will be <b className="tabular-nums">{fmtQty(after)} {p.unit}</b></p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <SubmitButton busy={busy} onClick={submit}>Save adjustment</SubmitButton>
      </DialogFooter>
    </>
  );
}
