"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Archive, ArchiveRestore, ArrowLeftRight, Barcode, Boxes, Layers, Pencil, Plus, SlidersHorizontal, Tags } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Col, ConfirmDialog, DataTable, DetailLayout, EmptyState, Field, KeyValue, ListSkeleton, Money, PageHeader, Panel, SubmitButton } from "@/components/common";
import { useBiz } from "@/components/guard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { daysLeft } from "@/convex/shared/expiry";
import { formatCents, parseToCents } from "@/convex/shared/money";
import { hasPermission } from "@/convex/shared/permissions";
import { useAttributeDefs, useFeatures } from "@/lib/features";
import { packPrice } from "@/lib/packs";
import { act } from "@/lib/run";
import { fmtDate, fmtDateTime } from "@/lib/session";
import { AdjustStockDialog } from "./adjust-dialog";
import { ExpiryBadge, fmtQty, moveLabel, reasonLabel } from "./bits";
import { LabelsDialog } from "./labels";
import { QtyCell } from "./moves-view";
import { SerialsPanel } from "./serials-view";
import { StatusBadges, Thumb } from "./products-view";
import { MoneyInput } from "./bits";

type Detail = NonNullable<FunctionReturnType<typeof api.products.get>>;

export function ProductDetail({ id }: { id: Id<"products"> }) {
  const d = useQuery(api.products.get, { productId: id });
  if (d === undefined) {
    return (
      <div className="space-y-4"><Skeleton className="h-16 w-full max-w-md" /><div className="grid gap-4 lg:grid-cols-[1fr_320px]"><Panel><ListSkeleton rows={6} /></Panel><Skeleton className="h-64 rounded-xl" /></div></div>
    );
  }
  return <Loaded d={d} />;
}

function Loaded({ d }: { d: Detail }) {
  const me = useBiz();
  const router = useRouter();
  const cur = me.business.currency;
  const seeCost = hasPermission(me.member, "seeCost");
  const canAdjust = hasPermission(me.member, "adjustStock");
  const p = d.product;
  const cats = useQuery(api.categories.list);
  const feats = useFeatures();
  const defs = useAttributeDefs();
  const showUnits = feats.includes("units") && !!p.units?.length;
  const showSerials = feats.includes("serials") && !!p.trackSerial;
  const attrRows = feats.includes("attributes") ? defs.filter((x) => p.attrs?.[x.key]).map((x) => ({ label: x.label, value: p.attrs![x.key] })) : [];
  const archive = useMutation(api.products.archive);
  const genBarcode = useMutation(api.barcodes.generate);
  const [labeling, setLabeling] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [addingVariant, setAddingVariant] = useState(false);
  const stocked = p.type === "STOCKABLE" && !p.hasVariants;
  const canAddVariant = !p.parentId && !p.isArchived && (p.hasVariants || p.stock === 0);
  const cat = cats?.find((c) => c._id === p.categoryId)?.name;
  const margin = p.costCents !== undefined ? p.priceCents - p.costCents : undefined;
  const marginPct = margin !== undefined && p.priceCents > 0 ? (margin / p.priceCents) * 100 : undefined;
  const liveBatches = d.batches.filter((b) => b.qty > 0);
  const expiryStatus = (() => {
    const first = p.trackExpiry ? liveBatches[0]?.expiryDate : undefined;
    if (first === undefined) return "OK" as const;
    const dl = daysLeft(first);
    return dl <= 0 ? ("EXPIRED" as const) : dl <= 90 ? ("1_MONTH" as const) : ("OK" as const);
  })();

  return (
    <>
      <PageHeader
        title={p.variantLabel ? `${p.name} (${p.variantLabel})` : p.name}
        back={p.parentId ? { href: `/apps/inventory/${p.parentId}`, label: "Back to main product" } : { href: "/apps/inventory", label: "Products" }}
        meta={<StatusBadges p={{ ...p, expiryStatus }} />}
        actions={
          <>
            {p.isArchived ? (
              <Button size="lg" onClick={() => act(archive({ productId: p._id, archived: false }), "Product restored")}><ArchiveRestore />Restore</Button>
            ) : (
              <>
                {canAddVariant && (p.hasVariants ? <Button size="lg" onClick={() => setAddingVariant(true)}><Plus />Add variant</Button> : null)}
                {stocked && canAdjust && <Button size="lg" onClick={() => setAdjust(true)}><SlidersHorizontal />Adjust stock</Button>}
                {!p.hasVariants && !p.barcode && <Button size="lg" variant="outline" onClick={() => act(genBarcode({ productId: p._id }), "Barcode created")}><Barcode />Generate barcode</Button>}
                {!p.hasVariants && (p.barcode || p.sku) && <Button size="lg" variant="outline" onClick={() => setLabeling(true)}><Tags />Print label</Button>}
                <Button size="lg" variant="outline" asChild><Link href={`/apps/inventory/${p._id}/edit`}><Pencil />Edit</Link></Button>
                {canAddVariant && !p.hasVariants && <Button size="lg" variant="outline" onClick={() => setAddingVariant(true)}><Layers />Add variant</Button>}
                <Button size="lg" variant="outline" onClick={() => setArchiving(true)}><Archive />Archive</Button>
              </>
            )}
          </>
        }
      />
      <LabelsDialog products={labeling ? [{ _id: p._id, name: p.name, priceCents: p.priceCents, barcode: p.barcode, sku: p.sku }] : null} currency={cur} onClose={() => setLabeling(false)} />
      <DetailLayout
        main={
          <Tabs defaultValue="overview" className="gap-4">
            <TabsList variant="line" className="h-auto w-full justify-start overflow-x-auto border-b">
              <TabsTrigger value="overview" className="h-11 flex-none px-3">Overview</TabsTrigger>
              {p.hasVariants && <TabsTrigger value="variants" className="h-11 flex-none px-3">Variants ({d.variants.length})</TabsTrigger>}
              {showSerials && <TabsTrigger value="serials" className="h-11 flex-none px-3">IMEI / serials</TabsTrigger>}
              {stocked && <TabsTrigger value="batches" className="h-11 flex-none px-3">Stock &amp; batches</TabsTrigger>}
              <TabsTrigger value="moves" className="h-11 flex-none px-3">Movements</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="grid gap-4 md:grid-cols-2">
              <Panel>
                <h3 className="border-b px-4 py-3 text-sm font-semibold">Pricing</h3>
                <KeyValue items={[
                  ...(seeCost && !p.hasVariants ? [{ label: "Cost price", value: p.costCents === undefined ? "-" : formatCents(p.costCents, cur) }] : []),
                  { label: "Selling price", value: p.hasVariants ? "Per variant" : formatCents(p.priceCents, cur) },
                  { label: "Wholesale price", value: p.wholesalePriceCents === undefined ? "-" : formatCents(p.wholesalePriceCents, cur) },
                  ...(seeCost && margin !== undefined && !p.hasVariants ? [{
                    label: "Margin",
                    value: <Money cents={margin} tone={margin > 0 ? "in" : margin < 0 ? "out" : "muted"}>{formatCents(margin, cur)}{marginPct !== undefined && ` (${marginPct.toFixed(0)}%)`}</Money>,
                  }] : []),
                ]} />
              </Panel>
              <Panel>
                <h3 className="border-b px-4 py-3 text-sm font-semibold">Stock</h3>
                <KeyValue items={[
                  { label: "On hand", value: stocked ? `${fmtQty(p.stock)} ${p.unit}` : p.type === "STOCKABLE" ? "See variants" : "Not tracked" },
                  ...(p.type === "STOCKABLE" ? [{ label: "Reorder level", value: `${fmtQty(p.reorderLevel)} ${p.unit}` }, { label: "Tracks expiry", value: p.trackExpiry ? "Yes" : "No" }] : []),
                  { label: "Unit", value: <>{p.unit}{p.allowDecimal && <span className="text-muted-foreground"> (decimals)</span>}</> },
                ]} />
              </Panel>
              {showUnits && (
                <Panel className="md:col-span-2">
                  <h3 className="border-b px-4 py-3 text-sm font-semibold">Packs &amp; units</h3>
                  <ul className="divide-y text-sm">
                    <li className="flex items-center justify-between gap-3 px-4 py-2.5"><span className="font-medium">{p.unit} <span className="font-normal text-muted-foreground">(base unit)</span></span><span className="tabular-nums">{formatCents(p.priceCents, cur)}</span></li>
                    {p.units!.map((u) => (
                      <li key={u.name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-4 py-2.5">
                        <span><span className="font-medium">{u.name}</span> <span className="text-muted-foreground">= {fmtQty(u.factor)} {p.unit}{u.barcode && ` · ${u.barcode}`}</span></span>
                        <span className="tabular-nums">{formatCents(packPrice(u, p.priceCents), cur)}{u.priceCents === undefined && <span className="text-xs text-muted-foreground"> auto</span>}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
              <Panel className="md:col-span-2">
                <h3 className="border-b px-4 py-3 text-sm font-semibold">Details</h3>
                <KeyValue items={[
                  { label: "Category", value: cat ?? "-" },
                  { label: "Brand", value: p.brand || "-" },
                  { label: "Supplier", value: d.supplier ? <Link href={`/apps/purchases/suppliers/${d.supplier._id}`} className="text-brand-700 hover:underline">{d.supplier.name}</Link> : "-" },
                  { label: "SKU", value: p.sku || "-" },
                  { label: "Barcode", value: <span className="tabular-nums">{p.barcode || "-"}</span> },
                  ...(p.extraBarcodes.length ? [{ label: "Extra barcodes", value: <span className="tabular-nums">{p.extraBarcodes.join(", ")}</span> }] : []),
                  ...attrRows,
                  ...(showSerials ? [{ label: "Warranty", value: p.warrantyMonths ? `${p.warrantyMonths} month${p.warrantyMonths === 1 ? "" : "s"}` : "None" }] : []),
                ]} />
              </Panel>
            </TabsContent>

            {p.hasVariants && (
              <TabsContent value="variants">
                <Panel>
                  <DataTable rows={d.variants} onRowClick={(v) => router.push(`/apps/inventory/${v._id}`)}
                    cols={[
                      { header: "Variant", cell: (v) => <span className="font-medium">{v.variantLabel}</span> },
                      { header: "SKU / barcode", cell: (v) => <span className="tabular-nums text-muted-foreground">{v.sku || v.barcode || "-"}</span> },
                      { header: "Price", className: "text-right", cell: (v) => <span className="tabular-nums">{formatCents(v.priceCents, cur)}</span> },
                      ...(seeCost ? [{ header: "Cost", className: "text-right", cell: (v: Detail["variants"][number]) => <span className="tabular-nums text-muted-foreground">{v.costCents === undefined ? "-" : formatCents(v.costCents, cur)}</span> }] : []),
                      { header: "Stock", className: "text-right", cell: (v) => <span className="tabular-nums">{fmtQty(v.stock)} {v.unit}</span> },
                    ]}
                    empty={<EmptyState icon={Layers} title="No variants yet" desc="Add the first one, e.g. Red / XL." action={<Button onClick={() => setAddingVariant(true)}><Plus />Add variant</Button>} />} />
                </Panel>
              </TabsContent>
            )}

            {showSerials && <TabsContent value="serials"><SerialsPanel productId={p._id} /></TabsContent>}

            {stocked && (
              <TabsContent value="batches">
                <Panel>
                  {p.trackExpiry ? (
                    <DataTable rows={liveBatches} pageSize={50}
                      cols={[
                        { header: "Batch", cell: (b) => <span className="font-medium">{b.batchNo}</span> },
                        { header: "Quantity", className: "text-right", cell: (b) => <span className="tabular-nums">{fmtQty(b.qty)} {p.unit}</span> },
                        ...(seeCost ? [{ header: "Unit cost", className: "text-right", cell: (b: Detail["batches"][number]) => <span className="tabular-nums text-muted-foreground">{b.costCents === undefined ? "-" : formatCents(b.costCents, cur)}</span> }] : []),
                        { header: "Received", cell: (b) => <span className="text-muted-foreground">{fmtDate(b.receivedAt)}</span> },
                        { header: "Expires", cell: (b) => <span className="flex flex-wrap items-center gap-2"><span>{fmtDate(b.expiryDate)}</span><ExpiryBadge days={daysLeft(b.expiryDate)} /></span> },
                      ]}
                      empty={<EmptyState icon={Boxes} title="No batches in stock" desc="Receive stock with an expiry date to see batches here." />} />
                  ) : (
                    <EmptyState icon={Boxes} title="Stock isn't tracked in batches" desc={`You have ${fmtQty(p.stock)} ${p.unit} in total. Turn on Track expiry when editing to keep dated batches.`} />
                  )}
                </Panel>
              </TabsContent>
            )}

            <TabsContent value="moves">
              <Panel>
                <DataTable rows={d.movements} pageSize={25}
                  cols={[
                    { header: "Date", cell: (m) => <span className="whitespace-nowrap text-muted-foreground">{fmtDateTime(m.createdAt)}</span> },
                    { header: "Type", cell: (m) => moveLabel(m.type) },
                    { header: "Quantity", className: "text-right", cell: (m) => <QtyCell qty={m.qty} /> },
                    { header: "Balance", className: "text-right", cell: (m) => <span className="tabular-nums">{fmtQty(m.balanceAfter)}</span> },
                    { header: "Reason", cell: (m) => <span className="text-muted-foreground">{[m.ref, reasonLabel(m.reason), m.note].filter(Boolean).join(" · ") || "-"}</span> },
                    { header: "By", cell: (m) => m.memberName },
                  ] satisfies Col<Detail["movements"][number]>[]}
                  empty={<EmptyState icon={ArrowLeftRight} title="No movements yet" desc="Sales, purchases and adjustments will be listed here." />} />
              </Panel>
            </TabsContent>
          </Tabs>
        }
        side={
          <Panel>
            <div className="flex items-center gap-4 p-4">
              <Thumb url={d.imageUrl} size="size-20" />
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{stocked ? "In stock" : "Selling price"}</p>
                <p className="font-display text-3xl font-semibold tabular-nums tracking-tight">{stocked ? fmtQty(p.stock) : p.hasVariants ? d.variants.length : formatCents(p.priceCents, cur)}</p>
                <p className="text-sm text-muted-foreground">{stocked ? p.unit : p.hasVariants ? "variants" : p.type.toLowerCase()}</p>
              </div>
            </div>
            <div className="border-t">
              <KeyValue items={[
                ...(stocked ? [{ label: "Price", value: formatCents(p.priceCents, cur) }] : []),
                ...(stocked && seeCost && p.costCents !== undefined ? [{ label: "Stock value (cost)", value: formatCents(Math.round(p.stock * p.costCents), cur) }] : []),
                { label: "Updated", value: fmtDate(p.updatedAt) },
              ]} />
            </div>
          </Panel>
        }
      />
      <AdjustStockDialog product={adjust && stocked ? p : null} onClose={() => setAdjust(false)} />
      <ConfirmDialog open={archiving} onOpenChange={setArchiving} title={`Archive "${p.name}"?`} desc="It will be hidden from the till and lists. Stock history is kept and you can restore it any time."
        confirmLabel="Archive" onConfirm={async () => { if (await act(archive({ productId: p._id, archived: true }), "Product archived")) router.push("/apps/inventory"); }} />
      <VariantDialog open={addingVariant} onOpenChange={setAddingVariant} parent={p} seeCost={seeCost} cur={cur} />
    </>
  );
}

function VariantDialog({ open, onOpenChange, parent, seeCost, cur }: { open: boolean; onOpenChange: (o: boolean) => void; parent: Detail["product"]; seeCost: boolean; cur: string }) {
  const addVariant = useMutation(api.products.addVariant);
  const [f, setF] = useState({ label: "", sku: "", barcode: "", price: "", cost: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    const e: Record<string, string> = {};
    if (!f.label.trim()) e.label = "Name this variant, e.g. Red / XL.";
    const price = f.price.trim() ? parseToCents(f.price) : parent.priceCents;
    if (price === null) e.price = "Enter an amount like 12.50.";
    const cost = f.cost.trim() ? parseToCents(f.cost) : (parent.costCents ?? 0);
    if (cost === null) e.cost = "Enter an amount like 12.50.";
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const ok = await act(addVariant({ parentId: parent._id, label: f.label.trim(), sku: f.sku.trim(), barcode: f.barcode.trim(), priceCents: price!, costCents: cost! }), "Variant added");
    setBusy(false);
    if (ok) { onOpenChange(false); setF({ label: "", sku: "", barcode: "", price: "", cost: "" }); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add variant</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <Field label="Variant name" required error={err.label}><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="e.g. Red / XL" autoFocus aria-invalid={!!err.label} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="SKU"><Input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Field>
            <Field label="Barcode"><Input inputMode="numeric" value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value })} /></Field>
            <Field label="Price" error={err.price} hint={`Blank = ${formatCents(parent.priceCents, cur)}`}><MoneyInput cur={cur} value={f.price} onChange={(price) => setF({ ...f, price })} /></Field>
            {seeCost && <Field label="Cost" error={err.cost} hint="Blank = same as main"><MoneyInput cur={cur} value={f.cost} onChange={(cost) => setF({ ...f, cost })} /></Field>}
          </div>
          <p className="text-xs text-muted-foreground">Start with 0 stock. Use Receive stock or Adjust stock on the variant to add some.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <SubmitButton busy={busy} onClick={save}>Add variant</SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
