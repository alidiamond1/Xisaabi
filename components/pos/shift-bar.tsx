"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ChevronDown, Lock, Wallet } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Field, SubmitButton } from "@/components/common";
import { ZReportDialog } from "@/components/pos/z-report";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { formatCents, parseToCents } from "@/convex/shared/money";
import { act, run } from "@/lib/run";
import { fmtDateTime } from "@/lib/session";
import { cn } from "@/lib/utils";

type Dlg = "open" | "in" | "out" | "close" | null;

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
          <span className="hidden text-xs text-muted-foreground sm:inline">Cash expected</span>
          <span className="font-semibold tabular-nums">{formatCents(cur.expectedCashCents, currency)}</span>
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
      <CloseDialog open={dlg === "close"} expected={cur?.expectedCashCents ?? 0} currency={currency} onClose={() => setDlg(null)}
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

function CloseDialog({ open, expected, currency, onClose, onClosed }: {
  open: boolean; expected: number; currency: string; onClose: () => void; onClosed: (id: Id<"shifts">) => void;
}) {
  const close = useMutation(api.shifts.close);
  const [v, setV] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const counted = parseToCents(v);
  const diff = counted === null ? null : counted - expected;
  async function go() {
    if (counted === null) return;
    setBusy(true);
    const z = await run(close({ countedCashCents: counted, note: note.trim() || undefined }), "Shift closed");
    setBusy(false);
    if (z) { setV(""); setNote(""); onClosed(z.shift._id); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Close shift</DialogTitle><DialogDescription>Count the cash in the drawer and enter the total.</DialogDescription></DialogHeader>
        <div className="flex items-baseline justify-between rounded-xl bg-muted/60 px-4 py-3">
          <span className="text-sm text-muted-foreground">System expects</span>
          <span className="font-display text-2xl font-semibold tabular-nums">{formatCents(expected, currency)}</span>
        </div>
        <Field label="Cash counted"><Input inputMode="decimal" autoFocus placeholder="0.00" value={v} onChange={(e) => setV(e.target.value)} className="h-14 text-xl tabular-nums" /></Field>
        {diff !== null && (
          <p className={cn("text-center text-lg font-semibold tabular-nums", diff === 0 ? "text-success" : diff < 0 ? "text-danger" : "text-warning")}>
            {diff === 0 ? "Perfect, no difference" : diff < 0 ? `Short by ${formatCents(-diff, currency)}` : `Over by ${formatCents(diff, currency)}`}
          </p>
        )}
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="h-11" /></Field>
        <DialogFooter>
          <Button variant="outline" size="lg" onClick={onClose}>Cancel</Button>
          <SubmitButton size="lg" busy={busy} disabled={counted === null} onClick={go}>Close shift and print</SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
