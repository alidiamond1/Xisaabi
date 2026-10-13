"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { MessageCircle, Printer } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Panel } from "@/components/common";
import { PrintArea, METHOD_LABEL } from "@/components/receipt";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/convex/shared/money";
import { dayEnd, dayStart, fmtDate, isoDay } from "@/lib/session";
import { openWhatsApp } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

export const LEDGER_LABEL = {
  OPENING: "Opening balance", DEBT: "Credit sale", PAYMENT: "Payment", REVERSAL: "Refund", ADJUST_UP: "Debt added",
  ADJUST_DOWN: "Debt reduced", WRITE_OFF: "Written off",
} as const;
type Statement = FunctionReturnType<typeof api.customers.statement>;
const DAY = 86_400_000;
const PRESETS = [["30", "Last 30 days", 30], ["90", "Last 90 days", 90], ["365", "Last year", 365]] as const;

function money(c: number, cur: string) { return formatCents(c, cur); }

export function StatementDialog({ customerId, onClose }: { customerId: Id<"customers"> | null; onClose: () => void }) {
  const [from, setFrom] = useState(() => isoDay(Date.now() - 30 * DAY));
  const [to, setTo] = useState(() => isoDay(Date.now()));
  const s = useQuery(api.customers.statement, customerId && from <= to ? { customerId, from: dayStart(from), to: dayEnd(to) } : "skip");
  return (
    <Dialog open={!!customerId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Statement</DialogTitle>
          <DialogDescription>Choose the dates, then print it or send it on WhatsApp.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map(([k, label, days]) => (
            <Button key={k} variant="outline" size="lg" onClick={() => { setFrom(isoDay(Date.now() - days * DAY)); setTo(isoDay(Date.now())); }}>{label}</Button>
          ))}
          <Input type="date" aria-label="From" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="h-11 w-40" />
          <span className="text-muted-foreground">to</span>
          <Input type="date" aria-label="To" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="h-11 w-40" />
        </div>
        {!s ? <Skeleton className="h-72" /> : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
              <Button size="lg" onClick={() => window.print()}><Printer /> Print</Button>
              <Button size="lg" variant="outline" onClick={() => openWhatsApp(s.customer.whatsapp || s.customer.phone, statementText(s, from, to))}><MessageCircle /> WhatsApp</Button>
            </div>
            <Panel className="overflow-x-auto"><StatementDoc s={s} from={from} to={to} /></Panel>
            <PrintArea paper="a4"><StatementDoc s={s} from={from} to={to} /></PrintArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function statementText(s: Statement, from: string, to: string) {
  const cur = s.business.currency;
  const lines = [
    `*${s.business.name}* - Statement`,
    `${s.customer.fullName}, ${from} to ${to}`,
    `Opening: ${money(s.openingBalanceCents, cur)}`,
    ...s.rows.slice(-15).map((r) => `${fmtDate(r.createdAt)} ${LEDGER_LABEL[r.type]} ${r.deltaCents >= 0 ? "+" : "-"}${money(Math.abs(r.deltaCents), cur)}`),
  ];
  if (s.rows.length > 15) lines.splice(3, 0, `(last 15 of ${s.rows.length} entries)`);
  lines.push(`*Balance: ${s.closingBalanceCents > 0 ? `owes ${money(s.closingBalanceCents, cur)}` : s.closingBalanceCents < 0 ? `credit ${money(-s.closingBalanceCents, cur)}` : "settled"}*`);
  return lines.join("\n");
}

/** A4 statement. Black on white so it prints cleanly. */
function StatementDoc({ s, from, to }: { s: Statement; from: string; to: string }) {
  const cur = s.business.currency;
  const m = (c: number) => money(c, cur);
  const bal = (c: number) => (c > 0 ? `${m(c)} owed` : c < 0 ? `${m(-c)} credit` : m(0));
  return (
    <div className="min-w-[34rem] bg-white p-6 text-sm text-black">
      <div className="flex items-start justify-between gap-4 border-b border-black pb-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {s.business.logoUrl && <img src={s.business.logoUrl} alt="" className="max-h-16 max-w-28 object-contain" />}
          <div>
            <p className="font-display text-xl font-bold">{s.business.name}</p>
            <p className="text-xs">{[s.business.address, s.business.city].filter(Boolean).join(", ")}</p>
            {s.business.phone && <p className="text-xs">{s.business.phone}</p>}
          </div>
        </div>
        <div className="text-right">
          <p className="font-display text-lg font-bold uppercase tracking-wide">Statement</p>
          <p className="text-xs">{fmtDate(dayStart(from))} to {fmtDate(dayStart(to))}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide">Customer</p>
          <p className="font-semibold">{s.customer.fullName}</p>
          {s.customer.companyName && <p>{s.customer.companyName}</p>}
          <p className="text-xs">{[s.customer.phone, s.customer.district, s.customer.address].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wide">Balance at end</p>
          <p className="font-display text-2xl font-bold tabular-nums">{bal(s.closingBalanceCents)}</p>
        </div>
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-y border-black text-left font-semibold uppercase">
            <th className="py-1.5 pr-2">Date</th><th className="pr-2">Details</th><th className="pr-2 text-right">Debit</th><th className="pr-2 text-right">Credit</th><th className="text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-neutral-300 italic"><td className="py-1.5 pr-2" colSpan={4}>Opening balance</td><td className="text-right tabular-nums">{bal(s.openingBalanceCents)}</td></tr>
          {s.rows.map((r) => (
            <tr key={r._id} className="break-inside-avoid border-b border-neutral-300 align-top">
              <td className="whitespace-nowrap py-1.5 pr-2">{fmtDate(r.createdAt)}</td>
              <td className="pr-2">{LEDGER_LABEL[r.type]}{r.method ? ` (${METHOD_LABEL[r.method]})` : ""}{(r.reference || (r.note && r.note !== LEDGER_LABEL[r.type])) && <span className="block text-neutral-600">{[r.reference, r.note !== LEDGER_LABEL[r.type] && r.note].filter(Boolean).join(" · ")}</span>}</td>
              <td className="pr-2 text-right tabular-nums">{r.deltaCents > 0 ? m(r.deltaCents) : ""}</td>
              <td className="pr-2 text-right tabular-nums">{r.deltaCents < 0 ? m(-r.deltaCents) : ""}</td>
              <td className="text-right tabular-nums">{bal(r.balanceAfterCents)}</td>
            </tr>
          ))}
          {s.rows.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-neutral-600">No activity in this period.</td></tr>}
        </tbody>
        <tfoot>
          <tr className="border-t border-black font-bold"><td className="py-2" colSpan={4}>Closing balance</td><td className={cn("text-right tabular-nums")}>{bal(s.closingBalanceCents)}</td></tr>
        </tfoot>
      </table>
      <p className="mt-6 text-center text-xs text-neutral-600">Thank you for your business.</p>
    </div>
  );
}
