"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ConfirmDialog, Field, SubmitButton } from "@/components/common";
import { useBiz } from "@/components/guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { parseToCents } from "@/convex/shared/money";
import { run } from "@/lib/run";
import { cn } from "@/lib/utils";

export type CustomerDoc = FunctionReturnType<typeof api.customers.get>["customer"];
type Group = CustomerDoc["group"];

/** "-5.50" -> -550 (store credit); null when invalid. */
export function parseSigned(s: string): number | null {
  const t = s.trim();
  if (t === "") return 0;
  const neg = t.startsWith("-");
  const c = parseToCents(neg ? t.slice(1) : t);
  return c === null ? null : neg ? -c : c;
}

const selectCls = "h-11 w-full rounded-lg md:h-10 border border-input bg-card px-3 text-base shadow-card md:text-sm";

/** Add / edit a customer. Cashiers never see credit limit, group or opening balance. */
export function CustomerSheet({ value, onClose, onSaved }: { value: CustomerDoc | "new" | null; onClose: () => void; onSaved?: (id: Id<"customers">) => void }) {
  return (
    <Sheet open={!!value} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-lg">
        {value && <Form key={value === "new" ? "new" : value._id} c={value === "new" ? null : value} onClose={onClose} onSaved={onSaved} />}
      </SheetContent>
    </Sheet>
  );
}

function Form({ c, onClose, onSaved }: { c: CustomerDoc | null; onClose: () => void; onSaved?: (id: Id<"customers">) => void }) {
  const me = useBiz();
  const cur = me.business.currency;
  const canRisk = me.member.role !== "CASHIER";
  const create = useMutation(api.customers.create);
  const update = useMutation(api.customers.update);
  const [f, setF] = useState({
    type: (c?.type ?? "INDIVIDUAL") as "INDIVIDUAL" | "COMPANY",
    fullName: c?.fullName ?? "", companyName: c?.companyName ?? "", phone: c?.phone ?? "", whatsapp: c?.whatsapp ?? "",
    address: c?.address ?? "", district: c?.district ?? "", notes: c?.notes ?? "",
    group: (c?.group ?? "RETAIL") as Group,
    limit: c ? (c.creditLimitCents / 100).toFixed(2) : (me.business.settings.defaultCreditLimitCents / 100).toFixed(2),
    opening: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [dirty, setDirty] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((s) => ({ ...s, [k]: v })); setDirty(true); };

  async function save() {
    const e: Record<string, string> = {};
    if (!f.fullName.trim()) e.fullName = "Enter a name.";
    if (f.type === "COMPANY" && !f.companyName.trim()) e.companyName = "Enter the company name.";
    const limit = canRisk ? parseToCents(f.limit || "0") : c?.creditLimitCents ?? 0;
    if (limit === null) e.limit = "Enter a valid amount.";
    const opening = canRisk && !c ? parseSigned(f.opening) : 0;
    if (opening === null) e.opening = "Enter a valid amount, e.g. 25.00 or -10.00.";
    setErrors(e);
    if (Object.keys(e).length || limit === null || opening === null) return;
    const base = {
      fullName: f.fullName.trim(), phone: f.phone.trim(), whatsapp: f.whatsapp.trim(), type: f.type, companyName: f.type === "COMPANY" ? f.companyName.trim() : "",
      address: f.address.trim(), district: f.district.trim(), notes: f.notes.trim(),
      group: canRisk ? f.group : c?.group ?? "RETAIL", creditLimitCents: limit,
    };
    setBusy(true);
    const id = c ? await run(update({ customerId: c._id, ...base }).then(() => c._id), "Customer saved")
      : await run(create({ ...base, openingBalanceCents: opening }), "Customer added");
    setBusy(false);
    if (id) { onSaved?.(id); onClose(); }
  }

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle className="font-display text-lg">{c ? "Edit customer" : "New customer"}</SheetTitle>
        <SheetDescription>{c ? c.fullName : "Add someone you sell to, on credit or not."}</SheetDescription>
      </SheetHeader>
      <form className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" onSubmit={(e) => { e.preventDefault(); save(); }} id="customer-form">
        <div role="group" aria-label="Customer type" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
          {([["INDIVIDUAL", "Person"], ["COMPANY", "Company"]] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={f.type === k} onClick={() => set("type", k)}
              className={cn("h-10 rounded-lg text-sm font-semibold", f.type === k ? "bg-card shadow-card" : "text-muted-foreground")}>{l}</button>
          ))}
        </div>
        {f.type === "COMPANY" && <Field label="Company name" required error={errors.companyName}><Input value={f.companyName} onChange={(e) => set("companyName", e.target.value)} maxLength={100} className="h-11" /></Field>}
        <Field label={f.type === "COMPANY" ? "Contact person" : "Full name"} required error={errors.fullName}>
          <Input value={f.fullName} onChange={(e) => set("fullName", e.target.value)} maxLength={100} className="h-11" autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone"><Input inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} maxLength={30} className="h-11" /></Field>
          <Field label="WhatsApp" hint="Leave empty to use the phone number."><Input inputMode="tel" value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} maxLength={30} className="h-11" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="District"><Input value={f.district} onChange={(e) => set("district", e.target.value)} maxLength={100} className="h-11" /></Field>
          <Field label="Address"><Input value={f.address} onChange={(e) => set("address", e.target.value)} maxLength={200} className="h-11" /></Field>
        </div>
        {canRisk && (
          <>
            <Field label="Price group" hint="Wholesale customers get the wholesale price in the POS.">
              <select value={f.group} onChange={(e) => set("group", e.target.value as Group)} className={selectCls}>
                <option value="RETAIL">Retail</option><option value="WHOLESALE">Wholesale</option><option value="VIP">VIP</option>
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Credit limit (${cur})`} hint="0 means no credit." error={errors.limit}>
                <Input inputMode="decimal" value={f.limit} onChange={(e) => set("limit", e.target.value)} className="h-11 tabular-nums" />
              </Field>
              {!c && (
                <Field label={`Opening balance (${cur})`} hint="Positive = they owe you. Negative = store credit." error={errors.opening}>
                  <Input inputMode="decimal" placeholder="0.00" value={f.opening} onChange={(e) => set("opening", e.target.value)} className="h-11 tabular-nums" />
                </Field>
              )}
            </div>
          </>
        )}
        <Field label="Notes"><Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} maxLength={1000} rows={3} /></Field>
      </form>
      <SheetFooter className="border-t pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
        <Button variant="outline" size="lg" onClick={() => (dirty ? setDiscard(true) : onClose())}>Cancel</Button>
        <SubmitButton size="lg" type="submit" form="customer-form" busy={busy}>{c ? "Save changes" : "Add customer"}</SubmitButton>
      </SheetFooter>
      <ConfirmDialog open={discard} onOpenChange={setDiscard} title="Discard changes?" desc="What you typed will be lost." confirmLabel="Discard" onConfirm={onClose} />
    </>
  );
}
