"use client";
import { useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { CheckCircle2, Download, FileUp } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Banner, Pill, SubmitButton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ERROR_MESSAGES, type ErrorCode } from "@/convex/shared/errors";
import { parseToCents } from "@/convex/shared/money";
import { downloadCsv, parseCsv } from "@/lib/csv";
import { errorMessage } from "@/convex/shared/errors";
import { toast } from "sonner";
import { parseQty } from "./bits";

export const CSV_HEADERS = ["Name", "SKU", "Barcode", "Category", "Brand", "Unit", "Cost", "Price", "Wholesale price", "Stock", "Reorder level"];

const ALIASES: Record<string, string> = {
  name: "name", product: "name", productname: "name", sku: "sku", barcode: "barcode", category: "category", brand: "brand", unit: "unit",
  cost: "cost", costprice: "cost", price: "price", sellingprice: "price", saleprice: "price", wholesale: "wholesale", wholesaleprice: "wholesale",
  stock: "stock", qty: "stock", quantity: "stock", openingstock: "stock", reorder: "reorder", reorderlevel: "reorder", minimum: "reorder",
};

type Parsed = {
  line: number; errors: string[];
  row: { name: string; sku: string; barcode: string; category: string; brand: string; unit: string; costCents: number; priceCents: number; wholesalePriceCents?: number; stock: number; reorderLevel: number };
};

const money = (s: string) => parseToCents(s.replace(/[\s$,]/g, ""));

function parseRows(text: string): { rows: Parsed[]; missing: string[] } {
  const data = parseCsv(text);
  if (data.length === 0) return { rows: [], missing: [] };
  const head = data[0].map((h) => ALIASES[h.toLowerCase().replace(/[^a-z]/g, "")] ?? "");
  const col = (name: string) => head.indexOf(name);
  const missing = ["name", "price"].filter((n) => col(n) < 0);
  if (missing.length) return { rows: [], missing };
  const rows = data.slice(1).map((r, i): Parsed => {
    const get = (n: string) => (col(n) >= 0 ? (r[col(n)] ?? "").trim() : "");
    const errors: string[] = [];
    const name = get("name");
    if (!name) errors.push("Name is empty");
    const price = money(get("price"));
    if (price === null) errors.push("Price is not a number");
    const costS = get("cost");
    const cost = costS ? money(costS) : 0;
    if (cost === null) errors.push("Cost is not a number");
    const wS = get("wholesale");
    const wholesale = wS ? money(wS) : undefined;
    if (wholesale === null) errors.push("Wholesale price is not a number");
    const stockS = get("stock");
    const stock = stockS ? parseQty(stockS) : 0;
    if (stock === null) errors.push("Stock is not a number");
    const reS = get("reorder");
    const reorder = reS ? parseQty(reS) : 0;
    if (reorder === null) errors.push("Reorder level is not a number");
    return {
      line: i + 2, errors,
      row: {
        name, sku: get("sku"), barcode: get("barcode"), category: get("category"), brand: get("brand"), unit: get("unit") || "pcs",
        costCents: cost ?? 0, priceCents: price ?? 0, wholesalePriceCents: wholesale ?? undefined, stock: stock ?? 0, reorderLevel: reorder ?? 0,
      },
    };
  });
  return { rows, missing: [] };
}

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const importCsv = useMutation(api.products.importCsv);
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: { line: number; reason: string }[] } | null>(null);
  const parsed = useMemo(() => parseRows(text), [text]);
  const good = parsed.rows.filter((r) => r.errors.length === 0);
  const bad = parsed.rows.length - good.length;

  function close(o: boolean) {
    onOpenChange(o);
    if (!o) { setText(""); setResult(null); }
  }

  async function start() {
    setBusy(true);
    let created = 0;
    const skipped: { line: number; reason: string }[] = [];
    try {
      for (let i = 0; i < good.length; i += 500) {
        const chunk = good.slice(i, i + 500);
        const r = await importCsv({ rows: chunk.map((c) => c.row) });
        created += r.created;
        for (const s of r.skipped) skipped.push({ line: chunk[s.row - 1]?.line ?? s.row, reason: ERROR_MESSAGES[s.reason as ErrorCode] ?? s.reason });
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
    for (const b of parsed.rows) if (b.errors.length) skipped.push({ line: b.line, reason: b.errors.join(", ") });
    skipped.sort((a, b) => a.line - b.line);
    setResult({ created, skipped });
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import products from CSV</DialogTitle>
          <DialogDescription>Upload a file or paste rows. Needed columns: Name and Price. New categories are created for you.</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <Banner tone={result.created ? "success" : "warning"} icon={CheckCircle2}>
              {result.created} product{result.created === 1 ? "" : "s"} added{result.skipped.length > 0 && `, ${result.skipped.length} skipped`}.
            </Banner>
            {result.skipped.length > 0 && (
              <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border text-sm">
                {result.skipped.map((s) => <li key={s.line} className="flex gap-3 px-3 py-2"><span className="w-16 shrink-0 text-muted-foreground">Row {s.line}</span><span>{s.reason}</span></li>)}
              </ul>
            )}
            <DialogFooter><Button onClick={() => close(false)}>Done</Button></DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="lg" onClick={() => file.current?.click()}><FileUp />Choose CSV file</Button>
              <Button variant="ghost" size="lg" onClick={() => downloadCsv("products-template.csv", [CSV_HEADERS, ["Sugar 1kg", "SG-1", "6001234567890", "Groceries", "", "pcs", "1.20", "1.50", "1.40", "50", "10"]])}><Download />Download template</Button>
              <input ref={file} type="file" accept=".csv,text/csv,text/plain" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = ""; }} />
            </div>
            <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={`${CSV_HEADERS.join(",")}\nSugar 1kg,SG-1,6001234567890,Groceries,,pcs,1.20,1.50,1.40,50,10`} className="font-mono text-xs" aria-label="CSV text" />
            {parsed.missing.length > 0 && <Banner tone="danger">The first row must name the columns. Missing: {parsed.missing.join(", ")}.</Banner>}
            {parsed.rows.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Pill tone="green">{good.length} ready</Pill>{bad > 0 && <Pill tone="red">{bad} with problems (will be skipped)</Pill>}
                </div>
                <div className="max-h-64 overflow-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                      <tr><th className="px-3 py-2 text-left">Row</th><th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">Category</th><th className="px-3 py-2 text-right">Price</th><th className="px-3 py-2 text-right">Stock</th><th className="px-3 py-2 text-left">Check</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {parsed.rows.slice(0, 100).map((r) => (
                        <tr key={r.line} className={r.errors.length ? "bg-danger-soft" : undefined}>
                          <td className="px-3 py-1.5 text-muted-foreground">{r.line}</td><td className="px-3 py-1.5">{r.row.name || "-"}</td><td className="px-3 py-1.5">{r.row.category || "-"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{(r.row.priceCents / 100).toFixed(2)}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.row.stock}</td>
                          <td className="px-3 py-1.5 text-danger">{r.errors.join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {parsed.rows.length > 100 && <p className="text-xs text-muted-foreground">Showing the first 100 of {parsed.rows.length} rows. All valid rows will be imported.</p>}
              </>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
              <SubmitButton busy={busy} disabled={good.length === 0} onClick={start}>Import {good.length || ""} product{good.length === 1 ? "" : "s"}</SubmitButton>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
