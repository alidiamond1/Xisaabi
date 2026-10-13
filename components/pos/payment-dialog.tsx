"use client";
import { useState } from "react";
import { Banknote, CreditCard, Landmark, Plus, Smartphone, Split, Trash2, UserRound } from "lucide-react";
import { Pill, SubmitButton } from "@/components/common";
import { METHOD_LABEL } from "@/components/receipt";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCents, parseToCents } from "@/convex/shared/money";
import type { CartCustomer } from "@/lib/cart";
import type { PayMethod } from "@/lib/outbox";
import { cn } from "@/lib/utils";

export type PayRow = { method: PayMethod; amountCents: number; reference?: string };

const ICON: Record<PayMethod, typeof Banknote> = { CASH: Banknote, EVC: Smartphone, ZAAD: Smartphone, EDAHAB: Smartphone, BANK: Landmark, CREDIT: CreditCard };
const needsRef = (m: PayMethod) => m !== "CASH" && m !== "CREDIT";
type Row = { id: number; method: PayMethod; amount: string; ref: string };

/**
 * Take payment. One tap picks a method (fast path); "Split payment" lets the cashier mix methods.
 * A blank amount on a single row means "exactly the total".
 */
export function PaymentDialog({ open, onClose, totalCents, currency, methods, customer, online, onPickCustomer, onConfirm }: {
  open: boolean; onClose: () => void; totalCents: number; currency: string; methods: PayMethod[];
  customer?: CartCustomer; online: boolean; onPickCustomer: () => void; onConfirm: (p: PayRow[]) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-lg">
        {open && <Body totalCents={totalCents} currency={currency} methods={methods} customer={customer} online={online}
          onPickCustomer={onPickCustomer} onConfirm={onConfirm} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

let seq = 1;

function Body({ totalCents, currency, methods, customer, online, onPickCustomer, onConfirm, onClose }: {
  totalCents: number; currency: string; methods: PayMethod[]; customer?: CartCustomer; online: boolean;
  onPickCustomer: () => void; onConfirm: (p: PayRow[]) => Promise<void>; onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([{ id: seq++, method: "CASH", amount: "", ref: "" }]);
  const [split, setSplit] = useState(false);
  const [busy, setBusy] = useState(false);
  const m = (c: number) => formatCents(c, currency);

  // amounts: "" -> total when it is the only row, else 0; invalid text -> null
  const amounts = rows.map((r) => (r.amount.trim() === "" ? (rows.length === 1 ? totalCents : 0) : parseToCents(r.amount)));
  const bad = amounts.some((a) => a === null);
  const eff = amounts.map((a) => a ?? 0);
  const paid = eff.reduce((n, a) => n + a, 0);
  const nonCash = rows.reduce((n, r, i) => (r.method === "CASH" ? n : n + eff[i]), 0);
  const credit = rows.reduce((n, r, i) => (r.method === "CREDIT" ? n + eff[i] : n), 0);
  const change = Math.max(paid - totalCents, 0);
  const short = Math.max(totalCents - paid, 0);
  const hasCash = rows.some((r) => r.method === "CASH");

  let problem: string | null = null;
  if (bad) problem = "One of the amounts is not valid.";
  else if (nonCash > totalCents) problem = "Mobile, bank or credit amounts cannot be more than the total.";
  else if (paid > totalCents && !hasCash) problem = "Overpaying is only possible with cash.";
  else if (credit > 0 && !customer) problem = "Choose a customer for credit.";
  else if (credit > 0 && !online) problem = "Credit sales need an internet connection.";
  else if (credit > 0 && customer?.creditBlocked) problem = "Credit is blocked for this customer.";
  else if (credit > 0 && customer && customer.balanceCents + credit > customer.creditLimitCents)
    problem = customer.creditLimitCents === 0 ? "This customer has no credit limit." : `Over the credit limit of ${m(customer.creditLimitCents)}.`;
  const canPay = !problem && short === 0 && totalCents > 0;

  const upd = (id: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const pickSingle = (method: PayMethod) => setRows((rs) => [{ ...rs[0], method, amount: method === "CASH" ? rs[0].amount : "" }]);
  const cashRow = rows.find((r) => r.method === "CASH");
  const otherPaid = rows.reduce((n, r, i) => (r === cashRow ? n : n + eff[i]), 0);
  const cashDue = Math.max(totalCents - otherPaid, 0);
  const quick = Array.from(new Set([cashDue, ...[500, 1000, 2000, 5000, 10000].map((n) => Math.ceil(cashDue / n) * n)])).filter((c) => c > 0).slice(0, 4);

  const addRow = (method: PayMethod) => setRows((rs) => [...rs, { id: seq++, method, amount: "", ref: "" }]);
  const free = methods.filter((x) => !rows.some((r) => r.method === x));

  async function go() {
    if (!canPay) return;
    setBusy(true);
    try {
      await onConfirm(rows.map((r, i) => ({ method: r.method, amountCents: eff[i], reference: needsRef(r.method) ? r.ref.trim() || undefined : undefined })).filter((p) => p.amountCents > 0));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Take payment</DialogTitle>
        <DialogDescription className="font-display text-4xl font-semibold tabular-nums tracking-tight text-foreground">{m(totalCents)}</DialogDescription>
      </DialogHeader>

      {!split ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="Payment method">
            {methods.map((k) => {
              const Icon = ICON[k];
              const dis = k === "CREDIT" && !online;
              return (
                <button key={k} type="button" disabled={dis} onClick={() => pickSingle(k)} aria-pressed={rows[0].method === k}
                  className={cn("flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border-2 p-3 text-sm font-semibold transition-colors disabled:opacity-40",
                    rows[0].method === k ? "border-brand-600 bg-brand-50 text-brand-800" : "border-border bg-card text-muted-foreground hover:bg-muted")}>
                  <Icon className="size-5" />{METHOD_LABEL[k]}
                </button>
              );
            })}
          </div>
          {rows[0].method === "CASH" && (
            <div className="space-y-2">
              <label className="block text-sm font-medium" htmlFor="tendered">Amount received</label>
              <Input id="tendered" inputMode="decimal" autoFocus placeholder={(totalCents / 100).toFixed(2)} value={rows[0].amount}
                onChange={(e) => upd(rows[0].id, { amount: e.target.value })} className="h-14 text-xl tabular-nums"
                onKeyDown={(e) => e.key === "Enter" && go()} />
              <div className="flex flex-wrap gap-2">
                {quick.map((c) => (
                  <button key={c} type="button" onClick={() => upd(rows[0].id, { amount: (c / 100).toFixed(2) })}
                    className="h-11 rounded-lg border bg-card px-3.5 text-sm font-semibold tabular-nums hover:bg-muted active:bg-muted">{c === cashDue ? "Exact" : m(c)}</button>
                ))}
              </div>
            </div>
          )}
          {needsRef(rows[0].method) && (
            <div className="space-y-2">
              <label className="block text-sm font-medium" htmlFor="ref">Reference (optional)</label>
              <Input id="ref" autoFocus value={rows[0].ref} maxLength={100} placeholder="Confirmation code or last digits" className="h-12"
                onChange={(e) => upd(rows[0].id, { ref: e.target.value })} />
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r, i) => (
            <div key={r.id} className="space-y-2 rounded-xl border bg-card p-2.5">
              <div className="flex items-center gap-2">
                <select value={r.method} aria-label="Payment method" onChange={(e) => upd(r.id, { method: e.target.value as PayMethod })}
                  className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-card px-2 text-base font-medium md:text-sm">
                  {methods.filter((x) => x === r.method || !rows.some((o) => o.method === x)).map((x) => <option key={x} value={x} disabled={x === "CREDIT" && !online}>{METHOD_LABEL[x]}</option>)}
                </select>
                <Input inputMode="decimal" aria-label={`${METHOD_LABEL[r.method]} amount`} placeholder="0.00" value={r.amount} className="h-11 w-24 text-right sm:w-32 tabular-nums"
                  onChange={(e) => upd(r.id, { amount: e.target.value })} />
                <button type="button" aria-label="Remove payment row" disabled={rows.length === 1}
                  className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-danger disabled:opacity-30"
                  onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}><Trash2 className="size-4" /></button>
              </div>
              {needsRef(r.method) && (
                <Input aria-label={`${METHOD_LABEL[r.method]} reference`} placeholder="Reference (optional)" value={r.ref} maxLength={100} className="h-11"
                  onChange={(e) => upd(r.id, { ref: e.target.value })} />
              )}
              {r.method === "CASH" && i === rows.findIndex((x) => x.method === "CASH") && (
                <div className="flex flex-wrap gap-2">
                  {quick.map((c) => (
                    <button key={c} type="button" onClick={() => upd(r.id, { amount: (c / 100).toFixed(2) })}
                      className="h-11 rounded-lg border bg-card px-3 text-sm font-semibold tabular-nums hover:bg-muted">{c === cashDue ? "Exact" : m(c)}</button>
                  ))}
                </div>
              )}
              {short > 0 && i === rows.length - 1 && (
                <button type="button" className="h-9 text-sm font-medium text-brand-700 underline-offset-2 hover:underline"
                  onClick={() => upd(r.id, { amount: ((eff[i] + short) / 100).toFixed(2) })}>Fill the remaining {m(short)}</button>
              )}
            </div>
          ))}
          {free.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {free.map((k) => (
                <Button key={k} type="button" variant="outline" size="lg" disabled={k === "CREDIT" && !online} onClick={() => addRow(k)}><Plus /> {METHOD_LABEL[k]}</Button>
              ))}
            </div>
          )}
        </div>
      )}

      {rows.some((r) => r.method === "CREDIT") && (
        <div className="rounded-xl border bg-muted/40 p-3 text-sm">
          {!online && <p className="mb-2 font-medium text-warning">Credit sales need an internet connection.</p>}
          {customer ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-medium"><UserRound className="size-4" />{customer.name}</span>
                <Button type="button" variant="ghost" size="sm" onClick={onPickCustomer}>Change</Button>
              </div>
              <p className="tabular-nums text-muted-foreground">
                Owes {m(customer.balanceCents)} · Limit {customer.creditLimitCents ? m(customer.creditLimitCents) : "none"} · After this sale {m(customer.balanceCents + credit)}
              </p>
              {customer.creditBlocked && <Pill tone="red">Credit blocked</Pill>}
            </div>
          ) : (
            <Button type="button" size="lg" className="w-full" onClick={onPickCustomer}><UserRound /> Choose customer for credit</Button>
          )}
        </div>
      )}

      {!split && methods.length > 1 && (
        <Button type="button" variant="ghost" size="lg" className="justify-self-start" onClick={() => setSplit(true)}><Split /> Split payment</Button>
      )}

      <div className="rounded-xl bg-muted/50 px-4 py-3" aria-live="polite">
        {change > 0 ? (
          <div className="flex items-baseline justify-between"><span className="text-sm font-medium">Change to give</span><span className="font-display text-3xl font-semibold tabular-nums text-success">{m(change)}</span></div>
        ) : short > 0 ? (
          <div className="flex items-baseline justify-between"><span className="text-sm font-medium">Still to pay</span><span className="font-display text-3xl font-semibold tabular-nums text-danger">{m(short)}</span></div>
        ) : (
          <div className="flex items-baseline justify-between"><span className="text-sm font-medium">{credit > 0 ? "Paid now" : "Paid in full"}</span><span className="font-display text-3xl font-semibold tabular-nums">{m(paid - credit)}</span></div>
        )}
      </div>
      {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}

      <DialogFooter className="sticky -bottom-4 z-10 bg-card flex-row gap-2 sm:gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
        <Button variant="outline" size="xl" onClick={onClose} disabled={busy}>Cancel</Button>
        <SubmitButton busy={busy} disabled={!canPay} onClick={go} size="xl" className="px-8">Confirm sale</SubmitButton>
      </DialogFooter>
    </>
  );
}
