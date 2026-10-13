"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { Printer, Search } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Pill } from "@/components/common";
import { RefundForm } from "@/components/sales/refund-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/convex/shared/money";
import type { PayMethod } from "@/lib/outbox";
import { fmtDateTime } from "@/lib/session";

/** Find a sale by receipt number and return some or all of it. */
export function ReturnsDialog({ open, onClose, canRefund, methods, currency, onReprint }: {
  open: boolean; onClose: () => void; canRefund: boolean; methods: PayMethod[]; currency: string; onReprint: (id: Id<"sales">) => void;
}) {
  const [text, setText] = useState("");
  const no = /^#?\d+$/.test(text.trim()) ? Number(text.trim().replace("#", "")) : null;
  const sale = useQuery(api.sales.findByReceipt, open && no !== null ? { receiptNo: no } : "skip");
  const close = () => { setText(""); onClose(); };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Return items</DialogTitle>
          <DialogDescription>Type the receipt number printed on the customer&apos;s receipt.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3.5 top-3.5 size-5 text-muted-foreground" />
          <Input inputMode="numeric" autoFocus placeholder="Receipt number, e.g. 1042" value={text} onChange={(e) => setText(e.target.value)} className="h-12 pl-11 text-base" aria-label="Receipt number" />
        </div>
        {no === null ? null : sale === undefined ? <Skeleton className="h-40" /> : sale === null ? (
          <p className="rounded-xl bg-muted/60 p-4 text-center text-sm text-muted-foreground">No sale with receipt #{no}.</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
              <div className="min-w-0 text-sm">
                <p className="font-semibold">Receipt #{sale.receiptNo} {sale.status !== "COMPLETED" && <Pill tone="amber">{sale.status === "REFUNDED" ? "Refunded" : "Partly refunded"}</Pill>}</p>
                <p className="text-xs text-muted-foreground">{fmtDateTime(sale.createdAt)}{sale.customerName && ` · ${sale.customerName}`}</p>
              </div>
              <div className="text-right">
                <p className="font-display text-lg font-semibold tabular-nums">{formatCents(sale.totalCents, currency)}</p>
                <Button variant="ghost" size="sm" onClick={() => onReprint(sale._id)}><Printer /> Receipt</Button>
              </div>
            </div>
            {!canRefund ? (
              <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning">You do not have permission to refund. Ask the manager or owner.</p>
            ) : sale.status === "REFUNDED" ? (
              <p className="rounded-xl bg-muted/60 p-3 text-center text-sm text-muted-foreground">This sale is already fully refunded.</p>
            ) : (
              <RefundForm key={sale._id} sale={sale} methods={methods} currency={currency} onDone={close} />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
