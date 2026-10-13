"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Barcode, Download, Package, Plus, ScanLine, SlidersHorizontal, Tags, Upload } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Col, DataTable, EmptyState, FilterChips, PageHeader, Panel, Pill, SearchInput, Toolbar } from "@/components/common";
import { useBiz } from "@/components/guard";
import { Button } from "@/components/ui/button";
import { PhoneScannerButton } from "@/components/scanner/phone-pair";
import type { ScanResult } from "@/components/scanner/camera-scanner";
import { formatCents } from "@/convex/shared/money";
import { hasPermission } from "@/convex/shared/permissions";
import { downloadCsv } from "@/lib/csv";
import { useAttributeDefs, useFeature } from "@/lib/features";
import { toast } from "sonner";
import { run } from "@/lib/run";
import { AdjustStockDialog, type AdjustTarget } from "./adjust-dialog";
import { NativeSelect, fmtQty, useDebounced } from "./bits";
import { ImportDialog, CSV_HEADERS } from "./import-dialog";
import { LabelsDialog, type LabelProduct } from "./labels";
import { ScanAdd, ScanAddSheet } from "./scan-add";
import { categoryOptions } from "./pickers";

type Row = FunctionReturnType<typeof api.products.list>[number];
type Status = "ALL" | "LOW" | "OUT" | "EXPIRING" | "ARCHIVED";

const STATUS: { value: Status; label: string }[] = [
  { value: "ALL", label: "All" }, { value: "LOW", label: "Low" }, { value: "OUT", label: "Out" },
  { value: "EXPIRING", label: "Expiring" }, { value: "ARCHIVED", label: "Archived" },
];

export function StatusBadges({ p }: { p: Pick<Row, "type" | "stock" | "reorderLevel" | "isArchived" | "hasVariants" | "expiryStatus"> }) {
  const stocked = p.type === "STOCKABLE" && !p.hasVariants;
  return (
    <div className="flex flex-wrap gap-1">
      {p.isArchived && <Pill tone="slate">Archived</Pill>}
      {p.type !== "STOCKABLE" && <Pill tone="slate">{p.type === "SERVICE" ? "Service" : "Consumable"}</Pill>}
      {p.hasVariants && <Pill tone="blue">Variants</Pill>}
      {stocked && p.stock <= 0 && <Pill tone="red">Out</Pill>}
      {stocked && p.stock > 0 && p.stock <= p.reorderLevel && <Pill tone="amber">Low</Pill>}
      {p.expiryStatus === "EXPIRED" && <Pill tone="red">Expired</Pill>}
      {(p.expiryStatus === "1_MONTH" || p.expiryStatus === "3_MONTHS") && <Pill tone="amber">Expiring</Pill>}
    </div>
  );
}

export function Thumb({ url, size = "size-10" }: { url?: string | null; size?: string }) {
  return (
    <span className={`grid ${size} shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" className="size-full object-cover" loading="lazy" /> : <Package className="size-4" />}
    </span>
  );
}

export function ProductsView() {
  const me = useBiz();
  const router = useRouter();
  const convex = useConvex();
  const cur = me.business.currency;
  const seeCost = hasPermission(me.member, "seeCost");
  const canAdjust = hasPermission(me.member, "adjustStock");
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim());
  const [status, setStatus] = useState<Status>("ALL");
  const [type, setType] = useState("");
  const [cat, setCat] = useState("");
  const attrsOn = useFeature("attributes");
  const defs = useAttributeDefs();
  const searchableAttrs = defs.filter((d) => d.searchable).map((d) => d.label.toLowerCase());
  const attrCol = attrsOn ? defs.find((d) => d.searchable) : undefined; // one extra column: the main searchable field
  const [adjust, setAdjust] = useState<AdjustTarget | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [phoneScan, setPhoneScan] = useState<ScanResult | null>(null);
  const [labels, setLabels] = useState<LabelProduct[] | null>(null);
  const generateMissing = useMutation(api.barcodes.generateMissing);
  const [generating, setGenerating] = useState(false);
  const cats = useQuery(api.categories.list);
  const rows = useQuery(api.products.list, {
    search: search || undefined,
    categoryId: cat ? (cat as Id<"categories">) : undefined,
    type: type ? (type as "STOCKABLE" | "CONSUMABLE" | "SERVICE") : undefined,
    filter: status === "ALL" ? undefined : status,
  });
  const filtered = status !== "ALL" || search || type || cat;

  async function genBarcodes() {
    setGenerating(true);
    const r = await run(generateMissing({}));
    setGenerating(false);
    if (r) toast.success(r.count ? `Made ${r.count} barcode${r.count === 1 ? "" : "s"}. Print labels to stick them on.` : "Every product already has a barcode.");
  }

  async function exportCsv() {
    setExporting(true);
    const data = await run(convex.query(api.products.exportCsv, {}));
    setExporting(false);
    if (!data) return;
    const d = (c: number | null | undefined) => (c === null || c === undefined ? "" : (c / 100).toFixed(2));
    downloadCsv("products.csv", [CSV_HEADERS, ...data.map((r) => [r.name, r.sku, r.barcode, r.category, r.brand, r.unit, d(r.costCents), d(r.priceCents), d(r.wholesalePriceCents), r.stock, r.reorderLevel])]);
  }

  const cols: Col<Row>[] = [
    {
      header: "Product",
      cell: (p) => (
        <div className="flex items-center gap-3">
          <Thumb url={p.imageUrl} />
          <div className="min-w-0">
            <p className="truncate font-medium">{p.name}</p>
            {p.variantLabel && <p className="truncate text-xs text-muted-foreground">{p.variantLabel}</p>}
          </div>
        </div>
      ),
    },
    { header: "SKU / barcode", cell: (p) => <span className="text-muted-foreground tabular-nums">{p.sku || p.barcode || "-"}</span> },
    ...(attrCol ? [{ header: attrCol.label, cell: (p: Row) => p.attrs?.[attrCol.key] ?? <span className="text-muted-foreground">-</span> }] : []),
    { header: "Category", cell: (p) => p.categoryName ?? <span className="text-muted-foreground">-</span> },
    { header: "Price", className: "text-right", cell: (p) => <span className="tabular-nums">{p.hasVariants ? <span className="text-muted-foreground">Varies</span> : formatCents(p.priceCents, cur)}</span> },
    ...(seeCost ? [{ header: "Cost", className: "text-right", cell: (p: Row) => <span className="tabular-nums text-muted-foreground">{p.hasVariants || p.costCents === undefined ? "-" : formatCents(p.costCents, cur)}</span> }] : []),
    {
      header: "Stock", className: "text-right",
      cell: (p) => p.type !== "STOCKABLE" || p.hasVariants ? <span className="text-muted-foreground">-</span> : <span className="tabular-nums">{fmtQty(p.stock)} <span className="text-muted-foreground">{p.unit}</span></span>,
    },
    { header: "Status", cell: (p) => <StatusBadges p={p} /> },
    {
      header: "",
      cell: (p) => canAdjust && p.type === "STOCKABLE" && !p.hasVariants && !p.isArchived ? (
        <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={(e) => { e.stopPropagation(); setAdjust(p); }}>
          <SlidersHorizontal />Adjust
        </Button>
      ) : null,
    },
  ];

  return (
    <>
      <PageHeader title="Products" desc="Your catalog and stock levels." actions={<Button size="lg" asChild><Link href="/apps/inventory/new"><Plus />New product</Link></Button>} />
      <Panel>
        <Toolbar actions={
          <>
            {canAdjust && <Button onClick={() => setScanning(true)}><ScanLine />Scan</Button>}
            {canAdjust && <PhoneScannerButton target="PRODUCTS" label="Phone scanner" onScan={(code) => setPhoneScan({ code, format: "phone" })} />}
            {canAdjust && <Button variant="outline" disabled={generating} onClick={genBarcodes}><Barcode /><span className="hidden lg:inline">Generate barcodes</span><span className="lg:hidden">Barcodes</span></Button>}
            <Button variant="outline" onClick={() => setImporting(true)}><Upload /><span className="hidden sm:inline">Import CSV</span><span className="sm:hidden">Import</span></Button>
            <Button variant="outline" disabled={exporting} onClick={exportCsv}><Download /><span className="hidden sm:inline">Export CSV</span><span className="sm:hidden">Export</span></Button>
          </>
        }>
          <SearchInput value={q} onChange={setQ} placeholder={attrsOn && searchableAttrs.length ? `Search name, barcode, ${searchableAttrs.slice(0, 2).join(", ")}` : "Search name, SKU or barcode"} />
          <NativeSelect aria-label="Type" className="w-auto" value={type} onChange={setType} placeholder="All types" options={[{ value: "STOCKABLE", label: "Stockable" }, { value: "CONSUMABLE", label: "Consumable" }, { value: "SERVICE", label: "Service" }]} />
          <NativeSelect aria-label="Category" className="w-auto max-w-48" value={cat} onChange={setCat} placeholder="All categories" options={categoryOptions(cats)} />
          <FilterChips options={STATUS} value={status} onChange={setStatus} />
        </Toolbar>
        <DataTable
          rows={rows}
          cols={cols}
          bulkActions={(sel) => (
            <Button size="sm" variant="outline" onClick={() => setLabels(sel.map((p) => ({ _id: p._id, name: p.name, priceCents: p.priceCents, barcode: p.barcode, sku: p.sku })))}><Tags />Print labels</Button>
          )}
          onRowClick={(p) => router.push(`/apps/inventory/${p._id}`)}
          empty={filtered ? (
            <EmptyState icon={Package} title="No products match" desc="Try a different search or clear the filters."
              action={<Button variant="outline" onClick={() => { setQ(""); setStatus("ALL"); setType(""); setCat(""); }}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={Package} title="No products yet" desc="Add your first product, or import a list you already have."
              action={<div className="flex flex-wrap justify-center gap-2"><Button size="lg" asChild><Link href="/apps/inventory/new"><Plus />New product</Link></Button><Button size="lg" variant="outline" onClick={() => setImporting(true)}><Upload />Import CSV</Button></div>} />
          )}
        />
      </Panel>
      <AdjustStockDialog product={adjust} onClose={() => setAdjust(null)} />
      <ImportDialog open={importing} onOpenChange={setImporting} />
      <ScanAdd open={scanning} onOpenChange={setScanning} />
      <ScanAddSheet scan={phoneScan} onClose={() => setPhoneScan(null)} onNext={() => setPhoneScan(null)} />
      <LabelsDialog products={labels} currency={cur} onClose={() => setLabels(null)} />
    </>
  );
}
