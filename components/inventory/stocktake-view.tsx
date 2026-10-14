"use client";
import { useMemo, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CheckCircle2, ClipboardCheck, ScanLine } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Banner, Col, ConfirmDialog, DataTable, EmptyState, Money, PageHeader, Panel, SearchInput, Stat, Toolbar } from "@/components/common";
import { useBiz } from "@/components/guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanDialog } from "@/components/scanner/camera-scanner";
import { PhoneScannerButton } from "@/components/scanner/phone-pair";
import { toast } from "sonner";
import { formatCents } from "@/convex/shared/money";
import { hasPermission } from "@/convex/shared/permissions";
import { run } from "@/lib/run";
import { NativeSelect, PrintButton, PrintSheet, expiryMs, fmtQty, parseQty } from "./bits";
import { categoryOptions } from "./pickers";
import { Thumb } from "./products-view";

type Row = FunctionReturnType<typeof api.products.list>[number];

export function StocktakeView() {
  const me = useBiz();
  const cur = me.business.currency;
  const seeCost = hasPermission(me.member, "seeCost");
  const canAdjust = hasPermission(me.member, "adjustStock");
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [showErr, setShowErr] = useState(false);
  const [result, setResult] = useState<{ adjusted: number; varianceValueCents: number } | null>(null);
  const cats = useQuery(api.categories.list);
  const all = useQuery(api.products.list, { categoryId: cat ? (cat as Id<"categories">) : undefined });
  const stocktake = useMutation(api.inventory.stocktake);
  const convex = useConvex();
  const [scanOpen, setScanOpen] = useState(false);
  const [lastScan, setLastScan] = useState("");

  const rows = useMemo(() => all?.filter((p) => p.type === "STOCKABLE" && !p.hasVariants), [all]);
  const needle = q.trim().toLowerCase();
  const shown = rows?.filter((p) => !needle || `${p.name} ${p.variantLabel ?? ""} ${p.sku} ${p.barcode}`.toLowerCase().includes(needle));

  const entered = (rows ?? []).flatMap((p) => {
    const raw = counts[p._id];
    if (raw === undefined || raw.trim() === "") return [];
    return [{ p, n: parseQty(raw) }];
  });
  const invalid = (p: Row, n: number | null) => n === null || (!p.allowDecimal && !Number.isInteger(n));
  const needsExpiry = (p: Row, n: number | null) => p.trackExpiry && n !== null && n > p.stock && !expiries[p._id];
  const problems = entered.filter((e) => invalid(e.p, e.n) || needsExpiry(e.p, e.n)).length;
  const changed = entered.filter((e) => e.n !== null && Math.abs(e.n - e.p.stock) > 1e-9);
  const varianceValue = changed.reduce((s, e) => s + Math.round((e.n! - e.p.stock) * (e.p.costCents ?? 0)), 0);

  /** Camera / phone scan: +1 counted (+pack size for a pack barcode). */
  async function scanCount(code: string) {
    const res = await run(convex.query(api.catalog.lookup, { code }));
    if (!res) return;
    const hit = res.local && rows?.find((p) => p._id === res.local!.product._id);
    if (!hit) { toast.error(res.local ? `${res.local.product.name} is not in this count.` : `No product found for ${code}.`); return; }
    const add = res.local!.unit?.factor ?? 1;
    setCounts((c) => ({ ...c, [hit._id]: String(Math.round(((parseQty(c[hit._id] ?? "") ?? 0) + add) * 1000) / 1000) }));
    setLastScan(`${hit.name} +${add}`);
  }

  function apply() {
    if (problems) { setShowErr(true); return; }
    setConfirm(true);
  }
  async function submit() {
    const r = await run(stocktake({
      counts: changed.map((e) => ({
        productId: e.p._id, counted: e.n!,
        batch: e.p.trackExpiry && e.n! > e.p.stock ? { batchNo: "COUNT", expiryDate: expiryMs(expiries[e.p._id]) } : undefined,
      })),
      note: "Stocktake",
    }));
    if (r) { setResult(r); setCounts({}); setExpiries({}); setShowErr(false); }
  }

  const cols: Col<Row>[] = [
    {
      header: "Product",
      cell: (p) => (
        <div className="flex items-center gap-3">
          <Thumb url={p.imageUrl} />
          <div className="min-w-0"><p className="truncate font-medium">{p.name}</p><p className="truncate text-xs text-muted-foreground">{[p.variantLabel, p.sku || p.barcode].filter(Boolean).join(" · ")}</p></div>
        </div>
      ),
    },
    { header: "In system", className: "text-right", cell: (p) => <span className="tabular-nums">{fmtQty(p.stock)} <span className="text-muted-foreground">{p.unit}</span></span> },
    {
      header: "Counted", className: "w-44",
      cell: (p) => {
        const raw = counts[p._id] ?? "";
        const n = raw.trim() === "" ? null : parseQty(raw);
        const bad = raw.trim() !== "" && invalid(p, n);
        return (
          <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
            <Input inputMode={p.allowDecimal ? "decimal" : "numeric"} aria-label={`Counted ${p.name}`} value={raw} placeholder="Not counted" disabled={!canAdjust}
              onChange={(e) => setCounts((c) => ({ ...c, [p._id]: e.target.value }))} aria-invalid={bad} className="h-11 text-right tabular-nums md:h-10" />
            {bad && <p role="alert" className="text-xs text-danger">{p.allowDecimal ? "Enter a number." : "Whole numbers only."}</p>}
            {p.trackExpiry && n !== null && n > p.stock && (
              <div>
                <Input type="date" aria-label={`Expiry of extra ${p.name}`} value={expiries[p._id] ?? ""} onChange={(e) => setExpiries((x) => ({ ...x, [p._id]: e.target.value }))} aria-invalid={showErr && !expiries[p._id]} />
                <p className={`mt-1 text-xs ${showErr && !expiries[p._id] ? "text-danger" : "text-muted-foreground"}`}>Expiry of the extra units</p>
              </div>
            )}
          </div>
        );
      },
    },
    {
      header: "Difference", className: "text-right",
      cell: (p) => {
        const raw = counts[p._id];
        const n = raw === undefined || raw.trim() === "" ? null : parseQty(raw);
        if (n === null) return <span className="text-muted-foreground">-</span>;
        const d = Math.round((n - p.stock) * 1000) / 1000;
        return <Money cents={d} className="font-medium">{d > 0 ? "+" : ""}{fmtQty(d)}</Money>;
      },
    },
  ];

  if (!canAdjust) {
    return (<><PageHeader title="Stocktake" /><Panel><EmptyState icon={ClipboardCheck} title="You can't adjust stock" desc="Ask the owner for the Adjust stock permission to count stock." /></Panel></>);
  }

  return (
    <>
      <PageHeader title="Stocktake" desc="Count what is on the shelf, enter it, and XisabSax fixes the stock for you. Leave a row blank to skip it."
        actions={<><PrintButton label="Print count sheet" /><Button size="lg" disabled={entered.length === 0} onClick={apply}>Apply count{changed.length ? ` (${changed.length})` : ""}</Button></>} />
      {result && (
        <div className="mb-4 space-y-3">
          <Banner tone="success" icon={CheckCircle2}>
            Stocktake done. {result.adjusted === 0 ? "Everything matched, nothing to fix." : `${result.adjusted} product${result.adjusted === 1 ? "" : "s"} adjusted.`}
          </Banner>
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <Stat label="Adjusted" value={result.adjusted} sub="products" />
            {seeCost && <Stat label="Value difference" value={formatCents(result.varianceValueCents, cur)} tone={result.varianceValueCents < 0 ? "text-danger" : result.varianceValueCents > 0 ? "text-success" : undefined} sub="at cost" />}
          </div>
        </div>
      )}
      {showErr && problems > 0 && <div className="mb-4"><Banner tone="danger">{problems} row{problems === 1 ? " needs" : "s need"} attention before you can apply.</Banner></div>}
      <Panel>
        <Toolbar actions={
          <>
            {entered.length > 0 && seeCost && <span className="text-sm text-muted-foreground">Difference at cost: <Money cents={varianceValue} className="font-semibold">{formatCents(varianceValue, cur)}</Money></span>}
            <Button onClick={() => setScanOpen(true)}><ScanLine />Scan to count</Button>
            <PhoneScannerButton target="STOCKTAKE" label="Phone scanner" onScan={(code) => void scanCount(code)} />
          </>
        }>
          <NativeSelect aria-label="Category" className="w-auto max-w-56" value={cat} onChange={(v) => { setCat(v); setCounts({}); setExpiries({}); }} placeholder="All categories" options={categoryOptions(cats)} />
          <SearchInput value={q} onChange={setQ} placeholder="Find a product" />
        </Toolbar>
        <DataTable rows={shown} cols={cols} pageSize={50}
          empty={<EmptyState icon={ClipboardCheck} title="No products to count" desc="Add stockable products first, or pick another category." />} />
      </Panel>
      <ScanDialog open={scanOpen} onOpenChange={setScanOpen} continuous title="Scan to count" onScan={(r) => void scanCount(r.code)}>
        <p className="text-sm text-muted-foreground" aria-live="polite">{lastScan ? `Counted: ${lastScan}` : "Each scan adds 1 to the counted quantity."}</p>
      </ScanDialog>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} destructive={false} confirmLabel="Apply count" title="Apply this count?"
        desc={`${changed.length} product${changed.length === 1 ? "" : "s"} will change to the counted quantity${seeCost ? ` (${formatCents(varianceValue, cur)} at cost)` : ""}. This is recorded in Stock moves.`}
        onConfirm={submit} />
      <PrintSheet title="Stock count sheet" sub={`${cat ? cats?.find((c) => c._id === cat)?.name : "All categories"} · ${new Date().toLocaleDateString()}`}>
        <table>
          <thead><tr><th>Product</th><th>SKU / barcode</th><th className="num">In system</th><th className="num" style={{ width: "25%" }}>Counted</th></tr></thead>
          <tbody>
            {(rows ?? []).map((p) => (
              <tr key={p._id}><td>{p.name}{p.variantLabel ? ` (${p.variantLabel})` : ""}</td><td>{p.sku || p.barcode}</td><td className="num">{fmtQty(p.stock)} {p.unit}</td><td />
              </tr>
            ))}
          </tbody>
        </table>
      </PrintSheet>
    </>
  );
}
