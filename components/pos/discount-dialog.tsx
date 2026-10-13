"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCents, parseToCents } from "@/convex/shared/money";
import { discCents, type Disc } from "@/lib/cart";
import { cn } from "@/lib/utils";

/** Discount in money or percent, with one-tap presets from settings. */
export function DiscountDialog({ open, title, baseCents, currency, presets, value, onClose, onApply }: {
  open: boolean; title: string; baseCents: number; currency: string; presets: number[]; value?: Disc; onClose: () => void; onApply: (d?: Disc) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        {open && <Body title={title} baseCents={baseCents} currency={currency} presets={presets} value={value} onApply={onApply} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({ title, baseCents, currency, presets, value, onApply }: {
  title: string; baseCents: number; currency: string; presets: number[]; value?: Disc; onApply: (d?: Disc) => void;
}) {
  const [kind, setKind] = useState<Disc["kind"]>(value?.kind ?? "PCT");
  const [text, setText] = useState(value ? (kind === "AMT" ? (value.value / 100).toFixed(2) : String(value.value)) : "");
  const n = text === "" ? null : kind === "AMT" ? parseToCents(text) : /^\d+(\.\d{0,2})?$/.test(text) ? Number(text) : null;
  const disc: Disc | undefined = n !== null && n > 0 ? { kind, value: n } : undefined;
  const cents = discCents(disc, baseCents);
  const tooBig = disc !== undefined && (kind === "PCT" ? disc.value > 100 : disc.value > baseCents);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>Off {formatCents(baseCents, currency)}</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="group" aria-label="Discount type">
        {([["PCT", "Percent %"], ["AMT", `Amount ${currency}`]] as const).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setText(""); }}
            className={cn("h-11 rounded-lg text-sm font-semibold", kind === k ? "bg-card shadow-card" : "text-muted-foreground")}>{label}</button>
        ))}
      </div>
      {kind === "PCT" && presets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <Button key={p} type="button" variant={disc?.value === p ? "default" : "outline"} size="lg" className="min-w-16 tabular-nums" onClick={() => setText(String(p))}>{p}%</Button>
          ))}
        </div>
      )}
      <Input inputMode="decimal" autoFocus value={text} onChange={(e) => setText(e.target.value)} aria-label="Discount value"
        placeholder={kind === "PCT" ? "e.g. 5" : "0.00"} className="h-14 text-center text-xl tabular-nums" />
      {tooBig && <p role="alert" className="text-sm text-danger">That is more than the amount.</p>}
      {disc && !tooBig && <p className="text-center text-sm font-medium text-success tabular-nums">Customer saves {formatCents(cents, currency)}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="xl" onClick={() => onApply(undefined)}>No discount</Button>
        <Button size="xl" disabled={tooBig || (text !== "" && n === null)} onClick={() => onApply(disc)}>Apply</Button>
      </div>
    </>
  );
}
