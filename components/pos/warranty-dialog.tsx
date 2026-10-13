"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { ShieldCheck } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Pill } from "@/components/common";
import { useBiz } from "@/components/guard";
import { ReceiptDialog } from "@/components/receipt";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { canOpenApp } from "@/convex/shared/modules";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/session";

export const SERIAL_STATUS = {
  IN_STOCK: { tone: "green", label: "In stock" },
  SOLD: { tone: "blue", label: "Sold" },
  RETURNED: { tone: "amber", label: "Returned" },
  WRITTEN_OFF: { tone: "slate", label: "Written off" },
} as const;

/** Type or scan an IMEI / serial: which product, when it was sold, to whom, and whether the warranty is still running. */
export function WarrantyDialog({ open, onClose, initial = "" }: { open: boolean; onClose: () => void; initial?: string }) {
  const me = useBiz();
  const role = me.member.role as "OWNER" | "MANAGER" | "CASHIER";
  const [text, setText] = useState(initial);
  const [receipt, setReceipt] = useState<Id<"sales"> | null>(null);
  useEffect(() => { if (open) setText(initial); }, [open, initial]);
  const code = text.replace(/\s+/g, "");
  const r = useQuery(api.serials.lookup, open && code.length >= 4 ? { serial: code } : "skip");

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Warranty check</DialogTitle>
            <DialogDescription>Type or scan the IMEI / serial number from the phone or its box.</DialogDescription>
          </DialogHeader>
          <Input autoFocus inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} placeholder="IMEI / serial number" aria-label="IMEI or serial number" className="h-12 font-mono text-base tabular-nums" />
          {code.length < 4 ? (
            <p className="rounded-xl bg-muted/60 p-4 text-center text-sm text-muted-foreground">The result shows here.</p>
          ) : r === undefined ? <Skeleton className="h-32" /> : r === null ? (
            <p role="status" className="rounded-xl bg-warning-soft p-4 text-center text-sm text-warning">No unit with this number was bought through your shop.</p>
          ) : (
            <div className="space-y-3 rounded-xl border p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{r.product?.name ?? "Unknown product"}</p>
                  <p className="font-mono text-xs text-muted-foreground">{r.serial.serial}</p>
                </div>
                <Pill tone={SERIAL_STATUS[r.serial.status].tone} dot>{SERIAL_STATUS[r.serial.status].label}</Pill>
              </div>
              {r.serial.soldAt ? (
                <dl className="divide-y">
                  <Row k="Sold on" v={fmtDate(r.serial.soldAt)} />
                  <Row k="Receipt" v={r.sale ? <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setReceipt(r.sale!._id)}>#{r.sale.receiptNo}</button> : "-"} />
                  <Row k="Customer" v={r.customer ? (canOpenApp(role, me.plan.modules, "customers") ? <Link href={`/apps/customers/${r.customer._id}`} className="font-medium text-brand-700 hover:underline">{r.customer.fullName}</Link> : r.customer.fullName) : "Walk-in"} />
                </dl>
              ) : <p className="text-muted-foreground">Not sold yet.</p>}
              <div className={cn("flex items-center gap-3 rounded-lg p-3", r.warrantyStatus === "ACTIVE" ? "bg-success-soft text-success" : r.warrantyStatus === "EXPIRED" ? "bg-danger-soft text-danger" : "bg-muted text-muted-foreground")}>
                <ShieldCheck className="size-5 shrink-0" />
                <p className="font-medium">
                  {r.warrantyStatus === "ACTIVE" && `Warranty ACTIVE · ${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} left (until ${fmtDate(r.serial.warrantyUntil ?? 0)})`}
                  {r.warrantyStatus === "EXPIRED" && `Warranty EXPIRED on ${fmtDate(r.serial.warrantyUntil ?? 0)}`}
                  {r.warrantyStatus === "NONE" && (r.serial.soldAt ? "No warranty on this item" : "Warranty starts when it is sold")}
                </p>
              </div>
            </div>
          )}
          <Button variant="outline" size="lg" onClick={onClose}>Close</Button>
        </DialogContent>
      </Dialog>
      {receipt && <ReceiptDialog open onClose={() => setReceipt(null)} saleId={receipt} />}
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 py-2"><dt className="text-muted-foreground">{k}</dt><dd className="text-right">{v}</dd></div>;
}
