"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { Printer, Undo2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Money, Pill } from "@/components/common";
import { useBiz } from "@/components/guard";
import { METHOD_LABEL, ReceiptDialog } from "@/components/receipt";
import { RefundForm } from "@/components/sales/refund-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/convex/shared/money";
import { hasPermission } from "@/convex/shared/permissions";
import { fmtQty } from "@/lib/cart";
import type { PayMethod } from "@/lib/outbox";
import { fmtDate, fmtDateTime } from "@/lib/session";

export const STATUS_PILL = {
  COMPLETED: { tone: "green", label: "Paid" },
  PARTIALLY_REFUNDED: { tone: "amber", label: "Part refunded" },
  REFUNDED: { tone: "red", label: "Refunded" },
} as const;

/** Right-hand drawer with everything about one sale. */
export function SaleDetail({ saleId, onClose }: { saleId: Id<"sales"> | null; onClose: () => void }) {
  const me = useBiz();
  const cur = me.business.currency;
  const m = (c: number) => formatCents(c, cur);
  const sale = useQuery(api.sales.get, saleId ? { saleId } : "skip");
  const [reprint, setReprint] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const seeCost = hasPermission(me.member, "seeCost");
  const canRefund = hasPermission(me.member, "refund");
  const methods = (["CASH", "EVC", "ZAAD", "EDAHAB", "BANK", "CREDIT"] as PayMethod[]).filter((x) => x === "CASH" || me.business.settings.paymentMethods.includes(x));

  const lineDisc = sale?.items.reduce((n, i) => n + i.discountCents, 0) ?? 0;
  const profit = sale && seeCost
    ? sale.items.reduce((n, i) => n + Math.round(i.priceCents * i.qty) - i.discountCents - Math.round((("costCents" in i ? i.costCents : 0) ?? 0) * i.qty), 0) - sale.discountCents
    : null;

  return (
    <>
      <Sheet open={!!saleId} onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
          <SheetHeader className="border-b">
            <SheetTitle className="font-display text-lg">{sale ? `Receipt #${sale.receiptNo}` : "Sale"}</SheetTitle>
            <SheetDescription>{sale ? `${fmtDateTime(sale.createdAt)} · ${sale.cashierName}` : "Loading"}</SheetDescription>
          </SheetHeader>
          {!sale ? <div className="space-y-3 p-4"><Skeleton className="h-8" /><Skeleton className="h-40" /></div> : (
            <div className="space-y-5 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={STATUS_PILL[sale.status].tone} dot>{STATUS_PILL[sale.status].label}</Pill>
                {sale.customerName && <Pill tone="brand">{sale.customerName}</Pill>}
              </div>

              <section aria-label="Items" className="overflow-hidden rounded-xl border">
                <ul className="divide-y text-sm">
                  {sale.items.map((i) => (
                    <li key={`${i.productId}|${i.unitName ?? ""}`} className="flex items-start justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="font-medium">{i.name}{i.unitName && <span className="ml-1.5 rounded-md bg-brand-50 px-1.5 py-0.5 text-xs font-semibold text-brand-800">{i.unitName}</span>}</p>
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {fmtQty(i.qty)}{i.unitName ? ` ${i.unitName}` : ""} x {m(i.priceCents)}{i.discountCents > 0 && ` · discount -${m(i.discountCents)}`}
                          {i.refundedQty > 0 && <span className="text-danger"> · {fmtQty(i.refundedQty)} returned</span>}
                        </p>
                        {i.serials?.length ? <p className="break-all font-mono text-xs tabular-nums text-muted-foreground">{i.serials.join(", ")}</p> : null}
                        {i.warrantyUntil !== undefined && <p className="text-xs text-muted-foreground">Warranty until {fmtDate(i.warrantyUntil)}</p>}
                        {seeCost && "costCents" in i && <p className="text-xs tabular-nums text-muted-foreground">cost {m(i.costCents)} each</p>}
                      </div>
                      <Money className="shrink-0 font-medium">{m(Math.round(i.priceCents * i.qty) - i.discountCents)}</Money>
                    </li>
                  ))}
                </ul>
                <dl className="space-y-1 border-t bg-muted/30 px-3 py-2.5 text-sm tabular-nums">
                  <div className="flex justify-between"><dt className="text-muted-foreground">Items</dt><dd>{m(sale.subtotalCents)}</dd></div>
                  {sale.discountCents > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Order discount</dt><dd>-{m(sale.discountCents)}</dd></div>}
                  {sale.taxCents > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Tax</dt><dd>{m(sale.taxCents)}</dd></div>}
                  <div className="flex justify-between border-t pt-1.5 text-base font-semibold"><dt>Total</dt><dd>{m(sale.totalCents)}</dd></div>
                  {lineDisc + sale.discountCents > 0 && <div className="flex justify-between text-success"><dt>Customer saved</dt><dd>{m(lineDisc + sale.discountCents)}</dd></div>}
                  {profit !== null && <div className="flex justify-between"><dt className="text-muted-foreground">Profit (before tax)</dt><dd className={profit < 0 ? "text-danger" : "text-success"}>{m(profit)}</dd></div>}
                </dl>
              </section>

              <section aria-label="Payments">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payments</h3>
                <ul className="divide-y rounded-xl border text-sm">
                  {sale.payments.map((p, k) => (
                    <li key={k} className="flex justify-between gap-3 px-3 py-2.5">
                      <span>{METHOD_LABEL[p.method] ?? p.method}{p.reference && <span className="ml-1.5 text-xs text-muted-foreground">ref {p.reference}</span>}</span>
                      <Money className="font-medium">{m(p.amountCents)}</Money>
                    </li>
                  ))}
                  {sale.changeCents > 0 && <li className="flex justify-between px-3 py-2.5 text-muted-foreground"><span>Change given</span><Money>{m(sale.changeCents)}</Money></li>}
                </ul>
              </section>

              {sale.refunds.length > 0 && (
                <section aria-label="Refunds">
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Refunds</h3>
                  <ul className="divide-y rounded-xl border text-sm">
                    {sale.refunds.map((r) => (
                      <li key={r._id} className="space-y-0.5 px-3 py-2.5">
                        <div className="flex justify-between gap-3">
                          <span className="font-medium">{fmtDateTime(r.createdAt)} · {r.method === "CREDIT" ? "Reduced debt" : METHOD_LABEL[r.method]}</span>
                          <Money tone="out" className="font-medium">-{m(r.amountCents)}</Money>
                        </div>
                        <p className="text-xs text-muted-foreground">{r.items.map((i) => `${fmtQty(i.qty)} x ${i.name}${i.restock ? "" : " (not restocked)"}`).join(", ")}</p>
                        <p className="text-xs text-muted-foreground">Reason: {r.reason}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {sale.note && <p className="rounded-lg bg-muted/50 p-3 text-sm"><span className="font-medium">Note: </span>{sale.note}</p>}

              <div className="grid grid-cols-2 gap-2 pb-[env(safe-area-inset-bottom)]">
                <Button variant="outline" size="lg" onClick={() => setReprint(true)}><Printer /> Reprint</Button>
                {canRefund && <Button variant="destructive" size="lg" disabled={sale.status === "REFUNDED"} onClick={() => setRefunding(true)}><Undo2 /> Refund</Button>}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
      {reprint && saleId && <ReceiptDialog open onClose={() => setReprint(false)} saleId={saleId} />}
      <Dialog open={refunding} onOpenChange={setRefunding}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>Refund receipt #{sale?.receiptNo}</DialogTitle><DialogDescription>Choose what comes back. Stock and money are updated together.</DialogDescription></DialogHeader>
          {sale && <RefundForm sale={sale} methods={methods} currency={cur} onDone={() => setRefunding(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
