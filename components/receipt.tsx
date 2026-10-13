"use client";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { MessageCircle, Plus, Printer } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/convex/shared/money";
import { fmtQty } from "@/lib/cart";
import { openWhatsApp } from "@/lib/whatsapp";

export type ReceiptData = {
  businessName: string;
  logoUrl: string | null;
  phone: string;
  address: string;
  header?: string;
  footer?: string;
  currency: string;
  receiptNo: number | null; // null = provisional (offline)
  createdAt: number;
  cashierName: string;
  customerName?: string;
  items: { name: string; qty: number; priceCents: number; discountCents: number; unitName?: string; serials?: string[]; warrantyUntil?: number }[];
  orderDiscountCents: number;
  taxCents: number;
  totalCents: number;
  payments: { method: string; amountCents: number; reference?: string }[];
  changeCents: number;
  status?: string;
  refundedCents?: number;
};

export const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash", EVC: "EVC Plus", ZAAD: "Zaad", EDAHAB: "eDahab", BANK: "Bank", CREDIT: "On credit",
};

function Row({ a, b, bold }: { a: React.ReactNode; b: React.ReactNode; bold?: boolean }) {
  return <div className={`flex justify-between gap-2 ${bold ? "font-bold" : ""}`}><span>{a}</span><span className="tabular-nums">{b}</span></div>;
}

const dateOf = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const gross = (r: ReceiptData) => r.items.reduce((n, i) => n + Math.round(i.priceCents * i.qty), 0);
const discounts = (r: ReceiptData) => r.items.reduce((n, i) => n + i.discountCents, 0) + r.orderDiscountCents;

export function ReceiptView({ r, id, className }: { r: ReceiptData; id?: string; className?: string }) {
  const m = (c: number) => formatCents(c, r.currency);
  const disc = discounts(r);
  return (
    <div id={id} className={`w-[80mm] bg-white p-3 font-mono text-[11px] leading-snug text-black ${className ?? ""}`}>
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {r.logoUrl && <img src={r.logoUrl} alt="" className="mx-auto mb-1 max-h-14 max-w-[50mm] object-contain grayscale" />}
        <div className="text-sm font-bold">{r.businessName}</div>
        {r.phone && <div>{r.phone}</div>}
        {r.address && <div>{r.address}</div>}
        {r.header && <div className="mt-1 whitespace-pre-line">{r.header}</div>}
      </div>
      <hr className="my-2 border-dashed border-black" />
      <Row a={r.receiptNo ? `Receipt #${r.receiptNo}` : "PROVISIONAL RECEIPT"} b={new Date(r.createdAt).toLocaleDateString("en-GB")} />
      <Row a={`Cashier: ${r.cashierName}`} b={new Date(r.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} />
      {r.customerName && <div>Customer: {r.customerName}</div>}
      {r.status === "REFUNDED" && <div className="mt-1 text-center font-bold">*** REFUNDED ***</div>}
      {r.status === "PARTIALLY_REFUNDED" && <div className="mt-1 text-center font-bold">* PARTLY REFUNDED *</div>}
      <hr className="my-2 border-dashed border-black" />
      {r.items.map((i, k) => (
        <div key={k} className="mb-1">
          <div>{i.name}{i.unitName && ` (${i.unitName})`}</div>
          {i.serials?.map((s) => <div key={s}>  IMEI/SN: {s}</div>)}
          {i.warrantyUntil !== undefined && <div>  Warranty until {dateOf(i.warrantyUntil)}</div>}
          <Row a={`${fmtQty(i.qty)}${i.unitName ? ` ${i.unitName}` : ""} x ${m(i.priceCents)}`} b={m(Math.round(i.qty * i.priceCents))} />
          {i.discountCents > 0 && <Row a="  discount" b={`-${m(i.discountCents)}`} />}
        </div>
      ))}
      <hr className="my-2 border-dashed border-black" />
      <Row a="Subtotal" b={m(gross(r))} />
      {disc > 0 && <Row a="Discount" b={`-${m(disc)}`} />}
      {r.taxCents > 0 && <Row a="Tax" b={m(r.taxCents)} />}
      <Row a="TOTAL" b={m(r.totalCents)} bold />
      <hr className="my-2 border-dashed border-black" />
      {r.payments.map((p, k) => (
        <Row key={k} a={`${METHOD_LABEL[p.method] ?? p.method}${p.reference ? ` (${p.reference})` : ""}`} b={m(p.amountCents)} />
      ))}
      {r.changeCents > 0 && <Row a="Change" b={m(r.changeCents)} bold />}
      {!!r.refundedCents && <Row a="Refunded" b={m(r.refundedCents)} />}
      <hr className="my-2 border-dashed border-black" />
      <div className="whitespace-pre-line text-center">{r.footer || "Thank you!"}</div>
      {r.receiptNo === null && <div className="mt-1 text-center">Official receipt is issued when synced.</div>}
    </div>
  );
}

/** Plain-text summary for WhatsApp. */
export function receiptText(r: ReceiptData) {
  const m = (c: number) => formatCents(c, r.currency);
  const lines = [
    `*${r.businessName}*`,
    r.receiptNo ? `Receipt #${r.receiptNo} - ${new Date(r.createdAt).toLocaleDateString("en-GB")}` : new Date(r.createdAt).toLocaleDateString("en-GB"),
    "",
    ...r.items.flatMap((i) => [
      `${fmtQty(i.qty)}${i.unitName ? ` ${i.unitName}` : ""} x ${i.name} = ${m(Math.round(i.qty * i.priceCents) - i.discountCents)}`,
      ...(i.serials?.length ? [`   IMEI/SN: ${i.serials.join(", ")}`] : []),
      ...(i.warrantyUntil !== undefined ? [`   Warranty until ${dateOf(i.warrantyUntil)}`] : []),
    ]),
    "",
  ];
  const d = discounts(r);
  if (d > 0) lines.push(`Discount: -${m(d)}`);
  if (r.taxCents > 0) lines.push(`Tax: ${m(r.taxCents)}`);
  lines.push(`*Total: ${m(r.totalCents)}*`);
  lines.push(`Paid: ${r.payments.map((p) => `${METHOD_LABEL[p.method] ?? p.method} ${m(p.amountCents)}`).join(", ")}`);
  if (r.changeCents > 0) lines.push(`Change: ${m(r.changeCents)}`);
  lines.push("", r.footer || "Thank you!");
  return lines.join("\n");
}

/**
 * Print target. `receipt` = 80mm roll, `a4` = full page (statements, reports).
 * The global print rule shows only `#receipt-print`, so only one PrintArea may be mounted at a time.
 */
export function PrintArea({ children, paper = "receipt" }: { children: React.ReactNode; paper?: "receipt" | "a4" }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div id="receipt-print" className="hidden print:block">
      {paper === "a4" && (
        <style>{`@media print { @page { size: A4; margin: 12mm; } #receipt-print { width: 186mm !important; padding: 0 !important; font-size: 12px !important; } }`}</style>
      )}
      {children}
    </div>,
    document.body,
  );
}

/** Dialog with preview + print + WhatsApp. `local` = provisional/pre-built data; `saleId` = load from server. */
export function ReceiptDialog({
  open, onClose, saleId, local, onNew,
}: { open: boolean; onClose: () => void; saleId?: Id<"sales">; local?: ReceiptData; onNew?: () => void }) {
  const server = useQuery(api.sales.get, open && saleId ? { saleId } : "skip");
  let data: ReceiptData | undefined = local;
  if (server) {
    data = {
      businessName: server.businessName, logoUrl: server.logoUrl, phone: server.phone, address: server.address,
      header: server.receiptHeader, footer: server.receiptFooter, currency: server.currency,
      receiptNo: server.receiptNo, createdAt: server.createdAt, cashierName: server.cashierName, customerName: server.customerName,
      items: server.items, orderDiscountCents: server.discountCents, taxCents: server.taxCents, totalCents: server.totalCents,
      payments: server.payments, changeCents: server.changeCents, status: server.status, refundedCents: server.refundedCents,
    };
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-sm overflow-y-auto">
        <DialogHeader><DialogTitle>Receipt</DialogTitle></DialogHeader>
        {data ? (
          <>
            <div className="mx-auto overflow-hidden rounded-lg border"><ReceiptView r={data} /></div>
            <div className="grid grid-cols-2 gap-2">
              <Button size="lg" variant="outline" onClick={() => window.print()}><Printer /> Print</Button>
              <Button size="lg" variant="outline" onClick={() => openWhatsApp(undefined, receiptText(data))}><MessageCircle /> WhatsApp</Button>
            </div>
            {onNew && <Button size="xl" onClick={onNew}><Plus /> New sale</Button>}
            {open && <PrintArea><ReceiptView r={data} /></PrintArea>}
          </>
        ) : (
          <Skeleton className="h-64 w-full" />
        )}
      </DialogContent>
    </Dialog>
  );
}
