"use client";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Printer } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useBiz } from "@/components/guard";
import { PrintArea, METHOD_LABEL } from "@/components/receipt";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/convex/shared/money";
import { fmtDateTime } from "@/lib/session";

export type ZReport = FunctionReturnType<typeof api.shifts.report>;

function Row({ a, b, bold }: { a: React.ReactNode; b: React.ReactNode; bold?: boolean }) {
  return <div className={`flex justify-between gap-2 ${bold ? "font-bold" : ""}`}><span>{a}</span><span className="tabular-nums">{b}</span></div>;
}
const Rule = () => <hr className="my-2 border-dashed border-black" />;

/** 80mm Z-report. Pure view so it can be previewed and printed. */
export function ZReportView({ z, businessName, currency }: { z: ZReport; businessName: string; currency: string }) {
  const m = (c: number) => formatCents(c, currency);
  const s = z.shift;
  const methods = Object.entries(z.byMethod).filter(([, c]) => c !== 0);
  return (
    <div className="w-[80mm] bg-white p-3 font-mono text-[11px] leading-snug text-black">
      <div className="text-center">
        <div className="text-sm font-bold">{businessName}</div>
        <div className="font-bold">Z-REPORT {s.status === "OPEN" ? "(shift still open)" : ""}</div>
      </div>
      <Rule />
      <Row a="Cashier" b={s.memberName} />
      <Row a="Opened" b={fmtDateTime(s.openedAt)} />
      {s.closedAt && <Row a="Closed" b={fmtDateTime(s.closedAt)} />}
      <Rule />
      <Row a={`Sales (${z.salesCount})`} b={m(z.salesTotalCents)} bold />
      {methods.map(([k, c]) => <Row key={k} a={`  ${METHOD_LABEL[k] ?? k}`} b={m(c)} />)}
      {z.refundsCents > 0 && <Row a="Refunds" b={`-${m(z.refundsCents)}`} />}
      <Rule />
      <div className="font-bold">CASH DRAWER</div>
      <Row a="Opening float" b={m(s.openingFloatCents)} />
      <Row a="Cash sales (net of change)" b={m(z.cashSalesCents)} />
      {z.cashRepaymentsCents > 0 && <Row a="Debt repayments" b={m(z.cashRepaymentsCents)} />}
      {z.cashInCents > 0 && <Row a="Cash in" b={m(z.cashInCents)} />}
      {z.cashOutCents > 0 && <Row a="Cash out" b={`-${m(z.cashOutCents)}`} />}
      {z.cashRefundsCents > 0 && <Row a="Cash refunds" b={`-${m(z.cashRefundsCents)}`} />}
      {z.cashExpensesCents > 0 && <Row a="Cash expenses" b={`-${m(z.cashExpensesCents)}`} />}
      <Row a="Expected" b={m(z.expectedCashCents)} bold />
      {z.countedCashCents !== null && (
        <>
          <Row a="Counted" b={m(z.countedCashCents)} bold />
          <Row a="Difference" b={`${(z.differenceCents ?? 0) > 0 ? "+" : ""}${m(z.differenceCents ?? 0)}`} bold />
        </>
      )}
      {z.moves.length > 0 && (
        <>
          <Rule />
          <div className="font-bold">CASH IN / OUT</div>
          {z.moves.map((mv) => <Row key={mv._id} a={`${mv.type === "IN" ? "+" : "-"} ${mv.reason}`} b={m(mv.amountCents)} />)}
        </>
      )}
      {s.note && <><Rule /><div>Note: {s.note}</div></>}
    </div>
  );
}

export function ZReportDialog({ shiftId, onClose }: { shiftId: Id<"shifts"> | null; onClose: () => void }) {
  const me = useBiz();
  const z = useQuery(api.shifts.report, shiftId ? { shiftId } : "skip");
  const name = me.business.name;
  const cur = me.business.currency;
  return (
    <Dialog open={!!shiftId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-sm overflow-y-auto">
        <DialogHeader><DialogTitle>Z-report</DialogTitle></DialogHeader>
        {z ? (
          <>
            <div className="mx-auto overflow-hidden rounded-lg border"><ZReportView z={z} businessName={name} currency={cur} /></div>
            <Button size="lg" onClick={() => window.print()}><Printer /> Print</Button>
            <PrintArea><ZReportView z={z} businessName={name} currency={cur} /></PrintArea>
          </>
        ) : <Skeleton className="h-72 w-full" />}
      </DialogContent>
    </Dialog>
  );
}
