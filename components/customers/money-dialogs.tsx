"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { MessageCircle, Printer } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Field, SubmitButton } from "@/components/common";
import { useBiz } from "@/components/guard";
import { METHOD_LABEL, PrintArea } from "@/components/receipt";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCents, parseToCents } from "@/convex/shared/money";
import { act, run } from "@/lib/run";
import { fmtDateTime } from "@/lib/session";
import { openWhatsApp } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

type PayMethod = "CASH" | "EVC" | "ZAAD" | "EDAHAB" | "BANK";
export type PaymentDone = { customerName: string; phone: string; amountCents: number; method: PayMethod; reference?: string; balanceAfterCents: number; at: number };

/** Take a repayment. Cannot be more than what the customer owes. */
export function TakePaymentDialog({ open, onClose, customer, onDone }: {
  open: boolean; onClose: () => void; customer: { _id: Id<"customers">; fullName: string; phone: string; whatsapp: string; balanceCents: number };
  onDone: (p: PaymentDone) => void;
}) {
  const me = useBiz();
  const cur = me.business.currency;
  const record = useMutation(api.customers.recordPayment);
  const methods = (["CASH", "EVC", "ZAAD", "EDAHAB", "BANK"] as PayMethod[]).filter((x) => x === "CASH" || me.business.settings.paymentMethods.includes(x));
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayMethod>("CASH");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const cents = parseToCents(amount);
  const owed = Math.max(customer.balanceCents, 0);
  const err = amount && cents === null ? "Enter a valid amount." : cents !== null && cents > owed ? `More than they owe (${formatCents(owed, cur)}).` : undefined;
  const ok = !!cents && cents > 0 && !err;

  async function go() {
    if (!ok || !cents) return;
    setBusy(true);
    const r = await run(record({ customerId: customer._id, amountCents: cents, method, reference: ref.trim() || undefined, note: note.trim() || undefined }));
    setBusy(false);
    if (r) {
      onDone({ customerName: customer.fullName, phone: customer.whatsapp || customer.phone, amountCents: cents, method, reference: ref.trim() || undefined, balanceAfterCents: r.balanceAfterCents, at: Date.now() });
      setAmount(""); setRef(""); setNote(""); setMethod("CASH");
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Take payment</DialogTitle>
          <DialogDescription>{customer.fullName} owes <b className="tabular-nums text-danger">{formatCents(owed, cur)}</b></DialogDescription>
        </DialogHeader>
        <Field label="Amount received" error={err}>
          <Input inputMode="decimal" autoFocus placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-14 text-xl tabular-nums" onKeyDown={(e) => e.key === "Enter" && go()} />
        </Field>
        {owed > 0 && <Button type="button" variant="outline" size="lg" className="justify-self-start" onClick={() => setAmount((owed / 100).toFixed(2))}>Pay full {formatCents(owed, cur)}</Button>}
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm font-medium">Paid by</legend>
          <div className="flex flex-wrap gap-2">
            {methods.map((k) => (
              <button key={k} type="button" aria-pressed={method === k} onClick={() => setMethod(k)}
                className={cn("h-11 rounded-lg border px-4 text-sm font-semibold", method === k ? "border-brand-600 bg-brand-50 text-brand-800" : "bg-card text-muted-foreground hover:bg-muted")}>{METHOD_LABEL[k]}</button>
            ))}
          </div>
        </fieldset>
        {method !== "CASH" && <Field label="Reference" hint="Confirmation code or last digits (optional)."><Input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={100} className="h-11" /></Field>}
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="h-11" /></Field>
        <DialogFooter>
          <Button variant="outline" size="lg" onClick={onClose}>Cancel</Button>
          <SubmitButton size="lg" busy={busy} disabled={!ok} onClick={go}>Save payment</SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Printable payment receipt (80mm) shown right after a repayment. */
export function PaymentReceiptDialog({ p, onClose }: { p: PaymentDone | null; onClose: () => void }) {
  const me = useBiz();
  const cur = me.business.currency;
  return (
    <Dialog open={!!p} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-sm overflow-y-auto">
        <DialogHeader><DialogTitle>Payment received</DialogTitle></DialogHeader>
        {p && (
          <>
            <div className="mx-auto overflow-hidden rounded-lg border"><PaymentSlip p={p} /></div>
            <div className="grid grid-cols-2 gap-2">
              <Button size="lg" variant="outline" onClick={() => window.print()}><Printer /> Print</Button>
              <Button size="lg" variant="outline" onClick={() => openWhatsApp(p.phone, `*${me.business.name}*\nPayment received: ${formatCents(p.amountCents, cur)} (${METHOD_LABEL[p.method]})\nBalance now: ${formatCents(p.balanceAfterCents, cur)}\nThank you ${p.customerName}!`)}><MessageCircle /> WhatsApp</Button>
            </div>
            <PrintArea><PaymentSlip p={p} /></PrintArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PaymentSlip({ p }: { p: PaymentDone }) {
  const me = useBiz();
  const m = (c: number) => formatCents(c, me.business.currency);
  const Row = ({ a, b, bold }: { a: string; b: string; bold?: boolean }) => <div className={`flex justify-between gap-2 ${bold ? "font-bold" : ""}`}><span>{a}</span><span className="tabular-nums">{b}</span></div>;
  return (
    <div className="w-[80mm] bg-white p-3 font-mono text-[11px] leading-snug text-black">
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {me.logoUrl && <img src={me.logoUrl} alt="" className="mx-auto mb-1 max-h-14 max-w-[50mm] object-contain grayscale" />}
        <div className="text-sm font-bold">{me.business.name}</div>
        {me.business.phone && <div>{me.business.phone}</div>}
        <div className="mt-1 font-bold">PAYMENT RECEIPT</div>
      </div>
      <hr className="my-2 border-dashed border-black" />
      <Row a="Date" b={fmtDateTime(p.at)} />
      <Row a="Customer" b={p.customerName} />
      <Row a="Received by" b={me.member.fullName} />
      <hr className="my-2 border-dashed border-black" />
      <Row a={`Paid (${METHOD_LABEL[p.method]})`} b={m(p.amountCents)} bold />
      {p.reference && <Row a="Reference" b={p.reference} />}
      <Row a="Balance now" b={p.balanceAfterCents > 0 ? `owes ${m(p.balanceAfterCents)}` : p.balanceAfterCents < 0 ? `credit ${m(-p.balanceAfterCents)}` : "settled"} bold />
      <hr className="my-2 border-dashed border-black" />
      <div className="text-center">Thank you!</div>
    </div>
  );
}

/** Add debt / reduce debt by hand. A reason is required and kept in the ledger. */
export function AdjustDialog({ direction, onClose, customer }: {
  direction: "UP" | "DOWN" | null; onClose: () => void; customer: { _id: Id<"customers">; fullName: string; balanceCents: number };
}) {
  const cur = useBiz().business.currency;
  const adjust = useMutation(api.customers.adjustBalance);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const cents = parseToCents(amount);
  const ok = !!cents && cents > 0 && note.trim().length > 0;
  const up = direction === "UP";
  async function go() {
    if (!direction || !ok || !cents) return;
    setBusy(true);
    const done = await act(adjust({ customerId: customer._id, direction, amountCents: cents, note: note.trim() }), up ? "Debt added" : "Debt reduced");
    setBusy(false);
    if (done) { setAmount(""); setNote(""); onClose(); }
  }
  return (
    <Dialog open={!!direction} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{up ? "Add debt" : "Reduce debt"}</DialogTitle>
          <DialogDescription>
            {up ? "Use this for money the customer owes that is not from a POS sale." : "Use this to correct a mistake or give a discount on the old balance."}{" "}
            Now: {customer.balanceCents > 0 ? `owes ${formatCents(customer.balanceCents, cur)}` : customer.balanceCents < 0 ? `credit ${formatCents(-customer.balanceCents, cur)}` : "no balance"}.
          </DialogDescription>
        </DialogHeader>
        <Field label="Amount"><Input inputMode="decimal" autoFocus placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-14 text-xl tabular-nums" /></Field>
        <Field label="Reason" required hint="Saved in the ledger so everyone can see why."><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="h-11" onKeyDown={(e) => e.key === "Enter" && go()} /></Field>
        <DialogFooter>
          <Button variant="outline" size="lg" onClick={onClose}>Cancel</Button>
          <SubmitButton size="lg" busy={busy} disabled={!ok} onClick={go}>{up ? "Add debt" : "Reduce debt"}</SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Owner only: forgive the whole debt. */
export function WriteOffDialog({ open, onClose, customer }: { open: boolean; onClose: () => void; customer: { _id: Id<"customers">; fullName: string; balanceCents: number } }) {
  const cur = useBiz().business.currency;
  const writeOff = useMutation(api.customers.writeOff);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!note.trim()) return;
    setBusy(true);
    const done = await act(writeOff({ customerId: customer._id, note: note.trim() }), "Debt written off");
    setBusy(false);
    if (done) { setNote(""); onClose(); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Write off debt?</DialogTitle>
          <DialogDescription>
            This removes the whole debt of <b className="tabular-nums">{formatCents(customer.balanceCents, cur)}</b> for {customer.fullName}. You are agreeing you will not collect it. It cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <Field label="Reason" required><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} autoFocus className="h-11" onKeyDown={(e) => e.key === "Enter" && go()} /></Field>
        <DialogFooter>
          <Button variant="outline" size="lg" onClick={onClose}>Cancel</Button>
          <SubmitButton size="lg" variant="destructive" busy={busy} disabled={!note.trim()} onClick={go}>Write off {formatCents(customer.balanceCents, cur)}</SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
