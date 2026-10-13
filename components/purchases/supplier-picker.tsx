"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Field, SubmitButton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/inventory/bits";
import { run } from "@/lib/run";

/** Supplier select with inline "New" dialog. Only mount when the plan has the purchases module. */
export function SupplierPicker({ value, onChange, placeholder = "No supplier", id }: { value: string; onChange: (v: string) => void; placeholder?: string; id?: string }) {
  const suppliers = useQuery(api.suppliers.list, {});
  const create = useMutation(api.suppliers.create);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", phone: "" });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!f.name.trim()) return;
    setBusy(true);
    const sid: Id<"suppliers"> | undefined = await run(
      create({ name: f.name, company: "", phone: f.phone, whatsapp: f.phone, address: "", notes: "", openingBalanceCents: 0 }), "Supplier added",
    );
    setBusy(false);
    if (sid) { onChange(sid); setOpen(false); setF({ name: "", phone: "" }); }
  }

  return (
    <>
      <div className="flex gap-2">
        <NativeSelect id={id} value={value} onChange={onChange} placeholder={suppliers ? placeholder : "Loading..."}
          options={(suppliers ?? []).map((s) => ({ value: s._id, label: s.company ? `${s.name} (${s.company})` : s.name }))} />
        <Button type="button" variant="outline" size="lg" className="shrink-0" onClick={() => setOpen(true)} aria-label="New supplier"><Plus />New</Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New supplier</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
            <Field label="Phone / WhatsApp" hint="You can add more details later."><Input type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton busy={busy} disabled={!f.name.trim()} onClick={save}>Add supplier</SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
