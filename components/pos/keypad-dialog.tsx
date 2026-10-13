"use client";
import { useState } from "react";
import { Delete } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Big numeric keypad for weight / length. Value stays a string so "1." and "0.50" type naturally. */
export function KeypadDialog({ open, title, unit, initial, presets = [0.25, 0.5, 1, 2], onClose, onApply }: {
  open: boolean; title: string; unit: string; initial?: number; presets?: number[]; onClose: () => void; onApply: (qty: number) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xs">
        {open && <Pad key={String(initial)} title={title} unit={unit} initial={initial} presets={presets} onApply={onApply} />}
      </DialogContent>
    </Dialog>
  );
}

function Pad({ title, unit, initial, presets, onApply }: { title: string; unit: string; initial?: number; presets: number[]; onApply: (q: number) => void }) {
  const [v, setV] = useState("");
  const press = (k: string) => setV((s) => {
    if (k === ".") return s.includes(".") ? s : (s || "0") + ".";
    if (s.includes(".") && s.split(".")[1].length >= 3) return s; // 3 decimals, like the server
    return s === "0" ? k : s + k;
  });
  const n = Number(v);
  const ok = v !== "" && n > 0 && n <= 100000;
  return (
    <>
      <DialogHeader>
        <DialogTitle className="truncate pr-6">{title}</DialogTitle>
        <DialogDescription>{initial ? `Now ${initial} ${unit}. ` : ""}Enter amount in {unit}.</DialogDescription>
      </DialogHeader>
      <div className="rounded-xl border bg-muted/40 px-4 py-3 text-right font-display text-4xl font-semibold tabular-nums" aria-live="polite">
        {v || "0"}<span className="ml-1.5 text-base font-medium text-muted-foreground">{unit}</span>
      </div>
      <div className="flex gap-2">
        {presets.map((p) => <Button key={p} type="button" variant="outline" size="lg" className="flex-1 tabular-nums" onClick={() => setV(String(p))}>{p}</Button>)}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0"].map((k) => (
          <Button key={k} type="button" variant="outline" className="h-14 text-xl tabular-nums" onClick={() => press(k)}>{k}</Button>
        ))}
        <Button type="button" variant="outline" className="h-14" aria-label="Delete" onClick={() => setV((s) => s.slice(0, -1))}><Delete className="size-5" /></Button>
      </div>
      <Button size="xl" disabled={!ok} onClick={() => onApply(n)}>Set {ok ? `${n} ${unit}` : "amount"}</Button>
    </>
  );
}
