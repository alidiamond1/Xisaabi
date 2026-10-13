"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { Flag, Loader2, PackageCheck, ScanLine, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ConfirmDialog, Field, Pill, SubmitButton } from "@/components/common";
import { useBiz } from "@/components/guard";
import { ScanDialog, type ScanResult } from "@/components/scanner/camera-scanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { normalizeGtin } from "@/convex/shared/barcode";
import { errorMessage } from "@/convex/shared/errors";
import { formatCents, parseToCents } from "@/convex/shared/money";
import { hasPermission } from "@/convex/shared/permissions";
import { useAttributeDefs, useFeature, useUnitSuggestions } from "@/lib/features";
import { run } from "@/lib/run";
import { AdjustStockDialog, type AdjustTarget } from "./adjust-dialog";
import { MoneyInput, NativeSelect, UNITS, expiryMs, fmtQty, parseQty } from "./bits";
import { categoryOptions } from "./pickers";

const REMOTE_WAIT_MS = 5000;
const DECIMAL_UNITS = new Set(["kg", "g", "litre", "ml", "metre"]);

type Catalog = NonNullable<ReturnType<typeof useLookup>>["catalog"];
type Remote = { state: "idle" | "pending" | "done"; entry: Catalog; limited: boolean };

/** Local product + shared catalog for a scanned code. `now` is coarse so the query result stays cached. */
function useLookup(code: string) {
  const [now] = useState(() => Math.floor(Date.now() / 3_600_000) * 3_600_000);
  return useQuery(api.catalog.lookup, { code, now });
}

/** Pick the shop category whose words overlap most with the catalog's category hint. */
function matchCategory(hint: string, cats: { _id: string; name: string }[] | undefined): string {
  if (!hint || !cats) return "";
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9؀-ۿ]+/).filter((w) => w.length >= 3).map((w) => w.replace(/(es|s)$/, ""));
  const h = new Set(words(hint));
  let best = "", score = 0;
  for (const c of cats) {
    const n = words(c.name).filter((w) => h.has(w)).length;
    if (n > score) { score = n; best = c._id; }
  }
  return best;
}

/**
 * Result sheet for one scanned code: lookup -> state chip -> quick-add form (focus on Price).
 * `onAdded` fires after the product is created; `onNext` is the "scan next" action (camera reopens).
 */
// forReceive: stock comes from the receive line, so the sheet never adds opening stock (no double count)
export function ScanAddSheet({ scan, onClose, onNext, onAdded, forReceive }: {
  scan: ScanResult | null; onClose: () => void; onNext: () => void; onAdded?: (id: Id<"products">) => void; forReceive?: boolean;
}) {
  return (
    <Sheet open={!!scan} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        {scan && <Result key={scan.code} scan={scan} onNext={onNext} onClose={onClose} onAdded={onAdded} forReceive={forReceive} />}
      </SheetContent>
    </Sheet>
  );
}

function Result({ scan, onNext, onClose, onAdded, forReceive }: { scan: ScanResult; onNext: () => void; onClose: () => void; onAdded?: (id: Id<"products">) => void; forReceive?: boolean }) {
  const code = scan.code;
  const lookup = useLookup(code);
  const fetchRemote = useAction(api.lookups.remote);
  const [remote, setRemote] = useState<Remote>({ state: "idle", entry: null, limited: false });
  const [waited, setWaited] = useState(false);
  const asked = useRef(false);

  useEffect(() => {
    const t = window.setTimeout(() => setWaited(true), REMOTE_WAIT_MS + 1000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!lookup || lookup.local || !lookup.needsRemote || lookup.catalog || asked.current) return;
    asked.current = true;
    setRemote((r) => ({ ...r, state: "pending" }));
    const wait = new Promise<"timeout">((res) => window.setTimeout(() => res("timeout"), REMOTE_WAIT_MS));
    Promise.race([fetchRemote({ code }), wait])
      .then((r) => setRemote({ state: "done", entry: r === "timeout" ? null : r, limited: false }))
      .catch((e) => {
        const limited = (e as { data?: unknown })?.data === "RATE_LIMITED";
        if (limited) toast.message("Product lookup limit reached. Fill in the details yourself.");
        setRemote({ state: "done", entry: null, limited });
      });
  }, [lookup, code, fetchRemote]);

  const loading = !waited && (lookup === undefined || remote.state === "pending");
  if (loading) {
    return (
      <>
        <SheetHeader className="pr-12"><SheetTitle className="font-display">Looking up product</SheetTitle><SheetDescription className="tabular-nums">{code}</SheetDescription></SheetHeader>
        <div className="grid flex-1 place-items-center p-6 text-center text-muted-foreground" role="status">
          <div><Loader2 className="mx-auto mb-3 size-6 animate-spin" /><p className="text-sm">Checking your shop and the product catalog...</p></div>
        </div>
      </>
    );
  }
  if (lookup?.local) return <Known scan={scan} local={lookup.local} onNext={onNext} onClose={onClose} />;
  return <QuickAdd scan={scan} entry={lookup?.catalog ?? remote.entry} onNext={onNext} onAdded={onAdded} forReceive={forReceive} />;
}

/* ------------------------------------------------------------------ already in the shop */

function Known({ scan, local, onNext, onClose }: {
  scan: ScanResult; local: NonNullable<NonNullable<ReturnType<typeof useLookup>>["local"]>; onNext: () => void; onClose: () => void;
}) {
  const me = useBiz();
  const router = useRouter();
  const p = local.product;
  const [adjust, setAdjust] = useState<AdjustTarget | null>(null);
  const canAdjust = hasPermission(me.member, "adjustStock") && p.type === "STOCKABLE" && !p.hasVariants && !p.isArchived;
  return (
    <>
      <SheetHeader className="pr-12">
        <div><Pill tone="green" dot>Already in your shop</Pill></div>
        <SheetTitle className="font-display text-lg">{p.name}</SheetTitle>
        <SheetDescription className="tabular-nums">{scan.code}</SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-3 overflow-y-auto px-4">
        <dl className="divide-y rounded-xl border text-sm">
          <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-muted-foreground">Price</dt><dd className="font-medium tabular-nums">{formatCents(p.priceCents, me.business.currency)}</dd></div>
          {p.type === "STOCKABLE" && !p.hasVariants && (
            <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-muted-foreground">In stock</dt><dd className="font-medium tabular-nums">{fmtQty(p.stock)} {p.unit}</dd></div>
          )}
          {local.unit && <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-muted-foreground">This code is the</dt><dd className="font-medium">{local.unit.name} pack</dd></div>}
        </dl>
      </div>
      <SheetFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
        {canAdjust && (
          <Button size="lg" onClick={() => setAdjust(p)}><PackageCheck />Add stock</Button>
        )}
        <Button size="lg" variant="outline" onClick={() => { router.push(`/apps/inventory/${p._id}`); onClose(); }}>Open product</Button>
        <Button size="lg" variant="ghost" onClick={onNext}><ScanLine />Scan next</Button>
      </SheetFooter>
      <AdjustStockDialog product={adjust} onClose={() => setAdjust(null)} />
    </>
  );
}

/* ------------------------------------------------------------------ new product */

function QuickAdd({ scan, entry, onNext, onAdded, forReceive }: { scan: ScanResult; entry: Catalog; onNext: () => void; onAdded?: (id: Id<"products">) => void; forReceive?: boolean }) {
  const me = useBiz();
  const cur = me.business.currency;
  const seeCost = hasPermission(me.member, "seeCost");
  const expiryOn = useFeature("expiry");
  const serialsOn = useFeature("serials");
  const defs = useAttributeDefs();
  const suggestions = useUnitSuggestions();
  const cats = useQuery(api.categories.list);
  const create = useMutation(api.products.create);
  const flag = useMutation(api.catalog.flag);
  const gs1 = scan.gs1;

  const units = useMemo(() => [...new Set([...suggestions.filter((u) => UNITS.includes(u)), ...UNITS])], [suggestions]);
  const [f, setF] = useState(() => ({
    name: entry?.name ?? "", brand: entry?.brand ?? "", size: entry?.size ?? "", categoryId: "", price: "", cost: "", stock: "",
    unit: units[0] ?? "pcs", trackExpiry: !!gs1?.expiry, batchNo: gs1?.batch ?? "", expiry: gs1?.expiry ?? "", trackSerial: false, serials: "",
  }));
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const catTouched = useRef(false);

  // Categories load async: fill the guess once, unless the user already picked one.
  useEffect(() => {
    if (catTouched.current || !cats || f.categoryId) return;
    const m = matchCategory(entry?.categoryHint ?? "", cats);
    if (m) setF((s) => (s.categoryId ? s : { ...s, categoryId: m }));
  }, [cats, entry, f.categoryId]);

  const serialLines = f.serials.split(/\s*[\n,;]+\s*/).map((s) => s.trim()).filter(Boolean);
  const showExpiry = expiryOn && !f.trackSerial;
  const barcode = normalizeGtin(scan.code) ?? scan.code;

  async function save() {
    const e: Record<string, string> = {};
    const price = parseToCents(f.price);
    const cost = f.cost.trim() ? parseToCents(f.cost) : 0;
    const stock = forReceive ? 0 : f.stock.trim() ? parseQty(f.stock) : 0;
    const decimal = DECIMAL_UNITS.has(f.unit);
    if (!f.name.trim()) e.name = "Enter the product name.";
    if (price === null) e.price = "Enter a selling price like 12.50.";
    if (cost === null) e.cost = "Enter an amount like 12.50.";
    if (stock === null || (!decimal && !Number.isInteger(stock))) e.stock = decimal ? "Enter a number." : `Enter a whole number of ${f.unit}.`;
    if (f.trackSerial && !forReceive) {
      if (!serialLines.length) e.serials = "Enter one IMEI / serial number per line.";
    } else if (showExpiry && f.trackExpiry && (stock ?? 0) > 0 && !f.expiry) e.expiry = "Enter the expiry date.";
    setErr(e);
    if (Object.keys(e).length || price === null || cost === null || stock === null) return;

    const size = f.size.trim();
    const sizeIsAttr = defs.some((d) => d.key === "size");
    const name = !size || sizeIsAttr || f.name.toLowerCase().includes(size.toLowerCase()) ? f.name.trim() : `${f.name.trim()} ${size}`;
    const opening = forReceive ? 0 : f.trackSerial ? serialLines.length : stock;
    setBusy(true);
    const id = await run(create({
      type: "STOCKABLE", name, sku: "", barcode, extraBarcodes: [],
      categoryId: f.categoryId ? (f.categoryId as Id<"categories">) : undefined, brand: f.brand.trim(), unit: f.trackSerial ? "pcs" : f.unit,
      allowDecimal: decimal && !f.trackSerial, costCents: cost, priceCents: price, reorderLevel: 5,
      trackExpiry: showExpiry && f.trackExpiry, trackSerial: f.trackSerial || undefined,
      attrs: sizeIsAttr && size ? { size } : undefined,
      openingStock: opening > 0 ? opening : undefined,
      openingSerials: f.trackSerial ? serialLines : undefined,
      openingBatch: showExpiry && f.trackExpiry && opening > 0 && f.expiry ? { batchNo: f.batchNo.trim() || "OPENING", expiryDate: expiryMs(f.expiry) } : undefined,
    }));
    setBusy(false);
    if (!id) return;
    toast.success("Added · scan next");
    onAdded?.(id);
    onNext();
  }

  const fromOff = entry?.source === "OPEN_FOOD_FACTS";
  const other = entry?.source === "OTHER";
  return (
    <>
      <SheetHeader className="pr-12">
        <div className="flex flex-wrap items-center gap-1.5">
          {entry ? (
            fromOff || other ? <Pill tone="blue" dot>{`Found · from ${fromOff ? "Open Food Facts" : "Open Products Facts"}`}</Pill>
              : <Pill tone="brand" dot><Users className="size-3" />{entry.confirmCount > 0 ? `Found · confirmed by ${entry.confirmCount} shop${entry.confirmCount === 1 ? "" : "s"}` : "Found · shared catalog"}</Pill>
          ) : <Pill tone="amber" dot><Sparkles className="size-3" />New product</Pill>}
        </div>
        <SheetTitle className="font-display text-lg">{entry ? "Check and add your price" : "Add this product"}</SheetTitle>
        <SheetDescription className="tabular-nums">{scan.code}</SheetDescription>
      </SheetHeader>

      <form id="quick-add" className="flex-1 space-y-4 overflow-y-auto px-4 pb-4" onSubmit={(ev) => { ev.preventDefault(); void save(); }} noValidate>
        {entry?.imageUrl && (
          <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-2.5">
            {/* external thumbnail, shown only (never uploaded) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={entry.imageUrl} alt="" referrerPolicy="no-referrer" width={64} height={64} className="size-16 shrink-0 rounded-lg bg-white object-contain" />
            <p className="text-xs text-muted-foreground">Photo from {fromOff ? "Open Food Facts (CC BY-SA)" : "the product catalog"}. It is only a preview and is not saved with your product.</p>
          </div>
        )}
        <Field label="Selling price" required error={err.price}>
          <MoneyInput cur={cur} value={f.price} onChange={(v) => set({ price: v })} autoFocus placeholder="0.00" aria-invalid={!!err.price} className="h-12 text-lg font-semibold" />
        </Field>
        <Field label="Name" required error={err.name}><Input value={f.name} onChange={(e) => set({ name: e.target.value })} aria-invalid={!!err.name} placeholder="Product name" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Brand"><Input value={f.brand} onChange={(e) => set({ brand: e.target.value })} /></Field>
          <Field label="Size"><Input value={f.size} onChange={(e) => set({ size: e.target.value })} placeholder="e.g. 500 ml" /></Field>
        </div>
        <Field label="Category">
          <NativeSelect value={f.categoryId} onChange={(v) => { catTouched.current = true; set({ categoryId: v }); }} placeholder={cats ? "No category" : "Loading..."} options={categoryOptions(cats)} />
        </Field>
        {seeCost && <Field label="Cost price" hint="Optional. What you pay per item." error={err.cost}><MoneyInput cur={cur} value={f.cost} onChange={(v) => set({ cost: v })} placeholder="0.00" /></Field>}

        {!f.trackSerial && (
          <div className="grid grid-cols-2 gap-3">
            {!forReceive && <Field label="Stock on hand" error={err.stock}><Input inputMode="decimal" value={f.stock} onChange={(e) => set({ stock: e.target.value })} placeholder="0" className="tabular-nums" /></Field>}
            <Field label="Unit"><NativeSelect value={f.unit} onChange={(v) => set({ unit: v })} options={units.map((u) => ({ value: u, label: u }))} /></Field>
          </div>
        )}

        {showExpiry && (
          <div className="space-y-3 rounded-xl border p-3">
            <label className="flex items-center justify-between gap-3 text-sm font-medium">Track expiry date<Switch checked={f.trackExpiry} onCheckedChange={(c) => set({ trackExpiry: c })} /></label>
            {f.trackExpiry && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Batch no."><Input value={f.batchNo} onChange={(e) => set({ batchNo: e.target.value })} placeholder="Optional" /></Field>
                <Field label="Expires" error={err.expiry}><Input type="date" value={f.expiry} onChange={(e) => set({ expiry: e.target.value })} /></Field>
              </div>
            )}
            {gs1?.expiry && <p className="text-xs text-muted-foreground">Batch and expiry were read from the 2D code.</p>}
          </div>
        )}

        {serialsOn && (
          <div className="space-y-3 rounded-xl border p-3">
            <label className="flex items-center justify-between gap-3 text-sm font-medium">Track IMEI / serial numbers<Switch checked={f.trackSerial} onCheckedChange={(c) => set({ trackSerial: c })} /></label>
            {f.trackSerial && !forReceive && (
              <Field label="IMEI / serial numbers" hint={`${serialLines.length} entered. One per line; this becomes your opening stock.`} error={err.serials}>
                <Textarea value={f.serials} onChange={(e) => set({ serials: e.target.value })} rows={4} className="font-mono" />
              </Field>
            )}
          </div>
        )}

        {entry && !other && (
          <button type="button" onClick={() => setReporting(true)} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            <Flag className="size-3.5" />Report wrong info
          </button>
        )}
      </form>

      <SheetFooter className="border-t pb-[max(1rem,env(safe-area-inset-bottom))]">
        <SubmitButton type="submit" form="quick-add" size="xl" busy={busy}>Add product</SubmitButton>
        <Button size="lg" variant="ghost" onClick={onNext}>Skip, scan next</Button>
      </SheetFooter>

      <ConfirmDialog open={reporting} onOpenChange={setReporting} destructive={false} title="Report wrong info?" confirmLabel="Report"
        desc="Tell us this name, brand or size is wrong. Enough reports hide the entry from other shops. You can still add the product with your own details."
        onConfirm={async () => {
          try { await flag({ barcode: scan.code }); toast.success("Thanks, we will check it."); }
          catch (e) { toast.error(errorMessage(e)); }
        }} />
    </>
  );
}

/* ------------------------------------------------------------------ whole flow */

/**
 * Inventory "+ Scan": camera -> lookup -> result sheet -> (add) -> camera again.
 * Controlled: render it next to a button that sets `open`.
 */
export function ScanAdd({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const got = useRef(false);
  const camera = open && !scan;

  function next() {
    got.current = false;
    setScan(null);
  }
  function close() {
    setScan(null);
    onOpenChange(false);
  }
  return (
    <>
      <ScanDialog
        open={camera}
        title="Scan to add"
        onScan={(r) => { got.current = true; setScan(r); }}
        onOpenChange={(o) => { if (!o && !got.current) close(); }}
      />
      <ScanAddSheet scan={open ? scan : null} onClose={close} onNext={next} />
    </>
  );
}
