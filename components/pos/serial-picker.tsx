"use client";
import { useEffect, useState } from "react";
import { useConvex, useQuery } from "convex/react";
import { Check, ScanBarcode, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { CatalogItem } from "@/lib/outbox";
import { cn } from "@/lib/utils";

/** Choose which IMEI / serial numbers are being sold: type or scan one, or tick from the units in stock. */
export function SerialPicker({ item, selected, onApply, onClose }: {
  item: CatalogItem | null; selected: string[]; onApply: (serials: string[]) => void; onClose: () => void;
}) {
  const convex = useConvex();
  const avail = useQuery(api.serials.available, item ? { productId: item._id } : "skip");
  const [pick, setPick] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => { if (item) { setPick(selected); setText(""); setMsg(""); } }, [item]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (s: string) => setPick((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  const q = text.replace(/\s+/g, "").toUpperCase();
  const shown = (avail ?? []).filter((s) => !q || s.serial.includes(q));

  async function typed() {
    if (!q || !item) return;
    setMsg("");
    if (pick.includes(q)) { setText(""); return; }
    let ok = avail?.some((s) => s.serial === q) ?? false;
    if (!ok && (avail?.length ?? 0) >= 200) {
      // the list is capped at 200: ask the server about this exact number
      const r = await convex.query(api.serials.lookup, { serial: q }).catch(() => null);
      ok = !!r && r.serial.status === "IN_STOCK" && r.product?._id === item._id;
    }
    if (!ok) return void setMsg(`${q} is not in stock for ${item.name}.`);
    setPick((p) => [...p, q]);
    setText("");
  }

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92dvh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item?.name}</DialogTitle>
          <DialogDescription>Scan or type each IMEI / serial number you are selling.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <ScanBarcode className="absolute left-3.5 top-3.5 size-5 text-muted-foreground" />
          <Input autoFocus value={text} onChange={(e) => { setText(e.target.value); setMsg(""); }} placeholder="Scan or type IMEI, then Enter" aria-label="IMEI or serial number"
            className="h-12 pl-11 font-mono text-base tabular-nums" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); typed(); } }} />
        </div>
        {msg && <p role="alert" className="text-sm text-danger">{msg}</p>}
        {pick.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Chosen">
            {pick.map((s) => (
              <li key={s} className="inline-flex h-9 items-center gap-1 rounded-full bg-brand-100 pl-3 pr-1 font-mono text-xs tabular-nums text-brand-800">
                {s}<button type="button" aria-label={`Remove ${s}`} onClick={() => toggle(s)} className="grid size-7 place-items-center rounded-full hover:bg-brand-200"><X className="size-4" /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border">
          {avail === undefined ? <div className="space-y-2 p-3"><Skeleton className="h-11" /><Skeleton className="h-11" /></div> : avail.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No units in stock. Receive stock with IMEI numbers first.</p>
          ) : shown.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No match. Press Enter to check this exact number.</p>
          ) : (
            <ul className="divide-y">
              {shown.map((s) => {
                const on = pick.includes(s.serial);
                return (
                  <li key={s._id}>
                    <button type="button" aria-pressed={on} onClick={() => toggle(s.serial)} className={cn("flex min-h-12 w-full items-center gap-3 px-3 text-left active:bg-muted", on && "bg-brand-50")}>
                      <span className={cn("grid size-6 shrink-0 place-items-center rounded-md border", on ? "border-brand-600 bg-brand-600 text-white" : "bg-card")}>{on && <Check className="size-4" />}</span>
                      <span className="font-mono text-sm tabular-nums">{s.serial}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <Button size="xl" onClick={() => onApply(pick)} disabled={pick.length === 0 && selected.length === 0}>
          {pick.length === 0 ? "Remove from sale" : `Sell ${pick.length} unit${pick.length === 1 ? "" : "s"}`}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
