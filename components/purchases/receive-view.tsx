"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useConvex, useMutation, useQuery } from "convex/react";
import { CheckCircle2, Plus, ScanBarcode, ScanLine, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Banner, EmptyState, Field, Money, PageHeader, Panel, SubmitButton } from "@/components/common";
import { useBiz } from "@/components/guard";
import { Button } from "@/components/ui/button";
import { ScanDialog, type ScanResult } from "@/components/scanner/camera-scanner";
import { PhoneScannerButton } from "@/components/scanner/phone-pair";
import { ScanAddSheet } from "@/components/inventory/scan-add";
import { isValidImei } from "@/convex/shared/barcode";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCents, parseToCents } from "@/convex/shared/money";
import { hasPermission } from "@/convex/shared/permissions";
import { useFeature } from "@/lib/features";
import { parseSerials, serialProblem } from "@/lib/packs";
import { run } from "@/lib/run";
import { cn } from "@/lib/utils";
import { MoneyInput, NativeSelect, Segmented, centsToInput, expiryMs, fmtQty, parseQty, useDebounced } from "@/components/inventory/bits";
import { PAY_METHODS, type PayMethod } from "./shared";
import { SupplierPicker } from "./supplier-picker";

type Line = {
  key: number; productId: Id<"products">; name: string; unit: string; allowDecimal: boolean; trackExpiry: boolean;
  qty: string; cost: string; batchNo: string; expiry: string;
  /** packs of the product ("box = 10 pcs"); `unitName` is the one this line is entered in ("" = the base unit) */
  units: { name: string; factor: number }[]; unitName: string;
  /** IMEI products: one number per unit received */
  trackSerial: boolean; serialsText: string;
};
type Found = {
  _id: Id<"products">; name: string; variantLabel?: string; unit: string; allowDecimal: boolean; trackExpiry: boolean; costCents?: number; stock: number;
  units?: { name: string; factor: number }[]; trackSerial?: boolean;
};

let lineKey = 1;
const toLine = (p: Found, qty = "1"): Line => ({
  key: lineKey++, productId: p._id, name: p.variantLabel ? `${p.name} (${p.variantLabel})` : p.name, unit: p.unit, allowDecimal: p.allowDecimal,
  trackExpiry: p.trackExpiry, qty, cost: p.costCents ? centsToInput(p.costCents) : "", batchNo: "", expiry: "",
  units: (p.units ?? []).map((u) => ({ name: u.name, factor: u.factor })), unitName: "", trackSerial: p.trackSerial ?? false, serialsText: "",
});
const factorOf = (l: Line) => l.units.find((u) => u.name === l.unitName)?.factor ?? 1;

export function ReceiveView() {
  const me = useBiz();
  const cur = me.business.currency;
  const convex = useConvex();
  const params = useSearchParams();
  const create = useMutation(api.purchases.create);
  const seeCost = hasPermission(me.member, "seeCost");
  const unitsOn = useFeature("units");

  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [other, setOther] = useState("");
  const [mode, setMode] = useState<"full" | "part" | "credit">("full");
  const [part, setPart] = useState("");
  const [method, setMethod] = useState<PayMethod>("CASH");
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim());
  const [showErr, setShowErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ number: number; total: number } | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const results = useQuery(api.products.list, search ? { search } : "skip");

  // Prefill from Low stock: ?items=id:qty,id:qty
  const prefill = params.get("items");
  const prefilled = useRef(false);
  useEffect(() => {
    if (!prefill || prefilled.current) return;
    prefilled.current = true;
    const pairs = prefill.split(",").slice(0, 40).map((s) => s.split(":"));
    Promise.all(pairs.map(([id]) => convex.query(api.products.get, { productId: id as Id<"products"> }).catch(() => null))).then((got) => {
      const next: Line[] = [];
      got.forEach((g, i) => {
        if (!g || g.product.type !== "STOCKABLE" || g.product.hasVariants || g.product.isArchived) return;
        next.push(toLine(g.product, pairs[i][1] || "1"));
        if (g.supplier) setSupplierId((s) => s || g.supplier!._id);
      });
      setLines((l) => [...l, ...next]);
    });
  }, [prefill, convex]);

  const addable = results?.filter((p) => p.type === "STOCKABLE" && !p.hasVariants);

  function add(p: Found) {
    setLines((ls) => {
      const have = ls.find((l) => l.productId === p._id);
      return have ? ls.map((l) => (l === have ? { ...l, qty: String((parseQty(l.qty) ?? 0) + 1) } : l)) : [...ls, toLine(p)];
    });
    setQ("");
    searchBox.current?.focus();
  }

  // Scanner / Enter: exact code match, else the only result.
  async function onEnter() {
    const code = q.trim();
    if (!code) return;
    const found = await run(convex.query(api.products.list, { search: code }));
    if (!found) return;
    const ok = found.filter((p) => p.type === "STOCKABLE" && !p.hasVariants);
    const exact = ok.find((p) => p.barcode === code || p.sku === code || p.extraBarcodes.includes(code));
    const pick = exact ?? (ok.length === 1 ? ok[0] : undefined);
    if (pick) add(pick);
    else toast.error(ok.length ? "Several products match. Pick one from the list." : "No product found for that code.");
  }

  /* ---- scan mode: camera or paired phone. Known codes add/increment a line; unknown ones wait in "needs details". */
  const [scanOpen, setScanOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [unknown, setUnknown] = useState<ScanResult[]>([]);
  const [detail, setDetail] = useState<ScanResult | null>(null);
  const linesRef = useRef(lines);
  useEffect(() => { linesRef.current = lines; });

  function addScanned(p: Found, unitName: string, gs1?: ScanResult["gs1"]) {
    setLines((ls) => {
      const have = ls.find((l) => l.productId === p._id && l.unitName === unitName);
      const patch = p.trackExpiry && gs1 ? { ...(gs1.batch ? { batchNo: gs1.batch } : {}), ...(gs1.expiry ? { expiry: gs1.expiry } : {}) } : {};
      if (have) return ls.map((l) => (l === have ? { ...l, ...patch, qty: String((parseQty(l.qty) ?? 0) + 1) } : l));
      const base = toLine(p);
      const f = base.units.find((u) => u.name === unitName)?.factor ?? 1;
      return [...ls, { ...base, ...patch, unitName, cost: p.costCents ? centsToInput(p.costCents * f) : "" }];
    });
  }

  async function scanCode(r: ScanResult) {
    const code = r.code.trim();
    if (!code) return;
    // an IMEI / serial for a serial-tracked line goes into that line
    const serialLine = [...linesRef.current].reverse().find((l) => l.trackSerial);
    const res = await run(convex.query(api.catalog.lookup, { code }));
    if (!res) return;
    if (res.local) {
      const { product: p, unit } = res.local;
      if (p.type !== "STOCKABLE" || p.hasVariants) { toast.error(`${p.name} cannot be received this way.`); return; }
      addScanned(p, unit?.name ?? "", r.gs1);
      setRecent((x) => [`${p.name}${unit ? ` (${unit.name})` : ""}`, ...x].slice(0, 3));
      return;
    }
    if (serialLine && isValidImei(code) && !parseSerials(serialLine.serialsText).includes(code.toUpperCase())) {
      setLine(serialLine.key, { serialsText: (serialLine.serialsText.trim() ? serialLine.serialsText.trimEnd() + "\n" : "") + code });
      setRecent((x) => [`Serial ${code} for ${serialLine.name}`, ...x].slice(0, 3));
      return;
    }
    setUnknown((u) => (u.some((x) => x.code === code) ? u : [...u, r]));
    setRecent((x) => [`${code} needs details`, ...x].slice(0, 3));
  }

  async function detailsAdded(id: Id<"products">) {
    const g = await run(convex.query(api.products.get, { productId: id }));
    if (g) addScanned(g.product, "", detail?.gs1);
    setUnknown((u) => u.filter((x) => x.code !== detail?.code));
  }

  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  /** Switch the pack a line is entered in; the cost typed so far is converted so the price per base unit stays the same. */
  const setUnit = (l: Line, unitName: string) => {
    const next = { ...l, unitName };
    const c = parseToCents(l.cost);
    setLine(l.key, { unitName, cost: c ? centsToInput(Math.round((c * factorOf(next)) / factorOf(l))) : l.cost });
  };

  // numbers
  const parsed = lines.map((l) => ({ l, qty: parseQty(l.qty), cost: parseToCents(l.cost) }));
  const itemsTotal = parsed.reduce((s, x) => s + (x.qty && x.cost !== null ? Math.round(x.qty * x.cost) : 0), 0);
  const otherCents = other.trim() ? parseToCents(other) : 0;
  const total = itemsTotal + (otherCents ?? 0);
  const partCents = part.trim() ? parseToCents(part) : 0;
  const paid = mode === "full" ? total : mode === "credit" ? 0 : Math.min(partCents ?? 0, total);
  const credit = total - paid;

  function lineErr(x: (typeof parsed)[number]) {
    const e: Record<string, string> = {};
    if (x.qty === null || x.qty <= 0) e.qty = "Enter a quantity.";
    else if ((!x.l.allowDecimal || x.l.trackSerial) && !Number.isInteger(x.qty)) e.qty = "Whole numbers only.";
    if (x.l.trackSerial) {
      const list = parseSerials(x.l.serialsText);
      if (list.length !== (x.qty ?? 0)) e.serials = `Enter exactly ${x.qty ?? 0} IMEI / serial numbers (you have ${list.length}).`;
      else if (list.some((s) => serialProblem(s))) e.serials = "Some numbers are not valid. Check the ones marked below.";
    }
    if (x.cost === null) e.cost = "Enter the unit cost.";
    if (x.l.trackExpiry && !x.l.expiry) e.expiry = "Expiry date needed.";
    return e;
  }
  const lineProblems = parsed.reduce((n, x) => n + Object.keys(lineErr(x)).length, 0);
  const topErr: string[] = [];
  if (otherCents === null) topErr.push("Other costs must be an amount like 12.50.");
  if (mode === "part" && (partCents === null || partCents <= 0)) topErr.push("Enter how much you paid now.");
  if (mode === "part" && partCents !== null && partCents > total) topErr.push("Paid now is more than the total.");
  if (credit > 0 && !supplierId && topErr.length === 0) topErr.push("Choose a supplier to buy on credit.");

  async function submit() {
    setShowErr(true);
    if (lines.length === 0) { toast.error("Add at least one product."); return; }
    if (lineProblems || topErr.length) { toast.error("Please fix the highlighted fields."); return; }
    setBusy(true);
    const r = await run(create({
      supplierId: supplierId ? (supplierId as Id<"suppliers">) : undefined,
      items: parsed.map((x) => ({
        productId: x.l.productId, qty: x.qty!, unitCostCents: x.cost!,
        unitName: unitsOn && x.l.unitName ? x.l.unitName : undefined,
        serials: x.l.trackSerial ? parseSerials(x.l.serialsText) : undefined,
        batchNo: x.l.trackExpiry ? x.l.batchNo.trim() || undefined : undefined,
        expiryDate: x.l.trackExpiry && x.l.expiry ? expiryMs(x.l.expiry) : undefined,
      })),
      otherCostCents: otherCents ?? 0, paidCents: paid, paidMethod: paid > 0 ? method : undefined, note: note.trim(),
    }));
    setBusy(false);
    if (r) setDone({ number: r.number, total });
  }

  function reset() {
    setSupplierId(""); setLines([]); setOther(""); setMode("full"); setPart(""); setNote(""); setShowErr(false); setDone(null);
  }

  if (done) {
    return (
      <>
        <PageHeader title="Receive stock" />
        <Panel>
          <EmptyState icon={CheckCircle2} title={`Purchase #${done.number} saved`} desc={`Stock was added. Purchase total: ${formatCents(done.total, cur)}.`}
            action={<div className="flex flex-wrap justify-center gap-2"><Button size="lg" onClick={reset}><Plus />Receive more</Button><Button size="lg" variant="outline" asChild><Link href="/apps/purchases?view=history">View purchases</Link></Button></div>} />
        </Panel>
      </>
    );
  }

  const summary = (
    <div className="space-y-4">
      <Panel className="space-y-4 p-4">
        <h2 className="font-display text-base font-semibold">Payment</h2>
        <Field label="Other costs" hint="Transport or customs, shared across products" error={showErr && otherCents === null ? "Enter an amount like 12.50." : undefined}>
          <MoneyInput cur={cur} value={other} onChange={setOther} placeholder="0.00" />
        </Field>
        <dl className="space-y-1.5 border-t pt-3 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Products</dt><dd className="tabular-nums">{formatCents(itemsTotal, cur)}</dd></div>
          {!!otherCents && <div className="flex justify-between"><dt className="text-muted-foreground">Other costs</dt><dd className="tabular-nums">{formatCents(otherCents, cur)}</dd></div>}
          <div className="flex items-baseline justify-between"><dt className="font-medium">Total</dt><dd className="font-display text-3xl font-semibold tabular-nums tracking-tight">{formatCents(total, cur)}</dd></div>
        </dl>
        <div className="space-y-2">
          <p className="text-sm font-medium">How did you pay?</p>
          <Segmented label="Payment" value={mode} onChange={setMode} options={[{ value: "full", label: "Paid all" }, { value: "part", label: "Part paid" }, { value: "credit", label: "On credit" }]} />
        </div>
        {mode === "part" && <Field label="Paid now"><MoneyInput cur={cur} value={part} onChange={setPart} placeholder="0.00" /></Field>}
        {paid > 0 && (
          <div className="space-y-1.5"><p className="text-sm font-medium">Paid with</p><NativeSelect aria-label="Payment method" value={method} onChange={(v) => setMethod(v as PayMethod)} options={PAY_METHODS.map((m) => ({ value: m.value, label: m.label }))} /></div>
        )}
        {credit > 0 && (
          <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">On credit to supplier: <b className="tabular-nums">{formatCents(credit, cur)}</b></p>
        )}
        <Field label="Note" hint="Optional, e.g. invoice number"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {showErr && topErr.map((t) => <p key={t} role="alert" className="text-xs text-danger">{t}</p>)}
        <SubmitButton size="xl" className="hidden w-full lg:inline-flex" busy={busy} onClick={submit}>Receive stock</SubmitButton>
      </Panel>
    </div>
  );

  return (
    <div className="pb-28 lg:pb-0">
      <PageHeader title="Receive stock" desc="Record goods from a supplier. Stock and cost update automatically." />
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <Panel className="space-y-4 p-4">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Supplier</p>
              <SupplierPicker value={supplierId} onChange={setSupplierId} placeholder="No supplier (cash purchase)" />
            </div>
          </Panel>

          <Panel>
            <div className="space-y-2 border-b p-4">
              <p className="text-sm font-medium">Add products</p>
              <div className="flex gap-2">
                <Button type="button" size="lg" className="h-12" onClick={() => setScanOpen(true)}><ScanLine />Scan items</Button>
                <PhoneScannerButton target="RECEIVE" label="Phone" size="lg" className="h-12" onScan={(code) => void scanCode({ code, format: "phone" })} />
              </div>
              {unknown.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning" role="status">
                  <span className="font-medium">Needs details:</span>
                  {unknown.map((u) => <Button key={u.code} size="sm" variant="outline" className="h-8 bg-card tabular-nums" onClick={() => setDetail(u)}>{u.code}</Button>)}
                </div>
              )}
              <div className="relative">
                <ScanBarcode className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input ref={searchBox} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnter(); } }}
                  placeholder="Scan a barcode or type a product name" aria-label="Find a product" className="h-12 pl-9" />
              </div>
              {search && (
                <ul className="max-h-64 divide-y overflow-y-auto rounded-xl border" role="listbox" aria-label="Matching products">
                  {addable === undefined ? <li className="px-3 py-3 text-sm text-muted-foreground">Searching...</li> : addable.length === 0 ? (
                    <li className="px-3 py-3 text-sm text-muted-foreground">No stockable product found. <Link href="/apps/inventory/new" className="font-medium text-brand-700 underline">Create it</Link></li>
                  ) : addable.map((p) => (
                    <li key={p._id}>
                      <button type="button" onClick={() => add(p)} className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted">
                        <span className="min-w-0"><span className="block truncate font-medium">{p.name}{p.variantLabel && ` (${p.variantLabel})`}</span><span className="block text-xs text-muted-foreground">{p.sku || p.barcode || "No code"}</span></span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{fmtQty(p.stock)} {p.unit} in stock</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {lines.length === 0 ? (
              <EmptyState icon={Truck} title="No products added yet" desc="Scan a barcode or search above to add what you received." />
            ) : (
              <ul className="divide-y">
                {parsed.map((x) => {
                  const l = x.l;
                  const e = showErr ? lineErr(x) : {};
                  const lt = x.qty && x.cost !== null ? Math.round(x.qty * x.cost) : 0;
                  return (
                    <li key={l.key} className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 font-medium">{l.name}</p>
                        <div className="flex items-center gap-2">
                          <Money className="font-semibold">{formatCents(lt, cur)}</Money>
                          <Button variant="ghost" size="icon-lg" className="-my-1.5 text-danger" aria-label={`Remove ${l.name}`} onClick={() => setLines((ls) => ls.filter((z) => z.key !== l.key))}><Trash2 /></Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Field label={`Quantity (${l.unitName || l.unit})`} error={e.qty} hint={l.unitName && x.qty ? `= ${fmtQty(x.qty * factorOf(l))} ${l.unit}` : undefined}><Input inputMode={l.allowDecimal ? "decimal" : "numeric"} value={l.qty} onChange={(ev) => setLine(l.key, { qty: ev.target.value })} className="h-11 tabular-nums" aria-invalid={!!e.qty} /></Field>
                        {unitsOn && !l.trackSerial && l.units.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-sm font-medium">Received in</p>
                            <NativeSelect aria-label={`Unit for ${l.name}`} value={l.unitName} onChange={(v) => setUnit(l, v)} className="h-11"
                              options={[{ value: "", label: l.unit }, ...l.units.map((u) => ({ value: u.name, label: `${u.name} (= ${fmtQty(u.factor)} ${l.unit})` }))]} />
                          </div>
                        )}
                        <Field label={l.unitName ? `Cost per ${l.unitName}` : "Unit cost"} error={e.cost}><MoneyInput cur={cur} value={l.cost} onChange={(cost) => setLine(l.key, { cost })} className="h-11" placeholder={seeCost ? "0.00" : "What you paid"} aria-invalid={!!e.cost} /></Field>
                        {l.trackExpiry && (
                          <>
                            <Field label="Batch no" hint="Optional"><Input value={l.batchNo} onChange={(ev) => setLine(l.key, { batchNo: ev.target.value })} className="h-11" /></Field>
                            <Field label="Expiry date" required error={e.expiry}><Input type="date" value={l.expiry} onChange={(ev) => setLine(l.key, { expiry: ev.target.value })} className="h-11" aria-invalid={!!e.expiry} /></Field>
                          </>
                        )}
                      </div>
                      {l.trackSerial && <SerialsEntry text={l.serialsText} onChange={(serialsText) => setLine(l.key, { serialsText })} want={x.qty ?? 0} error={e.serials} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          {lines.length > 0 && showErr && lineProblems > 0 && <Banner tone="danger">Some products need attention: check the red messages above.</Banner>}
        </div>
        <aside className="lg:sticky lg:top-20">{summary}</aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t bg-card/95 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{lines.length} product{lines.length === 1 ? "" : "s"}{credit > 0 && " · on credit " + formatCents(credit, cur)}</p><p className="font-display text-xl font-semibold tabular-nums">{formatCents(total, cur)}</p></div>
        <SubmitButton size="xl" busy={busy} onClick={submit}>Receive stock</SubmitButton>
      </div>

      <ScanDialog open={scanOpen} onOpenChange={setScanOpen} continuous title="Scan items to receive" onScan={(r) => void scanCode(r)}>
        <div className="text-sm" aria-live="polite">
          <p className="font-medium">{lines.length} product{lines.length === 1 ? "" : "s"} on this receipt{unknown.length ? `, ${unknown.length} need details` : ""}</p>
          {recent.map((r, i) => <p key={i} className="truncate text-muted-foreground">{r}</p>)}
        </div>
      </ScanDialog>
      <ScanAddSheet forReceive scan={detail} onClose={() => setDetail(null)} onNext={() => setDetail(null)} onAdded={detailsAdded} />
    </div>
  );
}

/** One IMEI / serial number per line (scan or paste); shows how many are entered versus received. */
function SerialsEntry({ text, onChange, want, error }: { text: string; onChange: (v: string) => void; want: number; error?: string }) {
  const list = parseSerials(text);
  const bad = list.filter((s) => serialProblem(s));
  const match = list.length === want;
  return (
    <div className="space-y-1.5">
      <Field label="IMEI / serial numbers" hint="One per line. Scan each phone or paste a list." error={error}>
        <Textarea rows={Math.min(Math.max(want, 3), 8)} value={text} onChange={(ev) => onChange(ev.target.value)} className="font-mono tabular-nums" spellCheck={false} placeholder={"356938035643809\n356938035643817"} aria-invalid={!!error} />
      </Field>
      <p className={cn("text-sm font-medium tabular-nums", match ? "text-success" : "text-warning")} aria-live="polite">{list.length} of {want} entered</p>
      {bad.slice(0, 3).map((s) => <p key={s} className="text-xs text-danger"><span className="font-mono">{s}</span>: {serialProblem(s)}</p>)}
    </div>
  );
}
