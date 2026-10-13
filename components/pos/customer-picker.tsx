"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Plus, UserPlus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Field, Pill, SearchInput, SubmitButton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/convex/shared/money";
import type { CartCustomer } from "@/lib/cart";
import { run } from "@/lib/run";

type Row = {
  _id: CartCustomer["id"]; fullName: string; phone: string; group: CartCustomer["group"];
  balanceCents: number; creditLimitCents: number; creditBlocked: boolean;
};
export const toCartCustomer = (c: Row): CartCustomer => ({
  id: c._id, name: c.fullName, phone: c.phone, group: c.group, balanceCents: c.balanceCents,
  creditLimitCents: c.creditLimitCents, creditBlocked: c.creditBlocked,
});

/** Search a customer or add a new one in two taps (name + phone). */
export function CustomerPicker({ open, onClose, onPick, currency }: {
  open: boolean; onClose: () => void; onPick: (c: CartCustomer) => void; currency: string;
}) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const list = useQuery(api.customers.list, open ? { search: q.trim() || undefined } : "skip");
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setAdding(false); setQ(""); onClose(); } }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{adding ? "New customer" : "Choose customer"}</DialogTitle></DialogHeader>
        {adding ? (
          <QuickAdd defaultName={q} onBack={() => setAdding(false)} onDone={(c) => { setAdding(false); setQ(""); onPick(c); }} />
        ) : (
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Search name or phone" className="sm:w-full" />
            <div className="max-h-[50dvh] divide-y overflow-y-auto rounded-lg border">
              {list === undefined ? <Skeleton className="m-3 h-24" />
                : list.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No customer found.</p>
                : list.slice(0, 40).map((c) => (
                  <button key={c._id} type="button" onClick={() => onPick(toCartCustomer(c))}
                    className="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted active:bg-muted">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{c.fullName}</span>
                      <span className="block text-xs text-muted-foreground">{c.phone || "No phone"}{c.group !== "RETAIL" && ` · ${c.group.toLowerCase()}`}</span>
                    </span>
                    <span className="shrink-0 text-right text-xs tabular-nums">
                      {c.creditBlocked && <Pill tone="red">Blocked</Pill>}
                      {c.balanceCents > 0 && <span className="block font-medium text-danger">owes {formatCents(c.balanceCents, currency)}</span>}
                      {c.balanceCents < 0 && <span className="block font-medium text-success">credit {formatCents(-c.balanceCents, currency)}</span>}
                    </span>
                  </button>
                ))}
            </div>
            <Button size="lg" variant="outline" onClick={() => setAdding(true)}><UserPlus /> New customer</Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuickAdd({ defaultName, onBack, onDone }: { defaultName: string; onBack: () => void; onDone: (c: CartCustomer) => void }) {
  const create = useMutation(api.customers.create);
  const [name, setName] = useState(/\d/.test(defaultName) ? "" : defaultName);
  const [phone, setPhone] = useState(/\d/.test(defaultName) ? defaultName : "");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    const id = await run(create({
      fullName: name, phone, whatsapp: "", type: "INDIVIDUAL", companyName: "", group: "RETAIL",
      address: "", district: "", notes: "", creditLimitCents: 0, openingBalanceCents: 0,
    }), "Customer added");
    setBusy(false);
    if (id) onDone({ id, name: name.trim(), phone: phone.trim(), group: "RETAIL", balanceCents: 0, creditLimitCents: 0, creditBlocked: false });
  }
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} className="h-11" autoFocus maxLength={100} /></Field>
      <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-11" inputMode="tel" maxLength={30} /></Field>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="lg" className="flex-1" onClick={onBack}>Back</Button>
        <SubmitButton type="submit" size="lg" className="flex-1" busy={busy} disabled={!name.trim()}><Plus /> Add and use</SubmitButton>
      </div>
    </form>
  );
}

