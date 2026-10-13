"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ChevronDown, Lock, Wallet } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Field, SubmitButton } from "@/components/common";
import { METHOD_LABEL } from "@/components/receipt";
import { ZReportDialog } from "@/components/pos/z-report";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { formatCents, parseToCents } from "@/convex/shared/money";
import { act, run } from "@/lib/run";
import { fmtDateTime } from "@/lib/session";
import { cn } from "@/lib/utils";

const SHIFT_METHODS = ["EVC", "ZAAD", "EDAHAB", "CASH", "BANK"] as const; // mobile money first
const SHORT: Record<string, string> = { EVC: "EVC", ZAAD: "Zaad", EDAHAB: "eDahab", CASH: "Cash", BANK: "Bank" };
type Cur = NonNullable<FunctionReturnType<typeof api.shifts.current>>;
type Dlg ="open" | "in" | "out" | "close" | null;

/** Shift strip under the POS header: open prompt, or time + expected cash with a menu. */
export function ShiftBar({ currency }: { currency: string }) {
  const cur = useQuery(api.shifts.current);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [report, setReport] = useState<Id<"shifts"> | null>(null);
  if (cur === undefined) return <div className="h-11 shrink-0 border-b bg-muted/40" />;
  return (
    <>
      {cur === null ? (
        <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-warning-soft px-3 py-1.5 text-sm text-warning">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 font-medium">No cash shift open. You can still sell, but cash will not be tracked.</span>
          <Button size="sm" className="h-9" onClick={() => setDlg("open")}>Open shift</Button>
        </div>
      ) : (
        <div className="flex h-11 shrink-0 items-center gap-3 border-b bg-brand-50 px-3 text-sm text-brand-900">
          <Wallet className="size-4 shrink-0 text-brand-600" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">Shift open</span> since {fmtDateTime(cur.shift.openedAt)}
            <span className="hidden sm:inline"> · {cur.salesCount} sale{cur.salesCount === 1 ? "" : "s"}</span>
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">Expected</span>
          <span className="max-w-[48%] truncate font-semibold tabular-nums">
            {SHIFT_METHODS.filter((k) => cur.expectedByMethod[k] !== 0 || k === "CASH")
              .map((k) => `${SHORT[k]} ${formatCents(cur.expectedByMethod[k], currency)}`).join(" · ")}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 bg-card">Shift <ChevronDown /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem className="h-11" onClick={() => setDlg("in")}><ArrowDownToLine /> Cash in</DropdownMenuItem>
              <DropdownMenuItem className="h-11" onClick={() => setDlg("out")}><ArrowUpFromLine /> Cash out</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="h-11" onClick={() => setDlg("close")}><Lock /> Close shift</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <OpenDialog open={dlg === "open"} onClose={() => setDlg(null)} />
      <MoveDialog type={dlg === "in" ? "IN" : dlg === "out" ? "OUT" : null} onClose={() => setDlg(null)} />
      <CloseDialog open={dlg === "close"} cur={cur} currency={currency} onClose={() => setDlg(null)}
        onClosed={(id) => { setDlg(null); setReport(id); }} />
      <ZReportDialog shiftId={report} onClose={() => setReport(null)} />
    </>
  );
}

function OpenDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const openShift = useMutation(api.shifts.open);
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const cents = v === "" ? 0 : parseToCents(v);
  async function go() {
    if (cents === null) return;
    setBusy(true);
    const ok = await act(openShift({ openingFloatCents: cents }), "Shift opened");
    setBusy(false);
    if (ok) { setV(""); onClose(); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Open shift</DialogTitle><DialogDescription>How much cash is in the drawer to start with?</DialogDescription></DialogHeader>
        <Field label="Opening cash (float)" error={cents === null ? "Enter a valid amount." : undefined}>
          <Input inputMode="decimal" autoFocus placeholder="0.00" value={v} onChange={(e) => setV(e.target.value)} className="h-14 text-xl tabular-nums"
            onKeyDown={(e) => e.key === "Enter" && go()} />
        </Field>
        <DialogFooter>
          <Button variant="outline" size="lg" onClick={onClose}>Cancel</Button>
          <SubmitButton size="lg" busy={busy} disabled={cents === null} onClick={go}>Open shift</SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({ type, onClose }: { type: "IN" | "OUT" | null; onClose: () => void }) {
  const move = useMutation(api.shifts.cashMove);
  const [v, setV] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const cents = parseToCents(v);
  const ok = !!cents && cents > 0 && reason.trim().length > 0;
  async function go() {
    if (!type || !ok || !cents) return;
    setBusy(true);
    const done = await act(move({ type, amountCents: cents, reason: reason.trim() }), type === "IN" ? "Cash added to drawer" : "Cash taken out");
    setBusy(false);
    if (done) { setV(""); setReason(""); onClose(); }
  }
  return (
    <Dialog open={!!type} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{type === "IN" ? "Cash in" : "Cash out"}</DialogTitle>
          <DialogDescription>{type === "IN" ? "Money you put into the drawer, e.g. change from the bank." : "Money you take from the drawer, e.g. paying a supplier or the owner."}</DialogDescription>
        </DialogHeader>
        <Field label="Amount"><Input inputMode="decimal" autoFocus placeholder="0.00" value={v} onChange={(e) => setV(e.target.value)} className="h-14 text-xl tabular-nums" /></Field>
        <Field label="Reason" required hint="Shown on the Z-report.">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className="h-11" onKeyDown={(e) => e.key === "Enter" && go()} />
        </Field>
        <DialogFooter>
          <Button variant="outline" size="lg" onClick={onClose}>Cancel</Button>
          <SubmitButton size="lg" busy={busy} disabled={!ok} onClick={go}>Save</SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Line({ a, b, tone }: { a: React.ReactNode; b: React.ReactNode; tone?: string }) {
  return <div className={cn("flex justify-between gap-3", tone)}><span className="min-w-0 truncate">{a}</span><span className="shrink-0 tabular-nums">{b}</span></div>;
}

function CloseDialog({ open, cur, currency, onClose, onClosed }: {
  open: boolean; cur: Cur | null | undefined; currency: string; onClose: () => void; onClosed: (id: Id<"shifts">) => void;
}) {
  const close = useMutation(api.shifts.close);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const m = (c: number) => formatCents(c, currency);
  if (!cur) return null;
  const rows = SHIFT_METHODS.filter((k) => cur.expectedByMethod[k] !== 0 || k === "CASH");
  const parsed = (k: string) => ((vals[k] ?? "").trim() === "" ? undefined : parseToCents(vals[k]));
  const invalid = rows.some((k) => parsed(k) === null);
  const cashBlank = parsed("CASH") === undefined && cur.expectedByMethod.CASH !== 0; // cash must be counted when money is expected
  const sold = SHIFT_METHODS.filter((k) => cur.byMethod[k] !== 0);
  const repaid = SHIFT_METHODS.filter((k) => cur.repaymentsByMethod[k] !== 0);
  const refunded = SHIFT_METHODS.filter((k) => cur.refundsByMethod[k] !== 0);
  async function go() {
    const counted = rows.filter((k) => k !== "CASH" && typeof parsed(k) === "number")
      .map((k) => ({ method: k, amountCents: parsed(k) as number }));
    setBusy(true);
    const z = await run(close({ countedCashCents: (parsed("CASH") as number | undefined) ?? 0, counted, note: note.trim() || undefined }), "Shift closed");
    setBusy(false);
    if (z) { setVals({}); setNote(""); onClosed(z.shift._id); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Close shift</DialogTitle><DialogDescription>Check what you did, then enter what you have for each method.</DialogDescription></DialogHeader>
        <div className="space-y-1 rounded-xl bg-muted/60 px-4 py-3 text-sm">
          <Line a={`Sales (${cur.salesCount})`} b={m(cur.salesTotalCents)} tone="font-semibold" />
          {sold.map((k) => <Line key={k} a={`  ${METHOD_LABEL[k]}`} b={m(cur.byMethod[k])} />)}
          {cur.creditGivenCents > 0 && <Line a="  On credit (deen given)" b={m(cur.creditGivenCents)} tone="text-warning" />}
          {repaid.map((k) => <Line key={k} a={`Debt repaid, ${METHOD_LABEL[k]}`} b={m(cur.repaymentsByMethod[k])} />)}
          {refunded.map((k) => <Line key={k} a={`Refunds, ${METHOD_LABEL[k]}`} b={`-${m(cur.refundsByMethod[k])}`} />)}
          {cur.expensesCents > 0 && <Line a="Expenses" b={`-${m(cur.expensesCents)}`} />}
          {cur.cashInCents > 0 && <Line a="Cash in" b={m(cur.cashInCents)} />}
          {cur.cashOutCents > 0 && <Line a="Cash out" b={`-${m(cur.cashOutCents)}`} />}
          {cur.itemsSold.length > 0 && (
            <details className="pt-1">
              <summary className="cursor-pointer font-medium">Items sold ({cur.itemsSold.length})</summary>
              <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {cur.itemsSold.map((i) => <Line key={`${i.name}|${i.unitName}`} a={`${i.qty} ${i.unitName ?? "x"} ${i.name}`} b={m(i.totalCents)} />)}
              </div>
            </details>
          )}
        </div>
        {rows.map((k) => {
          const exp = cur.expectedByMethod[k];
          const c = parsed(k);
          const diff = typeof c === "number" ? c - exp : null;
          return (
            <div key={k} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{METHOD_LABEL[k]}</span>
                <span className="text-sm text-muted-foreground">Expected <b className="tabular-nums text-foreground">{m(exp)}</b></span>
              </div>
              <Field label={k === "CASH" ? "Cash counted in drawer" : `Amount in your ${METHOD_LABEL[k]} account received this shift`}
                error={c === null ? "Enter a valid amount." : undefined}>
                <Input inputMode="decimal" placeholder={k === "CASH" ? "0.00" : "Leave blank if not checked"} value={vals[k] ?? ""}
                  onChange={(e) => setVals((p) => ({ ...p, [k]: e.target.value }))} className="h-12 text-lg tabular-nums" />
              </Field>
              {diff !== null && (
                <p className={cn("text-sm font-semibold tabular-nums", diff === 0 ? "text-success" : diff < 0 ? "text-danger" : "text-warning")}>
                  {diff === 0 ? "Matches" : diff < 0 ? `Short by ${m(-diff)}` : `Over by ${m(diff)}`}
                </p>
              )}
            </div>
          );
        })}
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="h-11" /></Field>
        <DialogFooter className="sticky -bottom-5 -mx-5 -mb-5 border-t bg-popover p-4">
          <Button variant="outline" size="lg" onClick={onClose}>Cancel</Button>
          <SubmitButton size="lg" busy={busy} disabled={invalid || cashBlank} onClick={go}>Close shift and print</SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
