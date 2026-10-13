"use client";
import { Package } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fmtQty } from "@/lib/cart";
import type { CatalogItem } from "@/lib/outbox";
import { packPrice } from "@/lib/packs";

export type PackChoice = CatalogItem["units"][number];

/** Retail or wholesale price of a pack (same rule as the server). */
export function packCents(p: CatalogItem, u: PackChoice, wholesale: boolean) {
  const base = wholesale && p.wholesalePriceCents !== undefined ? p.wholesalePriceCents : p.priceCents;
  return packPrice(u, base);
}

/** "How do you want to sell it?" Base unit first, then each pack with its price. */
export function UnitSheet({ item, wholesale, m, onPick, onClose }: {
  item: CatalogItem | null; wholesale: boolean; m: (c: number) => string; onPick: (u: PackChoice | null) => void; onClose: () => void;
}) {
  const basePrice = item ? (wholesale && item.wholesalePriceCents !== undefined ? item.wholesalePriceCents : item.priceCents) : 0;
  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="mx-auto max-w-lg gap-0 rounded-t-2xl p-0">
        <SheetHeader className="border-b">
          <SheetTitle className="font-display text-lg">{item?.name}</SheetTitle>
          <SheetDescription>Sell it by:</SheetDescription>
        </SheetHeader>
        {item && (
          <ul className="max-h-[60dvh] space-y-2 overflow-y-auto p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Choice label={item.unit} sub={item.allowDecimal ? "enter the amount next" : "one at a time"} price={m(basePrice)} onClick={() => onPick(null)} />
            {item.units.map((u) => (
              <Choice key={u.name} label={u.name} sub={`${fmtQty(u.factor)} ${item.unit}`} price={m(packCents(item, u, wholesale))} onClick={() => onPick(u)} />
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Choice({ label, sub, price, onClick }: { label: string; sub: string; price: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick}
        className="flex min-h-16 w-full items-center gap-3 rounded-xl border bg-card p-3 text-left shadow-card transition-[transform,border-color] duration-100 hover:border-brand-300 active:scale-[0.98]">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Package className="size-5" /></span>
        <span className="min-w-0 flex-1"><span className="block text-base font-semibold">{label}</span><span className="block text-xs text-muted-foreground">{sub}</span></span>
        <span className="font-display text-lg font-semibold tabular-nums text-brand-700">{price}</span>
      </button>
    </li>
  );
}
