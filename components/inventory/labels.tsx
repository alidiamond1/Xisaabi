"use client";
import { useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import JsBarcode from "jsbarcode";
import { Field } from "@/components/common";
import { PrintArea } from "@/components/receipt";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { isValidGtin } from "@/convex/shared/barcode";
import { formatCents } from "@/convex/shared/money";
import { Segmented } from "./bits";

export type LabelProduct = { _id: string; name: string; priceCents: number; barcode?: string; sku?: string };
type Layout = "a4" | "roll";

/** EAN-13 / UPC-A / EAN-8 when the code is a valid GTIN, otherwise Code 128. */
function barcodeFormat(code: string): "EAN13" | "UPC" | "EAN8" | "CODE128" {
  if (isValidGtin(code)) {
    if (code.length === 13) return "EAN13";
    if (code.length === 12) return "UPC";
    if (code.length === 8) return "EAN8";
  }
  return "CODE128";
}

function BarcodeSvg({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      JsBarcode(el, value, { format: barcodeFormat(value), width: 2, height: 44, margin: 0, fontSize: 14, textMargin: 2, displayValue: true });
      el.setAttribute("width", "100%");
      el.removeAttribute("height");
    } catch {
      // Code 128 accepts any printable text; anything else is left blank
      el.replaceChildren();
    }
  }, [value]);
  return <svg ref={ref} role="img" aria-label={`Barcode ${value}`} className="block h-auto w-full" />;
}

function Label({ p, cur }: { p: LabelProduct; cur: string }) {
  const code = p.barcode || p.sku || "";
  return (
    <div className="label flex h-full min-w-0 flex-col justify-between overflow-hidden bg-white p-[2.5mm] text-black">
      <p className="line-clamp-2 text-[10px] font-semibold leading-tight">{p.name}</p>
      <p className="text-[13px] font-bold leading-none tabular-nums">{formatCents(p.priceCents, cur)}</p>
      {code ? <BarcodeSvg value={code} /> : <p className="text-[9px] italic">No barcode</p>}
    </div>
  );
}

/** Print dialog for barcode labels: A4 sheet (3 x 8) or a 58 mm thermal roll. */
export function LabelsDialog({ products, currency, onClose }: { products: LabelProduct[] | null; currency: string; onClose: () => void }) {
  const [layout, setLayout] = useState<Layout>("a4");
  const [copies, setCopies] = useState("1");
  const n = Math.min(100, Math.max(1, Math.floor(Number(copies)) || 1));
  const list = (products ?? []).flatMap((p) => Array.from({ length: n }, (_, i) => ({ p, key: `${p._id}-${i}` })));
  const missing = (products ?? []).filter((p) => !p.barcode && !p.sku).length;
  const roll = layout === "roll";

  return (
    <Dialog open={!!products} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display">Print labels</DialogTitle>
          <DialogDescription>{products?.length ?? 0} product{products?.length === 1 ? "" : "s"}, {list.length} label{list.length === 1 ? "" : "s"}. Generate barcodes first for products without one.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Segmented<Layout> label="Paper" value={layout} onChange={setLayout} options={[{ value: "a4", label: "A4 sheet (3 x 8)" }, { value: "roll", label: "58 mm roll" }]} />
          <Field label="Copies of each label"><Input type="number" inputMode="numeric" min={1} max={100} value={copies} onChange={(e) => setCopies(e.target.value)} className="w-28 tabular-nums" /></Field>
          {missing > 0 && <p role="status" className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">{missing} selected product{missing === 1 ? " has" : "s have"} no barcode or SKU and will print without one.</p>}
          <div className="max-h-64 overflow-y-auto rounded-xl border bg-muted/50 p-3" aria-label="Preview">
            <div className={roll ? "mx-auto grid w-[58mm] gap-2" : "grid grid-cols-3 gap-2"}>
              {list.slice(0, 12).map(({ p, key }) => (
                <div key={key} className={roll ? "h-[30mm]" : "aspect-[70/37]"}><div className="size-full overflow-hidden rounded-md border bg-white"><Label p={p} cur={currency} /></div></div>
              ))}
            </div>
            {list.length > 12 && <p className="mt-2 text-center text-xs text-muted-foreground">Preview shows the first 12 labels.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="lg" onClick={onClose}>Close</Button>
          <Button size="lg" disabled={!list.length} onClick={() => window.print()}><Printer />Print</Button>
        </DialogFooter>
        {products && (
          <PrintArea paper="a4">
            <style>{roll
              ? "@media print { @page { size: 58mm 30mm; margin: 0; } #receipt-print { width: 58mm !important; } #receipt-print .lbl { width: 58mm; height: 30mm; break-after: page; overflow: hidden; } }"
              : "@media print { @page { size: A4; margin: 0; } #receipt-print { width: 210mm !important; } #receipt-print .sheet { display: grid; grid-template-columns: repeat(3, 70mm); grid-auto-rows: 37.125mm; } #receipt-print .lbl { width: 70mm; height: 37.125mm; overflow: hidden; break-inside: avoid; } }"}</style>
            <div className="sheet">
              {list.map(({ p, key }) => <div key={key} className="lbl"><Label p={p} cur={currency} /></div>)}
            </div>
          </PrintArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
