"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Field, SubmitButton } from "@/components/common";
import { useBiz } from "@/components/guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { parseToCents } from "@/convex/shared/money";
import { run } from "@/lib/run";
import { MoneyInput } from "@/components/inventory/bits";

/** Create (no `supplier`) or edit a supplier in a side sheet. */
export function SupplierSheet({ open, onOpenChange, supplier, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; supplier?: Doc<"suppliers">; onSaved?: (id: string) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">{open && <Body key={supplier?._id ?? "new"} supplier={supplier} close={() => onOpenChange(false)} onSaved={onSaved} />}</SheetContent>
    </Sheet>
  );
}

function Body({ supplier, close, onSaved }: { supplier?: Doc<"suppliers">; close: () => void; onSaved?: (id: string) => void }) {
  const cur = useBiz().business.currency;
  const create = useMutation(api.suppliers.create);
  const update = useMutation(api.suppliers.update);
  const [f, setF] = useState({
    name: supplier?.name ?? "", company: supplier?.company ?? "", phone: supplier?.phone ?? "", whatsapp: supplier?.whatsapp ?? "",
    address: supplier?.address ?? "", notes: supplier?.notes ?? "", opening: "",
  });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));

  async function save() {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = "Enter the supplier's name.";
    const opening = f.opening.trim() ? parseToCents(f.opening) : 0;
    if (opening === null) e.opening = "Enter an amount like 120.50.";
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const info = { name: f.name.trim(), company: f.company.trim(), phone: f.phone.trim(), whatsapp: f.whatsapp.trim(), address: f.address.trim(), notes: f.notes.trim() };
    const id = supplier
      ? await run(update({ supplierId: supplier._id, ...info }).then(() => supplier._id), "Supplier saved")
      : await run(create({ ...info, openingBalanceCents: opening ?? 0 }), "Supplier added");
    setBusy(false);
    if (id) { onSaved?.(id); close(); }
  }

  return (
    <>
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="font-display text-lg">{supplier ? "Edit supplier" : "New supplier"}</SheetTitle>
        <SheetDescription>{supplier ? "Update contact details." : "Who you buy stock from."}</SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-4 overflow-y-auto px-4">
        <Field label="Name" required error={err.name}><Input value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus aria-invalid={!!err.name} /></Field>
        <Field label="Company" hint="Optional"><Input value={f.company} onChange={(e) => set({ company: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone"><Input type="tel" inputMode="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label="WhatsApp" hint="With country code"><Input type="tel" inputMode="tel" value={f.whatsapp} onChange={(e) => set({ whatsapp: e.target.value })} /></Field>
        </div>
        <Field label="Address"><Input value={f.address} onChange={(e) => set({ address: e.target.value })} /></Field>
        {!supplier && (
          <Field label="Balance you already owe them" error={err.opening} hint="Optional. Leave empty if you owe nothing."><MoneyInput cur={cur} value={f.opening} onChange={(opening) => set({ opening })} placeholder="0.00" aria-invalid={!!err.opening} /></Field>
        )}
        <Field label="Notes"><Textarea rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
      <SheetFooter className="border-t sm:flex-row sm:justify-end">
        <Button variant="outline" size="lg" onClick={close}>Cancel</Button>
        <SubmitButton size="lg" busy={busy} onClick={save}>{supplier ? "Save changes" : "Add supplier"}</SubmitButton>
      </SheetFooter>
    </>
  );
}
