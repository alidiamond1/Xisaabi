"use client";
import { useCallback, useEffect, useState } from "react";
import { Play, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCents } from "@/convex/shared/money";
import { fmtQty, totals, type CartSnapshot } from "@/lib/cart";
import { fmtDateTime } from "@/lib/session";

export type Held = CartSnapshot & { id: string; heldAt: number };

// Parked orders live in this browser only (localStorage), per business.
const CHANGED = "dukaan-held-changed";
function read(key: string): Held[] {
  try { return JSON.parse(localStorage.getItem(key) ?? "[]") as Held[]; } catch { return []; }
}
function write(key: string, list: Held[]) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* private mode: held orders just won't persist */ }
  window.dispatchEvent(new Event(CHANGED));
}

export function useHeld(businessId: string) {
  const key = `dukaan-held-${businessId}`;
  const [list, setList] = useState<Held[]>([]);
  useEffect(() => {
    const sync = () => setList(read(key));
    sync();
    window.addEventListener(CHANGED, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(CHANGED, sync); window.removeEventListener("storage", sync); };
  }, [key]);
  const hold = useCallback((s: CartSnapshot) => write(key, [{ ...s, id: crypto.randomUUID(), heldAt: Date.now() }, ...read(key)].slice(0, 30)), [key]);
  const drop = useCallback((id: string) => write(key, read(key).filter((h) => h.id !== id)), [key]);
  return { list, hold, drop };
}

export function HeldOrdersDialog({ open, onClose, list, currency, taxRate, onResume, onDelete }: {
  open: boolean; onClose: () => void; list: Held[]; currency: string; taxRate: number; onResume: (h: Held) => void; onDelete: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Held orders</DialogTitle>
          <DialogDescription>Parked sales. Resume one to continue it.</DialogDescription>
        </DialogHeader>
        {list.length === 0 ? <EmptyState title="Nothing on hold" desc="Tap Hold on the cart to park a sale while you serve someone else." /> : (
          <ul className="divide-y rounded-xl border">
            {list.map((h) => {
              const t = totals(h.lines, h.orderDisc, taxRate, h.customer?.group === "WHOLESALE");
              const n = h.lines.reduce((s, l) => s + l.qty, 0);
              return (
                <li key={h.id} className="flex items-center gap-2 p-3">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-medium">{h.customer?.name ?? (h.note || `${h.lines.length} item${h.lines.length === 1 ? "" : "s"}`)}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">{fmtDateTime(h.heldAt)} · {fmtQty(n)} items · {formatCents(t.totalCents, currency)}</p>
                  </div>
                  <Button size="lg" onClick={() => onResume(h)}><Play /> Resume</Button>
                  <Button size="icon-lg" variant="ghost" aria-label="Delete held order" className="text-muted-foreground hover:text-danger" onClick={() => onDelete(h.id)}><Trash2 /></Button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
