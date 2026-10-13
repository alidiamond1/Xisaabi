"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SubmitButton } from "@/components/common";
import { METHOD_LABEL } from "@/components/receipt";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/convex/shared/money";
import { fmtQty, roundQty } from "@/lib/cart";
import type { PayMethod } from "@/lib/outbox";
import { run } from "@/lib/run";
import { cn } from "@/lib/utils";

export type RefundableSale = {
  _id: Id<"sales">;
  receiptNo: number;
  customerId?: Id<"customers">;
  customerName?: string;
  subtotalCents: number;
  totalCents: number;
  items: {
    productId: Id<"products">; name: string; qty: number; priceCents: number; discountCents: number; refundedQty: number;
    unitName?: string; serials?: string[];
  }[];
};

const REASONS = ["Damaged", "Wrong item", "Customer changed mind", "Price mistake"];
/** One refund row per product + pack. */
const keyOf = (it: { productId: string; unitName?: string }) => `${it.productId}|${it.unitName ?? ""}`;

/**
 * Pick lines + qty, restock or not, method and reason. The server pro-rates discounts and tax;
 * the amount shown here is the same math and only an estimate to the cent.
 */
export function RefundForm({ sale, methods, currency, onDone }: {
  sale: RefundableSale; methods: PayMethod[]; currency: string; onDone: () => void;
}) {
  const refund = useMutation(api.sales.refund);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [imeis, setImeis] = useState<Record<string, string[]>>({}); // serial lines: which numbers come back
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [method, setMethod] = useState<PayMethod>("CASH");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // each line's share of the total (line net + order discount + tax), cumulative so shares add up
  let cum = 0, prev = 0;
  const shares = sale.items.map((it) => {
    cum += Math.round(it.priceCents * it.qty) - it.discountCents;
    const c = sale.subtotalCents > 0 ? Math.round((cum * sale.totalCents) / sale.subtotalCents) : 0;
    const s = c - prev;
    prev = c;
    return s;
  });
  const picks = sale.items.map((it, i) => {
    const k = keyOf(it);
    const left = roundQty(it.qty - it.refundedQty);
    const n = it.serials?.length ? (imeis[k]?.length ?? 0) : Number(qty[k] ?? "");
    const q = Number.isFinite(n) && n > 0 ? Math.min(roundQty(n), left) : 0;
    const part = (d: number) => (d >= it.qty ? shares[i] : Math.floor((shares[i] * d) / it.qty));
    return { it, k, left, q, money: q > 0 ? part(roundQty(it.refundedQty + q)) - part(it.refundedQty) : 0 };
  });
  const chosen = picks.filter((p) => p.q > 0);
  const amount = chosen.reduce((n, p) => n + p.money, 0);
  const allowed = methods.filter((m) => m !== "CREDIT" || sale.customerId);
  const ok = chosen.length > 0 && reason.trim().length > 0;

  async function go() {
    setBusy(true);
    const r = await run(
      refund({
        saleId: sale._id, method, reason: reason.trim(),
        items: chosen.map((p) => ({
          productId: p.it.productId, qty: p.q, restock: restock[p.k] ?? true, unitName: p.it.unitName,
          serials: p.it.serials?.length ? imeis[p.k] : undefined,
        })),
      }),
      undefined,
    );
    setBusy(false);
    if (r) { toast.success(`Refunded ${formatCents(r.amountCents, currency)}`); onDone(); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">What is being returned?</h3>
        <button type="button" className="h-11 px-2 text-sm font-medium text-brand-700 hover:underline"
          onClick={() => {
            setQty(Object.fromEntries(picks.filter((p) => p.left > 0 && !p.it.serials?.length).map((p) => [p.k, String(p.left)])));
            // numbers are only all known to be returnable on a line nothing has been returned from yet
            setImeis(Object.fromEntries(picks.filter((p) => p.left > 0 && p.it.serials?.length && p.it.refundedQty === 0).map((p) => [p.k, p.it.serials!])));
          }}>Return everything</button>
      </div>
      <div className="divide-y rounded-xl border">
        {picks.map(({ it, k, left, q }) => (
          <div key={k} className={cn("space-y-2 p-3", left <= 0 && "opacity-50")}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{it.name}{it.unitName && <span className="ml-1.5 rounded-md bg-brand-50 px-1.5 py-0.5 text-xs font-semibold text-brand-800">{it.unitName}</span>}</p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  Sold {fmtQty(it.qty)}{it.unitName ? ` ${it.unitName}` : ""} x {formatCents(it.priceCents, currency)}{it.refundedQty > 0 && ` · already returned ${fmtQty(it.refundedQty)}`}
                </p>
              </div>
              {left <= 0 ? <span className="text-xs text-muted-foreground">Fully returned</span> : !it.serials?.length && (
                <Input inputMode="decimal" aria-label={`Quantity to return, ${it.name}`} placeholder="0" value={qty[k] ?? ""} className="h-11 w-20 text-right tabular-nums"
                  onChange={(e) => setQty((s) => ({ ...s, [k]: e.target.value }))} />
              )}
            </div>
            {left > 0 && it.serials?.length ? (
              <SerialChecks serials={it.serials} checkStatus={it.refundedQty > 0} value={imeis[k] ?? []} onChange={(v) => setImeis((s) => ({ ...s, [k]: v }))} />
            ) : null}
            {q > 0 && (
              <label className="flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" className="size-5 accent-[var(--color-brand-600)]" checked={restock[k] ?? true}
                  onChange={(e) => setRestock((s) => ({ ...s, [k]: e.target.checked }))} />
                Put back in stock
              </label>
            )}
          </div>
        ))}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Refund as</legend>
        <div className="flex flex-wrap gap-2">
          {allowed.map((m) => (
            <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)}
              className={cn("h-11 rounded-lg border px-4 text-sm font-semibold", method === m ? "border-brand-600 bg-brand-50 text-brand-800" : "bg-card text-muted-foreground hover:bg-muted")}>
              {m === "CREDIT" ? "Reduce debt" : METHOD_LABEL[m]}
            </button>
          ))}
        </div>
        {method === "CREDIT" && <p className="text-xs text-muted-foreground">The amount is taken off {sale.customerName}&apos;s balance.</p>}
      </fieldset>

      <div className="space-y-2">
        <label htmlFor="refund-reason" className="text-sm font-semibold">Reason <span className="text-danger" aria-hidden>*</span></label>
        <Input id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="h-11" />
        <div className="flex flex-wrap gap-1.5">
          {REASONS.map((r) => <button key={r} type="button" onClick={() => setReason(r)} className="h-11 rounded-full border bg-card px-3 text-xs font-medium text-muted-foreground hover:bg-muted">{r}</button>)}
        </div>
      </div>

      <div className="flex items-baseline justify-between rounded-xl bg-muted/60 px-4 py-3">
        <span className="text-sm font-medium">Refund total</span>
        <span className="font-display text-2xl font-semibold tabular-nums">{formatCents(amount, currency)}</span>
      </div>
      <div className="sticky -bottom-5 z-10 -mx-5 -mb-5 rounded-b-2xl border-t bg-card px-5 py-4">
        <SubmitButton size="xl" className="w-full" busy={busy} disabled={!ok} onClick={go}>Refund {amount > 0 ? formatCents(amount, currency) : ""}</SubmitButton>
      </div>
    </div>
  );
}

/** Tick which IMEI / serial numbers come back. After an earlier partial return, numbers already returned are greyed out. */
function SerialChecks({ serials, checkStatus, value, onChange }: { serials: string[]; checkStatus: boolean; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (s: string) => onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s]);
  return (
    <ul className="space-y-1.5" aria-label="IMEI numbers to return">
      {serials.map((s) => <SerialCheck key={s} s={s} checkStatus={checkStatus} on={value.includes(s)} onToggle={() => toggle(s)} />)}
    </ul>
  );
}

function SerialCheck({ s, checkStatus, on, onToggle }: { s: string; checkStatus: boolean; on: boolean; onToggle: () => void }) {
  const r = useQuery(api.serials.lookup, checkStatus ? { serial: s } : "skip");
  const gone = checkStatus && r !== undefined && r?.serial.status !== "SOLD";
  return (
    <li>
      <button type="button" disabled={gone || (checkStatus && r === undefined)} aria-pressed={on} onClick={onToggle}
        className={cn("flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 text-left disabled:opacity-50", on ? "border-brand-600 bg-brand-50" : "bg-card")}>
        <span className={cn("grid size-5 shrink-0 place-items-center rounded border", on ? "border-brand-600 bg-brand-600 text-white" : "bg-card")}>{on && <Check className="size-3.5" />}</span>
        <span className="font-mono text-sm tabular-nums">{s}</span>
        {gone && <span className="ml-auto text-xs text-muted-foreground">already returned</span>}
      </button>
    </li>
  );
}
