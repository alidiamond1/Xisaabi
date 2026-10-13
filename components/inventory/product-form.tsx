"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AlertTriangle, ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Banner, ConfirmDialog, Field, FormSection, Money, Panel, SubmitButton } from "@/components/common";
import { useBiz } from "@/components/guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { canOpenApp } from "@/convex/shared/modules";
import { formatCents, parseToCents } from "@/convex/shared/money";
import { hasPermission } from "@/convex/shared/permissions";
import { useAttributeDefs, useFeatures, useUnitSuggestions } from "@/lib/features";
import { parseSerials, serialProblem } from "@/lib/packs";
import { run } from "@/lib/run";
import { cn } from "@/lib/utils";
import { SupplierPicker } from "@/components/purchases/supplier-picker";
import { MoneyInput, NativeSelect, Segmented, UNITS, centsToInput, expiryMs, fmtQty, parseQty } from "./bits";
import { CategoryPicker } from "./pickers";
import { AttributesSection, PacksSection, SerialSection, attrErrors, newURow, unitErrors, type URow } from "./product-extras";

export type ProductDetail = NonNullable<FunctionReturnType<typeof api.products.get>>;
type PType = "STOCKABLE" | "CONSUMABLE" | "SERVICE";
type VRow = { key: number; label: string; sku: string; barcode: string; price: string; cost: string; stock: string };

type State = {
  type: PType; name: string; categoryId: string; brand: string; unit: string; allowDecimal: boolean;
  sku: string; barcode: string; extras: string[]; extraInput: string;
  cost: string; price: string; wholesale: string;
  opening: string; reorder: string; trackExpiry: boolean; batchNo: string; expiry: string;
  hasVariants: boolean; variants: VRow[]; supplierId: string; imageId: string; imageUrl: string;
  units: URow[]; attrs: Record<string, string>; trackSerial: boolean; warranty: string; serialsText: string;
};

const TYPE_HELP: Record<PType, string> = {
  STOCKABLE: "Goods you count. Stock goes down when you sell and up when you receive.",
  CONSUMABLE: "Sold without counting stock, like tea served or shopping bags.",
  SERVICE: "No stock at all: repairs, delivery, fees.",
};

function initialState(d?: ProductDetail): State {
  const p = d?.product;
  return {
    type: p?.type ?? "STOCKABLE", name: p?.name ?? "", categoryId: p?.categoryId ?? "", brand: p?.brand ?? "", unit: p?.unit ?? "pcs",
    allowDecimal: p?.allowDecimal ?? false, sku: p?.sku ?? "", barcode: p?.barcode ?? "", extras: p?.extraBarcodes ?? [], extraInput: "",
    cost: centsToInput(p?.costCents), price: centsToInput(p?.priceCents), wholesale: centsToInput(p?.wholesalePriceCents),
    opening: "", reorder: p ? fmtQty(p.reorderLevel) : "5", trackExpiry: p?.trackExpiry ?? false, batchNo: "", expiry: "",
    hasVariants: p?.hasVariants ?? false, variants: [], supplierId: p?.supplierId ?? "", imageId: p?.imageId ?? "", imageUrl: d?.imageUrl ?? "",
    units: (p?.units ?? []).map((u) => ({ ...newURow(), name: u.name, factor: fmtQty(u.factor), barcode: u.barcode, price: centsToInput(u.priceCents) })),
    attrs: { ...(p?.attrs ?? {}) }, trackSerial: p?.trackSerial ?? false, warranty: p?.warrantyMonths ? String(p.warrantyMonths) : "", serialsText: "",
  };
}

let vKey = 1;
const newRow = (): VRow => ({ key: vKey++, label: "", sku: "", barcode: "", price: "", cost: "", stock: "" });

/** Create (no `initial`) or edit a product. Full page form. */
export function ProductForm({ initial }: { initial?: ProductDetail }) {
  const [nonce, setNonce] = useState(0);
  return <Inner key={nonce} initial={initial} again={() => setNonce((n) => n + 1)} />;
}

function Inner({ initial, again }: { initial?: ProductDetail; again: () => void }) {
  const me = useBiz();
  const router = useRouter();
  const cur = me.business.currency;
  const edit = !!initial;
  const seeCost = hasPermission(me.member, "seeCost");
  const canPrice = !edit || hasPermission(me.member, "editPrice");
  const canSuppliers = canOpenApp(me.member.role as never, me.plan.modules, "purchases");
  const feats = useFeatures();
  const defs = useAttributeDefs();
  const suggestions = useUnitSuggestions();
  const on = (x: (typeof feats)[number]) => feats.includes(x);
  const create = useMutation(api.products.create);
  const update = useMutation(api.products.update);

  const [f, setF] = useState<State>(() => initialState(initial));
  const first = useRef(JSON.stringify(f));
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"" | "save" | "again">("");
  const [discard, setDiscard] = useState(false);
  const set = (patch: Partial<State>) => setF((s) => ({ ...s, ...patch }));
  const dirty = JSON.stringify(f) !== first.current;

  const stockable = f.type === "STOCKABLE";
  const lockedKind = edit && (initial.product.stock !== 0 || initial.product.hasVariants);
  const blockedNoCost = false; // backend keeps the stored cost when the editor can't see it
  const price = parseToCents(f.price);
  const cost = f.cost.trim() === "" ? 0 : parseToCents(f.cost);
  const margin = price !== null && cost !== null ? price - cost : null;
  const marginPct = margin !== null && price ? (margin / price) * 100 : null;
  const units = [...new Set([...suggestions, ...UNITS, f.unit])];
  const serialsOn = on("serials") && stockable && !f.hasVariants && !initial?.product.hasVariants;
  const serialLock = edit && (initial.product.stock !== 0 || initial.product.hasVariants) ? "Locked while the product has stock." : undefined;
  const tracking = serialsOn && f.trackSerial;
  const showPacks = on("units") && !f.hasVariants && !initial?.product.hasVariants && !tracking;
  const showAttrs = on("attributes") && defs.length > 0;
  const openingQty = parseQty(f.opening);
  const setTrack = (trackSerial: boolean) => set(trackSerial ? { trackSerial, trackExpiry: false, allowDecimal: false, units: [], hasVariants: false, variants: [] } : { trackSerial });

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = "Enter the product name.";
    if (price === null) e.price = "Enter a selling price like 12.50.";
    if (cost === null) e.cost = "Enter an amount like 12.50.";
    if (f.wholesale.trim() && parseToCents(f.wholesale) === null) e.wholesale = "Enter an amount like 12.50.";
    if (f.extras.includes(f.barcode.trim()) && f.barcode.trim()) e.barcode = "This barcode is also listed as an extra barcode.";
    if (stockable) {
      if (parseQty(f.reorder) === null) e.reorder = "Enter 0 or more.";
      const q = parseQty(f.opening);
      if (!edit && !f.hasVariants && f.opening.trim() && (q === null || (!f.allowDecimal && !Number.isInteger(q)))) e.opening = f.allowDecimal ? "Enter a number." : `Enter a whole number of ${f.unit}.`;
      const stockIn = f.hasVariants ? f.variants.some((v) => v.stock.trim() && Number(v.stock) > 0) : (q ?? 0) > 0;
      if (!edit && f.trackExpiry && stockIn && !f.expiry) e.expiry = "Enter the expiry date of the first batch.";
    }
    if (!edit && f.hasVariants) {
      if (f.variants.length === 0) e.variants = "Add at least one variant, or turn variants off.";
      const labels = new Set<string>();
      f.variants.forEach((v) => {
        if (!v.label.trim()) e[`v${v.key}.label`] = "Name this variant, e.g. Red / XL.";
        else if (labels.has(v.label.trim().toLowerCase())) e[`v${v.key}.label`] = "Two variants have the same name.";
        labels.add(v.label.trim().toLowerCase());
        if (v.price.trim() && parseToCents(v.price) === null) e[`v${v.key}.price`] = "Invalid price.";
        if (v.cost.trim() && parseToCents(v.cost) === null) e[`v${v.key}.cost`] = "Invalid cost.";
        if (v.stock.trim() && parseQty(v.stock) === null) e[`v${v.key}.stock`] = "Invalid number.";
      });
    }
    if (showPacks) Object.assign(e, unitErrors(f.units, f.unit, f.allowDecimal));
    if (showAttrs) Object.assign(e, attrErrors(defs, f.attrs));
    if (tracking) {
      const w = f.warranty.trim();
      if (w && (!/^d+$/.test(w) || Number(w) > 120)) e.warranty = "Enter 0 to 120 months.";
      if (!edit) {
        const list = parseSerials(f.serialsText);
        if (list.length !== (openingQty ?? 0)) e.serials = `Enter exactly ${openingQty ?? 0} numbers, one for each unit in opening stock.`;
        else if (list.some((s) => serialProblem(s))) e.serials = "Some numbers are not valid. Check the ones marked below.";
      }
    }
    return e;
  }

  async function save(another: boolean) {
    const e = validate();
    setErr(e);
    if (Object.keys(e).length) { toast.error("Please fix the highlighted fields."); return; }
    setBusy(another ? "again" : "save");
    const base = {
      type: f.type, name: f.name.trim(), sku: f.sku.trim(), barcode: f.barcode.trim(), extraBarcodes: f.extras,
      categoryId: f.categoryId ? (f.categoryId as Id<"categories">) : undefined, brand: f.brand.trim(), unit: f.unit,
      allowDecimal: f.allowDecimal, costCents: cost ?? 0, priceCents: price ?? 0,
      wholesalePriceCents: f.wholesale.trim() ? (parseToCents(f.wholesale) ?? undefined) : undefined,
      reorderLevel: stockable ? (parseQty(f.reorder) ?? 0) : 0, trackExpiry: stockable && f.trackExpiry,
      supplierId: f.supplierId ? (f.supplierId as Id<"suppliers">) : undefined, imageId: f.imageId ? (f.imageId as Id<"_storage">) : undefined,
      // a hidden feature sends nothing, so the server keeps its data
      units: on("units") ? f.units.map((u) => ({ name: u.name.trim(), factor: parseQty(u.factor) ?? 1, barcode: u.barcode.trim(), priceCents: u.price.trim() ? (parseToCents(u.price) ?? undefined) : undefined })) : undefined,
      attrs: on("attributes") ? Object.fromEntries(defs.filter((d) => f.attrs[d.key]?.trim()).map((d) => [d.key, f.attrs[d.key].trim()])) : undefined,
      trackSerial: on("serials") ? tracking : undefined,
      warrantyMonths: tracking ? Number(f.warranty.trim() || 0) : undefined,
    };
    if (edit) {
      const ok = await run(update({ productId: initial.product._id, ...base }).then(() => true), "Product saved");
      setBusy("");
      if (ok) router.push(`/apps/inventory/${initial.product._id}`);
      return;
    }
    const q = parseQty(f.opening);
    const withBatch = stockable && f.trackExpiry && !!f.expiry;
    const id = await run(create({
      ...base,
      openingStock: stockable && !f.hasVariants && q ? q : undefined,
      openingSerials: tracking ? parseSerials(f.serialsText) : undefined,
      openingBatch: withBatch ? { batchNo: f.batchNo.trim() || "OPENING", expiryDate: expiryMs(f.expiry) } : undefined,
      variants: f.hasVariants ? f.variants.map((v) => ({
        label: v.label.trim(), sku: v.sku.trim(), barcode: v.barcode.trim(),
        priceCents: v.price.trim() ? (parseToCents(v.price) ?? 0) : (price ?? 0),
        costCents: v.cost.trim() ? (parseToCents(v.cost) ?? 0) : (cost ?? 0),
        openingStock: stockable && v.stock.trim() && Number(v.stock) > 0 ? (parseQty(v.stock) ?? undefined) : undefined,
      })) : undefined,
    }), "Product added");
    setBusy("");
    if (!id) return;
    if (another) { toast.message("Ready for the next product"); again(); window.scrollTo({ top: 0 }); } else router.push(`/apps/inventory/${id}`);
  }

  const back = () => (dirty ? setDiscard(true) : router.back());

  function addExtra() {
    const b = f.extraInput.trim();
    if (!b) return;
    if (b === f.barcode.trim() || f.extras.includes(b)) { toast.error("That barcode is already added."); return; }
    set({ extras: [...f.extras, b], extraInput: "" });
  }
  const setRow = (key: number, patch: Partial<VRow>) => set({ variants: f.variants.map((v) => (v.key === key ? { ...v, ...patch } : v)) });

  return (
    <div className="pb-24">
      {blockedNoCost && (
        <div className="mb-4"><Banner tone="warning" icon={AlertTriangle}>You need the &quot;See cost price &amp; profit&quot; permission to edit products, because saving also sends the cost. Ask the owner.</Banner></div>
      )}
      <Panel className="p-4 sm:p-5">
        <FormSection title="Basics" desc="What it is and how it is sold.">
          <div className="space-y-1.5">
            <p className="text-sm font-medium" id="ptype">Product type</p>
            <Segmented label="Product type" value={f.type} onChange={(type) => set({ type, trackExpiry: type === "STOCKABLE" ? f.trackExpiry : false })}
              options={(["STOCKABLE", "CONSUMABLE", "SERVICE"] as const).filter((v) => v !== "SERVICE" || on("services") || f.type === "SERVICE").map((v) => ({ value: v, label: v[0] + v.slice(1).toLowerCase(), disabled: lockedKind && v !== initial?.product.type }))} />
            <p className="text-xs text-muted-foreground">{TYPE_HELP[f.type]}{lockedKind && " The type is locked while the product has stock or variants."}</p>
          </div>
          <Field label="Name" required error={err.name}>
            <Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Sugar 1kg" maxLength={200} aria-invalid={!!err.name} autoFocus={!edit} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><p className="text-sm font-medium">Category</p><CategoryPicker value={f.categoryId} onChange={(v) => set({ categoryId: v })} /></div>
            <Field label="Brand" hint="Optional"><Input value={f.brand} onChange={(e) => set({ brand: e.target.value })} /></Field>
          </div>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Field label="Unit"><NativeSelect value={f.unit} onChange={(unit) => set({ unit })} options={units.map((u) => ({ value: u, label: u }))} /></Field>
            {(on("weight") || f.allowDecimal) && <label className={cn("flex min-h-11 items-start gap-3 rounded-lg border p-3 sm:mt-6", tracking && "opacity-60")}>
              <Switch checked={f.allowDecimal} disabled={tracking} onCheckedChange={(allowDecimal) => set({ allowDecimal })} className="mt-0.5" />
              <span><span className="block text-sm font-medium">Sold by weight or length</span><span className="block text-xs text-muted-foreground">Allows quantities like 1.5 {f.unit}.</span></span>
            </label>}
          </div>
        </FormSection>

        <FormSection title="Codes" desc="Scan or type. Each code must be unique in your shop.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="SKU" hint="Your own item code"><Input value={f.sku} onChange={(e) => set({ sku: e.target.value })} /></Field>
            <Field label="Barcode" error={err.barcode} hint="Scan with your scanner"><Input inputMode="numeric" value={f.barcode} onChange={(e) => set({ barcode: e.target.value })} aria-invalid={!!err.barcode} onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} /></Field>
          </div>
          <div className="space-y-2">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Extra barcodes</p>
              <div className="flex gap-2">
                <Input aria-label="Extra barcode" value={f.extraInput} onChange={(e) => set({ extraInput: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExtra(); } }} placeholder="Scan or type, then press Add" />
                <Button type="button" variant="outline" size="lg" onClick={addExtra} disabled={!f.extraInput.trim()}><Plus />Add</Button>
              </div>
              <p className="text-xs text-muted-foreground">Other barcodes that sell as this same product (e.g. a new pack design).</p>
            </div>
            {f.extras.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {f.extras.map((b) => (
                  <li key={b} className="inline-flex h-9 items-center gap-1 rounded-full bg-muted pl-3 pr-1 text-sm tabular-nums">
                    {b}<button type="button" aria-label={`Remove barcode ${b}`} onClick={() => set({ extras: f.extras.filter((x) => x !== b) })} className="grid size-7 place-items-center rounded-full hover:bg-border"><X className="size-4" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </FormSection>

        <FormSection title="Pricing" desc={edit && !canPrice ? "You don't have permission to change prices." : "What you pay and what you charge."}>
          <div className={cn("grid gap-4", (seeCost ? 1 : 0) + 1 + (on("wholesale") || f.wholesale ? 1 : 0) === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
            {seeCost && <Field label="Cost price" error={err.cost} hint={f.hasVariants ? "Default for variants" : undefined}><MoneyInput cur={cur} value={f.cost} onChange={(cost) => set({ cost })} disabled={!canPrice} placeholder="0.00" aria-invalid={!!err.cost} /></Field>}
            <Field label={f.hasVariants ? "Selling price (default)" : "Selling price"} required error={err.price}><MoneyInput cur={cur} value={f.price} onChange={(price) => set({ price })} disabled={!canPrice} placeholder="0.00" aria-invalid={!!err.price} /></Field>
            {(on("wholesale") || f.wholesale) && <Field label="Wholesale price" error={err.wholesale} hint="Optional, for wholesale customers"><MoneyInput cur={cur} value={f.wholesale} onChange={(wholesale) => set({ wholesale })} disabled={!canPrice} placeholder="0.00" aria-invalid={!!err.wholesale} /></Field>}
          </div>
          {seeCost && margin !== null && price !== null && price > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 rounded-lg bg-muted px-3 py-2 text-sm" aria-live="polite">
              <span className="text-muted-foreground">Profit per {f.unit}</span>
              <Money cents={margin} tone={margin > 0 ? "in" : margin < 0 ? "out" : "muted"} className="font-semibold">{formatCents(margin, cur)}</Money>
              <Money cents={margin} tone={margin > 0 ? "in" : margin < 0 ? "out" : "muted"}>({marginPct!.toFixed(0)}% margin)</Money>
              {margin < 0 && <span className="text-danger">You would sell at a loss.</span>}
            </p>
          )}
        </FormSection>

        {stockable && (
          <FormSection title="Stock" desc="How many you have and when to reorder.">
            <div className="grid gap-4 sm:grid-cols-2">
              {!edit && !f.hasVariants && (
                <Field label={`Opening stock (${f.unit})`} error={err.opening} hint={tracking ? "Then list each IMEI below" : "How many you have right now"}><Input inputMode={f.allowDecimal ? "decimal" : "numeric"} value={f.opening} onChange={(e) => set({ opening: e.target.value })} className="tabular-nums" placeholder="0" aria-invalid={!!err.opening} /></Field>
              )}
              <Field label={`Reorder level (${f.unit})`} error={err.reorder} hint="Warn me when stock falls to this"><Input inputMode="decimal" value={f.reorder} onChange={(e) => set({ reorder: e.target.value })} className="tabular-nums" aria-invalid={!!err.reorder} /></Field>
            </div>
            {(on("expiry") || f.trackExpiry) && !tracking && <label className={cn("flex min-h-11 items-start gap-3 rounded-lg border p-3", lockedKind && "opacity-60")}>
              <Switch checked={f.trackExpiry} disabled={lockedKind} onCheckedChange={(trackExpiry) => set({ trackExpiry })} className="mt-0.5" />
              <span><span className="block text-sm font-medium">Track expiry dates</span><span className="block text-xs text-muted-foreground">For food, medicine and cosmetics. Stock is kept in batches and the oldest sells first.{lockedKind && " Locked while the product has stock."}</span></span>
            </label>}
            {!edit && f.trackExpiry && !tracking && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First batch no" hint="Optional, from the box"><Input value={f.batchNo} onChange={(e) => set({ batchNo: e.target.value })} /></Field>
                <Field label="Expiry date" error={err.expiry} hint="Needed if you have opening stock"><Input type="date" value={f.expiry} onChange={(e) => set({ expiry: e.target.value })} aria-invalid={!!err.expiry} /></Field>
              </div>
            )}
          </FormSection>
        )}

        {!edit && on("variants") && !tracking && (
          <FormSection title="Variants" desc="Sizes, colors, flavors.">
            <label className="flex min-h-11 items-start gap-3 rounded-lg border p-3">
              <Switch checked={f.hasVariants} onCheckedChange={(hasVariants) => set({ hasVariants, variants: hasVariants && f.variants.length === 0 ? [newRow(), newRow()] : f.variants })} className="mt-0.5" />
              <span><span className="block text-sm font-medium">This product has variants</span><span className="block text-xs text-muted-foreground">Each variant has its own stock, price and barcode, like Red / XL.</span></span>
            </label>
            {f.hasVariants && (
              <div className="space-y-3">
                {err.variants && <p role="alert" className="text-xs text-danger">{err.variants}</p>}
                {f.variants.map((v, i) => (
                  <div key={v.key} className="space-y-3 rounded-xl border p-3">
                    <div className="flex items-start gap-2">
                      <Field label={`Variant ${i + 1}`} required error={err[`v${v.key}.label`]} className="flex-1"><Input value={v.label} onChange={(e) => setRow(v.key, { label: e.target.value })} placeholder="e.g. Red / XL" aria-invalid={!!err[`v${v.key}.label`]} /></Field>
                      <Button type="button" variant="ghost" size="icon-lg" className="mt-6 text-danger" aria-label={`Remove variant ${i + 1}`} onClick={() => set({ variants: f.variants.filter((x) => x.key !== v.key) })}><Trash2 /></Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                      <Field label="SKU"><Input value={v.sku} onChange={(e) => setRow(v.key, { sku: e.target.value })} /></Field>
                      <Field label="Barcode"><Input inputMode="numeric" value={v.barcode} onChange={(e) => setRow(v.key, { barcode: e.target.value })} onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} /></Field>
                      <Field label="Price" error={err[`v${v.key}.price`]}><Input inputMode="decimal" value={v.price} onChange={(e) => setRow(v.key, { price: e.target.value })} placeholder={f.price || "default"} className="tabular-nums" /></Field>
                      {seeCost && <Field label="Cost" error={err[`v${v.key}.cost`]}><Input inputMode="decimal" value={v.cost} onChange={(e) => setRow(v.key, { cost: e.target.value })} placeholder={f.cost || "default"} className="tabular-nums" /></Field>}
                      {stockable && <Field label="Opening stock" error={err[`v${v.key}.stock`]}><Input inputMode="decimal" value={v.stock} onChange={(e) => setRow(v.key, { stock: e.target.value })} placeholder="0" className="tabular-nums" /></Field>}
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" size="lg" onClick={() => set({ variants: [...f.variants, newRow()] })}><Plus />Add variant</Button>
              </div>
            )}
          </FormSection>
        )}
        {edit && initial.product.hasVariants && (
          <FormSection title="Variants" desc="Managed on the product page.">
            <p className="text-sm text-muted-foreground">To add another variant, open the product and use <b>Add variant</b> on the Variants tab.</p>
          </FormSection>
        )}

        {showPacks && <PacksSection rows={f.units} onChange={(units) => set({ units })} unit={f.unit} allowDecimal={f.allowDecimal} priceCents={price} cur={cur} suggestions={suggestions} err={err} />}
        {showAttrs && <AttributesSection defs={defs} values={f.attrs} onChange={(attrs) => set({ attrs })} err={err} />}
        {serialsOn && <SerialSection track={f.trackSerial} onTrack={setTrack} warranty={f.warranty} onWarranty={(warranty) => set({ warranty })} serialsText={f.serialsText}
          onSerials={(serialsText) => set({ serialsText })} openingQty={openingQty} lockedReason={serialLock} showOpening={!edit} err={err} />}

        <FormSection title="Supplier & photo" desc="Optional. A photo helps at the till.">
          {canSuppliers && (
            <div className="space-y-1.5"><p className="text-sm font-medium">Usual supplier</p><SupplierPicker value={f.supplierId} onChange={(supplierId) => set({ supplierId })} /></div>
          )}
          <ImageUpload preview={f.imageUrl} onUploaded={(imageId, imageUrl) => set({ imageId, imageUrl })} onRemove={() => set({ imageId: "", imageUrl: "" })} />
        </FormSection>
      </Panel>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-end gap-2">
          <Button variant="outline" size="lg" className="hidden sm:inline-flex" onClick={back}>Cancel</Button>
          {!edit && <SubmitButton variant="outline" size="lg" className="flex-1 sm:flex-none" busy={busy === "again"} disabled={!!busy} onClick={() => save(true)}>Save &amp; add another</SubmitButton>}
          <SubmitButton size="lg" className="flex-1 sm:flex-none" busy={busy === "save"} disabled={!!busy || blockedNoCost} onClick={() => save(false)}>{edit ? "Save changes" : "Add product"}</SubmitButton>
        </div>
      </div>
      <ConfirmDialog open={discard} onOpenChange={setDiscard} title="Discard changes?" desc="You have unsaved changes. If you leave, they will be lost." confirmLabel="Discard" onConfirm={() => router.back()} />
    </div>
  );
}

const MAX_PHOTO = 5_000_000; // backend limit in products.ts; shrink() normally lands far below 1 MB

/** Phone photos are 3–8 MB: scale to ≤800px and re-encode as JPEG, lowering quality until it fits 1 MB. */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  let out: Blob = file;
  for (const q of [0.82, 0.65, 0.5]) {
    out = await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("encode"))), "image/jpeg", q));
    if (out.size <= 1_000_000) break;
  }
  return out;
}

function ImageUpload({ preview, onUploaded, onRemove }: { preview: string; onUploaded: (id: string, url: string) => void; onRemove: () => void }) {
  const gen = useMutation(api.products.generateUploadUrl);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Choose a photo."); return; }
    setBusy(true);
    try {
      const img = await shrink(file);
      if (img.size > MAX_PHOTO) { toast.error("Photo is too large. Try another one."); return; }
      const url = await gen({});
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": img.type }, body: img });
      if (!res.ok) throw new Error("upload");
      const { storageId } = (await res.json()) as { storageId: string };
      onUploaded(storageId, URL.createObjectURL(img));
    } catch {
      toast.error("Upload failed. Try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview ? <img src={preview} alt="Product photo" className="size-full object-cover" /> : <ImagePlus className="size-6 text-muted-foreground" />}
      </div>
      <div className="space-y-1">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="lg" disabled={busy} onClick={() => input.current?.click()}>
            {busy && <Loader2 className="animate-spin" />}{preview ? "Change photo" : "Upload photo"}
          </Button>
          {preview && <Button type="button" variant="ghost" size="lg" onClick={onRemove}>Remove</Button>}
        </div>
        <p className="text-xs text-muted-foreground">Any photo — it is made small so the POS loads fast on mobile data.</p>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
    </div>
  );
}
