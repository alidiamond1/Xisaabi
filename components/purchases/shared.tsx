"use client";
import { Pill } from "@/components/common";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatCents } from "@/convex/shared/money";
import { fmtDate, fmtDateTime } from "@/lib/session";
import { fmtQty } from "@/components/inventory/bits";

export const PAY_METHODS = [
  { value: "CASH", label: "Cash" }, { value: "EVC", label: "EVC Plus" }, { value: "ZAAD", label: "Zaad" },
  { value: "EDAHAB", label: "eDahab" }, { value: "BANK", label: "Bank" },
] as const;
export type PayMethod = (typeof PAY_METHODS)[number]["value"];
export const methodLabel = (m?: string) => PAY_METHODS.find((x) => x.value === m)?.label ?? m ?? "";

/** Shape shared by purchases.list, purchases.get and suppliers.get (cost may be stripped). */
export type PurchaseView = {
  _id: string; number: number; supplierName: string; supplierId?: string;
  items: { name: string; qty: number; unitCostCents?: number; batchNo?: string; expiryDate?: number }[];
  otherCostCents: number; totalCents: number; paidCents: number; paidMethod?: string; note: string; createdAt: number;
};

export const costOf = (i: { unitCostCents?: number }) => i.unitCostCents;

export function PurchaseDrawer({ p, cur, onClose }: { p: PurchaseView | null; cur: string; onClose: () => void }) {
  const credit = p ? p.totalCents - p.paidCents : 0;
  return (
    <Sheet open={!!p} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {p && (
          <>
            <SheetHeader className="border-b pr-12">
              <SheetTitle className="font-display text-lg">Purchase #{p.number}</SheetTitle>
              <SheetDescription>{p.supplierName || "No supplier"} · {fmtDateTime(p.createdAt)}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-6">
              <ul className="divide-y rounded-xl border">
                {p.items.map((i, n) => (
                  <li key={n} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">{i.name}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {fmtQty(i.qty)}{i.unitCostCents !== undefined && ` × ${formatCents(i.unitCostCents, cur)}`}
                        {i.batchNo && ` · Batch ${i.batchNo}`}{i.expiryDate !== undefined && ` · Expires ${fmtDate(i.expiryDate)}`}
                      </p>
                    </div>
                    {i.unitCostCents !== undefined && <span className="shrink-0 tabular-nums">{formatCents(Math.round(i.qty * i.unitCostCents), cur)}</span>}
                  </li>
                ))}
              </ul>
              <dl className="space-y-1.5 text-sm">
                {p.otherCostCents > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Other costs</dt><dd className="tabular-nums">{formatCents(p.otherCostCents, cur)}</dd></div>}
                <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatCents(p.totalCents, cur)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Paid{p.paidMethod && ` (${methodLabel(p.paidMethod)})`}</dt><dd className="tabular-nums text-success">{formatCents(p.paidCents, cur)}</dd></div>
                {credit > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">On credit</dt><dd className="tabular-nums text-danger">{formatCents(credit, cur)}</dd></div>}
              </dl>
              {credit > 0 ? <Pill tone="amber">On credit</Pill> : <Pill tone="green">Paid in full</Pill>}
              {p.note && <p className="rounded-lg bg-muted px-3 py-2 text-sm">{p.note}</p>}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
