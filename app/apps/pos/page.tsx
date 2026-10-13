"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { Banknote, History, LayoutGrid, Minus, Pause, Percent, Plus, ScanLine, Search, ShieldCheck, ShoppingCart, Tag, Trash2, Undo2, UserRound, Wifi, WifiOff, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useBiz } from "@/components/guard";
import { ScanDialog } from "@/components/scanner/camera-scanner";
import { PhoneScannerButton } from "@/components/scanner/phone-pair";
import { Banner, EmptyState, Pill } from "@/components/common";
import { CustomerPicker } from "@/components/pos/customer-picker";
import { DiscountDialog } from "@/components/pos/discount-dialog";
import { HeldOrdersDialog, useHeld, type Held } from "@/components/pos/held-orders";
import { KeypadDialog } from "@/components/pos/keypad-dialog";
import { PaymentDialog, type PayRow } from "@/components/pos/payment-dialog";
import { ReturnsDialog } from "@/components/pos/returns-dialog";
import { SerialPicker } from "@/components/pos/serial-picker";
import { ShiftBar } from "@/components/pos/shift-bar";
import { UnitSheet, packCents, type PackChoice } from "@/components/pos/unit-sheet";
import { WarrantyDialog } from "@/components/pos/warranty-dialog";
import { METHOD_LABEL, ReceiptDialog, type ReceiptData } from "@/components/receipt";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { canOpenApp } from "@/convex/shared/modules";
import { errorMessage } from "@/convex/shared/errors";
import { DAY_MS } from "@/convex/shared/expiry";
import { formatCents } from "@/convex/shared/money";
import { hasPermission } from "@/convex/shared/permissions";
import { baseQty, fmtQty, lineKey, totals, unitPrice, useCart, type CartLine } from "@/lib/cart";
import { useAttributeDefs, useFeature } from "@/lib/features";
import { addMonths } from "@/lib/packs";
import {
  addToOutbox, discardFromOutbox, flushOutbox, listOutbox, loadCatalog, onOutboxChange, saveCatalog,
  type CatalogItem, type CategoryItem, type OutboxSale, type PayMethod,
} from "@/lib/outbox";
import { fmtDateTime } from "@/lib/session";
import { cn } from "@/lib/utils";

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);
  return online;
}

type DiscTarget = { line: string } | "order" | null;

export default function PosPage() {
  const me = useBiz();
  const { business, plan } = me;
  const cur = business.currency;
  const st = business.settings;
  const role = me.member.role as "OWNER" | "MANAGER" | "CASHIER";
  const taxRate = st.taxRatePercent;
  const key = business._id;
  const m = useCallback((c: number) => formatCents(c, cur), [cur]);
  const canDiscount = hasPermission(me.member, "giveDiscount");
  const canRefund = hasPermission(me.member, "refund");
  const canCustomers = canOpenApp(role, plan.modules, "customers");
  const methods = useMemo(() => (["CASH", "EVC", "ZAAD", "EDAHAB", "BANK", "CREDIT"] as PayMethod[]).filter((x) =>
    (x === "CASH" || st.paymentMethods.includes(x)) && (x !== "CREDIT" || canCustomers)), [st.paymentMethods, canCustomers]);

  // ---- catalog (live, cached for offline) ----
  const live = useQuery(api.products.posCatalog);
  const liveCats = useQuery(api.categories.list);
  const [cached, setCached] = useState<CatalogItem[]>();
  const [cachedCats, setCachedCats] = useState<CategoryItem[]>();
  useEffect(() => {
    loadCatalog<CatalogItem[]>(key).then(setCached);
    loadCatalog<CategoryItem[]>(`${key}:cats`).then(setCachedCats);
  }, [key]);
  useEffect(() => { if (live) saveCatalog(key, live); }, [live, key]);
  useEffect(() => { if (liveCats) saveCatalog(`${key}:cats`, liveCats); }, [liveCats, key]);
  const catalog = live ?? cached;
  const cats = (liveCats ?? cachedCats) as CategoryItem[] | undefined;

  // ---- offline outbox ----
  const online = useOnline();
  const create = useMutation(api.sales.create);
  const [pending, setPending] = useState(0);
  const refreshPending = useCallback(() => { listOutbox().then((l) => setPending(l.length)); }, []);
  useEffect(() => { refreshPending(); return onOutboxChange(refreshPending); }, [refreshPending]);
  const flush = useCallback(async () => {
    const results = await flushOutbox(create);
    for (const r of results) {
      if (r.ok === false) toast.error(`Sale of ${formatCents(r.sale.snapshot.totalCents, cur)} was rejected: ${errorMessage(r.error)}`);
    }
    return results;
  }, [create, cur]);
  useEffect(() => {
    flush();
    const on = () => flush();
    window.addEventListener("online", on);
    const t = setInterval(on, 30_000);
    return () => { window.removeEventListener("online", on); clearInterval(t); };
  }, [flush]);

  // ---- cart ----
  const { lines, orderDisc, customer, note, add, setQty, remove, setLineDisc, setSerials, setOrderDisc, setCustomer, setNote, restore, clear } = useCart();
  const convex = useConvex();
  const unitsOn = useFeature("units");
  const serialsOn = useFeature("serials");
  const searchableAttrs = useAttributeDefs().filter((d) => d.searchable).map((d) => d.label.toLowerCase());
  const wholesale = customer?.group === "WHOLESALE";
  const t = useMemo(() => totals(lines, orderDisc, taxRate, wholesale), [lines, orderDisc, taxRate, wholesale]);
  const overLimit = role !== "OWNER" && t.discountPercent > st.maxCashierDiscountPercent + 1e-9;
  const itemCount = lines.reduce((n, l) => n + (l.allowDecimal ? 1 : l.qty), 0); // a weighed item counts once
  const inCart = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty);
    return m;
  }, [lines]);

  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [cartOpen, setCartOpen] = useState(false);
  const [dlg, setDlg] = useState<"pay" | "held" | "returns" | "recent" | "warranty" | null>(null);
  const [unitFor, setUnitFor] = useState<CatalogItem | null>(null); // product whose pack is being chosen
  const [serialFor, setSerialFor] = useState<CatalogItem | null>(null); // product whose IMEIs are being chosen
  const [camera, setCamera] = useState(false); // camera scanner dialog
  const [picker, setPicker] = useState(false); // opens above the payment dialog without closing it
  const [receipt, setReceipt] = useState<{ saleId?: Id<"sales">; local?: ReceiptData }>();
  const [keypad, setKeypad] = useState<{ id: Id<"products">; key?: string; name: string; unit: string; initial?: number; item?: CatalogItem } | null>(null);
  const [discTarget, setDiscTarget] = useState<DiscTarget>(null);
  const { list: held, hold, drop } = useHeld(key);

  const catChips = useMemo(() => {
    const used = new Set((catalog ?? []).map((p) => p.categoryId).filter(Boolean));
    return (cats ?? []).filter((c) => used.has(c._id));
  }, [catalog, cats]);
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (catalog ?? []).filter((p) =>
      (cat === "all" || p.categoryId === cat) &&
      (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.barcode.includes(s) || p.extraBarcodes.some((b) => b.includes(s)) ||
        (p.units ?? []).some((u) => u.barcode && u.barcode.includes(s)) || (p.attrs && Object.values(p.attrs).some((v) => v.toLowerCase().includes(s)))));
  }, [catalog, search, cat]);

  /** A cart line for a product, in its base unit or in a pack. */
  const lineOf = (p: CatalogItem, unit?: PackChoice, serials?: string[]): Omit<CartLine, "qty" | "disc"> => {
    const counted = p.type === "STOCKABLE";
    const common = { productId: p._id, name: p.name, allowDecimal: p.allowDecimal, stock: counted ? p.stock : null, serials, warrantyMonths: serials ? p.warrantyMonths : undefined };
    if (!unit) return { ...common, unit: p.unit, retailCents: p.priceCents, wholesaleCents: p.wholesalePriceCents };
    return {
      ...common, unit: unit.name, unitName: unit.name, unitFactor: unit.factor, retailCents: packCents(p, unit, false),
      // a pack with its own price has no separate wholesale price (the server uses the pack price for everyone)
      wholesaleCents: unit.priceCents === undefined && p.wholesalePriceCents !== undefined ? packCents(p, unit, true) : undefined,
    };
  };

  /** Add `qty` of a product (in a pack, or specific serials), or explain why not. */
  const addProduct = useCallback((p: CatalogItem, qty = 1, unit?: PackChoice, serials?: string[]) => {
    if (p.allExpired) return void toast.error(`${p.name} is expired and cannot be sold.`);
    const counted = p.type === "STOCKABLE";
    const have = useCart.getState().lines.filter((l) => l.productId === p._id).reduce((n, l) => n + baseQty(l), 0);
    if (counted && !serials && !st.allowNegativeStock && have + qty * (unit?.factor ?? 1) > p.stock + 1e-9) {
      return void toast.error(p.stock <= 0 ? `${p.name} is out of stock.` : `Only ${fmtQty(p.stock)} ${p.unit} of ${p.name} in stock.`);
    }
    add(lineOf(p, unit, serials), qty);
  }, [add, st.allowNegativeStock]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Tap or scan a product: IMEI products open the picker, products with packs ask which pack. */
  const tapProduct = (p: CatalogItem) => {
    if (p.allExpired) return void toast.error(`${p.name} is expired and cannot be sold.`);
    if (p.trackSerial) {
      if (!navigator.onLine) return void toast.error("IMEI items can only be sold online, so the number can be checked. Reconnect and try again.");
      return setSerialFor(p);
    }
    if (unitsOn && (p.units ?? []).length > 0) return setUnitFor(p);
    if (p.allowDecimal) return setKeypad({ id: p._id, name: p.name, unit: p.unit, item: p });
    addProduct(p);
  };
  const pickPack = (p: CatalogItem, u: PackChoice | null) => {
    setUnitFor(null);
    if (u) addProduct(p, 1, u);
    else if (p.allowDecimal) setKeypad({ id: p._id, name: p.name, unit: p.unit, item: p });
    else addProduct(p);
  };
  const applySerials = (p: CatalogItem, serials: string[]) => {
    setSerialFor(null);
    const key = lineKey({ productId: p._id });
    if (lines.some((l) => lineKey(l) === key)) setSerials(key, serials);
    else if (serials.length) addProduct(p, serials.length, undefined, serials);
  };

  // ---- barcode scanner: hidden, auto-focused input; scanner types digits + Enter ----
  const scan = useRef<HTMLInputElement>(null);
  const modalOpen = !!dlg || camera || picker || cartOpen || !!receipt || !!keypad || !!unitFor || !!serialFor || discTarget !== null;
  useEffect(() => {
    if (modalOpen) return;
    const focus = () => { const a = document.activeElement; if (!a || a === document.body) scan.current?.focus(); };
    focus();
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest("input, textarea, select, [role=dialog], [role=menu], [role=menuitem]")) {
        setTimeout(() => { if (!document.querySelector("[role=dialog]")) scan.current?.focus(); }, 0);
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [modalOpen]);
  /** A product by barcode, or by the barcode of one of its packs (then the pack is returned too). */
  const byCode = useCallback((code: string): { p: CatalogItem; unit?: PackChoice } | undefined => {
    for (const x of catalog ?? []) {
      if (x.barcode === code || x.extraBarcodes.includes(code)) return { p: x };
      const unit = (x.units ?? []).find((u) => u.barcode && u.barcode === code);
      if (unit) return { p: x, unit };
    }
    return undefined;
  }, [catalog]);
  /** Scan or Enter: a barcode adds the product (or pack); an IMEI in stock adds that exact unit. */
  async function onScan(code: string) {
    const c = code.trim();
    if (!c) return;
    const hit = byCode(c);
    if (hit) return hit.unit ? addProduct(hit.p, 1, hit.unit) : tapProduct(hit.p);
    if (serialsOn && navigator.onLine && /^[A-Za-z0-9][A-Za-z0-9\-_./]{5,63}$/.test(c)) {
      const r = await convex.query(api.serials.lookup, { serial: c }).catch(() => null);
      if (r) {
        const prod = catalog?.find((x) => x._id === r.product?._id);
        if (prod && r.serial.status === "IN_STOCK") return addProduct(prod, 1, undefined, [r.serial.serial]);
        return void toast.error(`${r.serial.serial} is ${r.serial.status === "SOLD" ? "already sold" : "not in stock"}.`);
      }
    }
    toast.error(`No product with barcode ${c}.`);
  }

  // ---- hold / resume ----
  function holdCurrent() {
    if (lines.length === 0) return;
    hold({ lines, orderDisc, customer, note });
    clear();
    setCartOpen(false);
    toast.success("Order held. Find it under Held.");
  }
  function resume(h: Held) {
    if (lines.length > 0) hold({ lines, orderDisc, customer, note }); // swap, nothing is lost
    restore({ lines: h.lines, orderDisc: h.orderDisc, customer: h.customer, note: h.note });
    drop(h.id);
    setDlg(null);
    setCartOpen(false);
  }

  // ---- pay ----
  async function pay(payments: PayRow[]) {
    const hasCredit = payments.some((p) => p.method === "CREDIT");
    const hasSerials = lines.some((l) => l.serials?.length);
    if (hasSerials && !navigator.onLine) return void toast.error("Sales with IMEI numbers need an internet connection, so each number can be checked. Reconnect and try again.");
    if (hasCredit && !navigator.onLine) return void toast.error("Credit sales need an internet connection.");
    const paid = payments.reduce((n, p) => n + p.amountCents, 0);
    const changeCents = Math.max(paid - t.totalCents, 0);
    const sale: OutboxSale = {
      v: 2,
      clientSaleId: crypto.randomUUID(),
      items: lines.map((l, i) => ({ productId: l.productId, qty: l.qty, discountCents: t.rows[i].discount, unitName: l.unitName, serials: l.serials })),
      orderDiscountCents: t.orderDiscountCents,
      payments,
      customerId: customer?.id,
      note: note.trim() || undefined,
      createdAt: Date.now(),
      snapshot: {
        lines: lines.map((l, i) => ({
          name: l.name, qty: l.qty, priceCents: t.rows[i].price, discountCents: t.rows[i].discount, unitName: l.unitName, serials: l.serials,
          warrantyUntil: l.serials && l.warrantyMonths ? addMonths(Date.now(), l.warrantyMonths) : undefined,
        })),
        taxCents: t.taxCents, totalCents: t.totalCents, changeCents, customerName: customer?.name,
      },
    };
    await addToOutbox(sale);
    const mine = (await flush()).find((r) => r.sale.clientSaleId === sale.clientSaleId);
    if (mine && !mine.ok) return; // rejected: already toasted, keep the cart so the cashier can fix it
    if (!mine && (hasCredit || hasSerials)) {
      await discardFromOutbox(sale.clientSaleId);
      return void toast.error(hasSerials ? "No connection. Sales with IMEI numbers need internet." : "No connection. Credit sales need internet.");
    }
    const local: ReceiptData = {
      businessName: business.name, logoUrl: me.logoUrl, phone: business.phone, address: business.address,
      header: st.receiptHeader, footer: st.receiptFooter, currency: cur,
      receiptNo: mine?.ok ? mine.receiptNo : null, createdAt: sale.createdAt, cashierName: me.member.fullName, customerName: customer?.name,
      items: sale.snapshot.lines, orderDiscountCents: t.orderDiscountCents, taxCents: t.taxCents, totalCents: t.totalCents,
      payments, changeCents,
    };
    clear();
    setDlg(null);
    setCartOpen(false);
    setReceipt({ saleId: mine?.ok ? mine.saleId : undefined, local });
    toast.success(mine?.ok ? `Sale #${mine.receiptNo} complete` : "Saved offline. It will sync when you are back online.");
  }

  const discLine = discTarget && discTarget !== "order" ? lines.find((l) => lineKey(l) === discTarget.line) : undefined;
  const discBase = discTarget === "order" ? t.subtotalCents : discLine ? t.rows[lines.indexOf(discLine)]?.gross ?? 0 : 0;

  const cartPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <h2 className="font-display text-base font-semibold">Current sale <span className="ml-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800 tabular-nums">{fmtQty(itemCount)}</span></h2>
        <div className="flex items-center gap-1">
          {lines.length > 0 && <Button variant="ghost" size="lg" onClick={holdCurrent}><Pause /> Hold</Button>}
          {lines.length > 0 && <Button variant="ghost" size="lg" className="text-muted-foreground" onClick={clear}>Clear</Button>}
        </div>
      </div>

      {canCustomers && (
        <div className="shrink-0 border-b px-3 py-2">
          {customer ? (
            <div className="flex items-center gap-2">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700"><UserRound className="size-4" /></span>
              <div className="min-w-0 flex-1 text-sm">
                <p className="flex items-center gap-1.5 truncate font-medium">{customer.name}{customer.group !== "RETAIL" && <Pill tone={wholesale ? "blue" : "brand"}>{customer.group === "WHOLESALE" ? "Wholesale" : "VIP"}</Pill>}</p>
                <p className="truncate text-xs tabular-nums text-muted-foreground">
                  {customer.balanceCents > 0 ? <span className="text-danger">owes {m(customer.balanceCents)}</span> : customer.balanceCents < 0 ? <span className="text-success">credit {m(-customer.balanceCents)}</span> : "No balance"}
                  {customer.creditLimitCents > 0 ? ` · limit ${m(customer.creditLimitCents)}` : " · no credit"}
                  {customer.creditBlocked && <span className="font-semibold text-danger"> · BLOCKED</span>}
                </p>
              </div>
              <Button size="icon-lg" variant="ghost" aria-label="Remove customer" onClick={() => setCustomer(undefined)}><X /></Button>
            </div>
          ) : (
            <Button variant="outline" size="lg" className="w-full justify-start text-muted-foreground" onClick={() => setPicker(true)}><UserRound /> Add customer (optional)</Button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 divide-y overflow-y-auto">
        {lines.length === 0 ? (
          <EmptyState icon={ShoppingCart} title="Cart is empty" desc="Tap a product or scan a barcode." />
        ) : lines.map((l, i) => (
          <CartRow key={lineKey(l)} l={l} row={t.rows[i]} m={m} canDiscount={canDiscount} wholesale={wholesale}
            onQty={(q) => setQty(lineKey(l), q)} onRemove={() => remove(lineKey(l))}
            onKeypad={() => setKeypad({ id: l.productId, key: lineKey(l), name: l.name, unit: l.unit, initial: l.qty })}
            onSerials={() => { const p = catalog?.find((x) => x._id === l.productId); if (p) setSerialFor(p); }}
            onDiscount={() => setDiscTarget({ line: lineKey(l) })} />
        ))}
      </div>

      <div className="shrink-0 space-y-2 border-t bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm">
        {overLimit && <Banner tone="warning" icon={Percent}>Discount is {t.discountPercent.toFixed(1)}%, above your limit of {st.maxCashierDiscountPercent}%. Reduce it to continue.</Banner>}
        {customer?.creditBlocked && <Banner tone="danger">Credit is blocked for {customer.name}. Cash or mobile only.</Banner>}
        {lines.length > 0 && <Input aria-label="Order note" placeholder="Note (optional)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className="h-10" />}
        <div className="flex justify-between tabular-nums"><span className="text-muted-foreground">Subtotal</span><span>{m(t.grossCents)}</span></div>
        {t.lineDiscountCents > 0 && <div className="flex justify-between tabular-nums text-success"><span>Item discounts</span><span>-{m(t.lineDiscountCents)}</span></div>}
        {canDiscount && lines.length > 0 && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Order discount</span>
            <Button variant={t.orderDiscountCents ? "secondary" : "outline"} size="lg" className="tabular-nums" onClick={() => setDiscTarget("order")}>
              <Tag />{t.orderDiscountCents ? `-${m(t.orderDiscountCents)}${orderDisc?.kind === "PCT" ? ` (${orderDisc.value}%)` : ""}` : "Add"}
            </Button>
          </div>
        )}
        {taxRate > 0 && <div className="flex justify-between tabular-nums"><span className="text-muted-foreground">Tax ({taxRate}%)</span><span>{m(t.taxCents)}</span></div>}
        <div className="flex items-baseline justify-between border-t pt-2"><span className="font-medium">Total</span><span className="font-display text-3xl font-semibold tabular-nums tracking-tight">{m(t.totalCents)}</span></div>
        <Button size="xl" className="w-full" disabled={lines.length === 0 || overLimit} onClick={() => setDlg("pay")}>
          {lines.length > 0 ? `Pay ${m(t.totalCents)}` : "Pay"}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col bg-background">
      <input ref={scan} aria-label="Barcode scanner input" className="pointer-events-none absolute size-0 opacity-0" autoComplete="off"
        onKeyDown={(e) => { if (e.key === "Enter") { onScan(e.currentTarget.value); e.currentTarget.value = ""; } }} />
      <header className="flex h-14 shrink-0 items-center gap-1.5 border-b bg-card px-2 sm:px-3">
        <Button asChild variant="ghost" size="icon-lg" aria-label="Back to apps"><Link href="/apps"><LayoutGrid /></Link></Button>
        <span className="hidden size-7 place-items-center rounded-md bg-brand-100 text-brand-700 sm:grid"><ShoppingCart className="size-4" /></span>
        <span className="hidden font-display font-semibold sm:inline">Point of Sale</span>
        <div className="flex-1" />
        {online ? (
          <Pill tone="green" dot><Wifi className="size-3" /><span className="hidden sm:inline">Online</span>{pending > 0 && ` ${pending} pending`}</Pill>
        ) : (
          <Pill tone="amber" dot><WifiOff className="size-3" />Offline · {pending} pending</Pill>
        )}
        <Button variant="outline" size="lg" aria-label="Held orders" onClick={() => setDlg("held")} className="relative">
          <Pause /><span className="hidden sm:inline">Held</span>
          {held.length > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-gold px-1 text-xs font-bold text-foreground tabular-nums">{held.length}</span>}
        </Button>
        <Button variant="outline" size="lg" aria-label="Return items" onClick={() => setDlg("returns")}><Undo2 /><span className="hidden sm:inline">Return</span></Button>
        <Button variant="outline" size="lg" aria-label="Recent sales" onClick={() => setDlg("recent")}><History /><span className="hidden sm:inline">Recent</span></Button>
        <Button variant="outline" size="lg" aria-label="Scan with camera" onClick={() => setCamera(true)}><ScanLine /><span className="hidden lg:inline">Scan</span></Button>
        <PhoneScannerButton target="POS" size="lg" label="Phone" onScan={(code) => void onScan(code)} />
        {serialsOn && <Button variant="outline" size="lg" aria-label="Warranty check" onClick={() => setDlg("warranty")}><ShieldCheck /><span className="hidden lg:inline">Warranty</span></Button>}
      </header>
      <ShiftBar currency={cur} />

      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_400px]">
        <section className="flex min-h-0 flex-col">
          <div className="space-y-2.5 p-3">
            <div className="relative">
              <Search className="absolute left-3.5 top-3.5 size-5 text-muted-foreground" />
              <Input placeholder={searchableAttrs.length ? `Search name, ${searchableAttrs.slice(0, 2).join(", ")} or scan` : "Search name, SKU or scan a barcode"} aria-label="Search products" className="h-12 pl-11 text-base" value={search} onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const hit = byCode(search.trim());
                  if (hit) { if (hit.unit) addProduct(hit.p, 1, hit.unit); else tapProduct(hit.p); setSearch(""); }
                  else if (shown.length === 1) { tapProduct(shown[0]); setSearch(""); }
                }} />
            </div>
            <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
              {[{ _id: "all", name: "All" }, ...catChips].map((c) => (
                <button key={c._id} onClick={() => setCat(c._id)} aria-pressed={cat === c._id}
                  className={cn("h-11 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors", cat === c._id ? "border-brand-600 bg-brand-600 text-white" : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground")}>{c.name}</button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-24 lg:pb-3">
            {catalog === undefined ? (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
            ) : shown.length === 0 ? (
              <EmptyState title={catalog.length === 0 ? "No products yet" : "No matching products"} desc={catalog.length === 0 ? "Add products in Inventory to start selling." : "Try another word or clear the category."}
                action={catalog.length > 0 && (search || cat !== "all") ? <Button variant="outline" size="lg" onClick={() => { setSearch(""); setCat("all"); }}>Clear filters</Button> : undefined} />
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                {shown.map((p) => <Tile key={p._id} p={p} n={inCart.get(p._id) ?? 0} wholesale={wholesale} m={m} low={st.lowStockThreshold} negOk={st.allowNegativeStock} onTap={() => tapProduct(p)} />)}
              </div>
            )}
          </div>
        </section>
        <aside className="hidden min-h-0 border-l bg-card lg:block">{cartPanel}</aside>
      </div>

      {/* mobile cart bar */}
      <div className="fixed inset-x-0 bottom-0 border-t bg-card/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <Button size="xl" className="w-full justify-between" disabled={lines.length === 0} onClick={() => setCartOpen(true)}>
          <span className="flex items-center gap-2"><ShoppingCart />{fmtQty(itemCount)} item{itemCount === 1 ? "" : "s"}</span>
          <span className="tabular-nums">{m(t.totalCents)}</span>
        </Button>
      </div>
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="h-[88dvh] gap-0 rounded-t-2xl p-0">
          <SheetHeader className="sr-only"><SheetTitle>Cart</SheetTitle></SheetHeader>
          <div className="min-h-0 flex-1">{cartPanel}</div>
        </SheetContent>
      </Sheet>

      <PaymentDialog open={dlg === "pay"} onClose={() => setDlg(null)} totalCents={t.totalCents} currency={cur} methods={methods}
        customer={customer} online={online} onPickCustomer={() => setPicker(true)} onConfirm={pay} />
      <CustomerPicker open={picker} currency={cur} onClose={() => setPicker(false)} onPick={(c) => { setCustomer(c); setPicker(false); }} />
      <HeldOrdersDialog open={dlg === "held"} onClose={() => setDlg(null)} list={held} currency={cur} taxRate={taxRate} onResume={resume} onDelete={drop} />
      <ReturnsDialog open={dlg === "returns"} onClose={() => setDlg(null)} canRefund={canRefund} methods={methods} currency={cur}
        onReprint={(id) => { setDlg(null); setReceipt({ saleId: id }); }} />
      <RecentSales open={dlg === "recent"} onClose={() => setDlg(null)} currency={cur} onOpen={(id) => { setDlg(null); setReceipt({ saleId: id }); }} />
      {receipt && <ReceiptDialog open onClose={() => setReceipt(undefined)} saleId={receipt.saleId} local={receipt.local} onNew={() => setReceipt(undefined)} />}

      <KeypadDialog open={!!keypad} title={keypad?.name ?? ""} unit={keypad?.unit ?? ""} initial={keypad?.initial} onClose={() => setKeypad(null)}
        onApply={(q) => {
          if (!keypad) return;
          if (keypad.item) addProduct(keypad.item, q);
          else if (keypad.key) {
            const l = lines.find((x) => lineKey(x) === keypad.key);
            const others = lines.filter((x) => x.productId === keypad.id && x !== l).reduce((n, x) => n + baseQty(x), 0);
            if (l && l.stock !== null && !st.allowNegativeStock && others + q * (l.unitFactor ?? 1) > l.stock + 1e-9) toast.error(`Only ${fmtQty(l.stock)} in stock.`);
            else setQty(keypad.key, q);
          }
          setKeypad(null);
        }} />
      <DiscountDialog open={discTarget !== null} title={discTarget === "order" ? "Order discount" : `Discount: ${discLine?.name ?? ""}`}
        baseCents={discBase} currency={cur} presets={st.discountPresets} value={discTarget === "order" ? orderDisc : discLine?.disc}
        onClose={() => setDiscTarget(null)}
        onApply={(d) => { if (discTarget === "order") setOrderDisc(d); else if (discTarget) setLineDisc(discTarget.line, d); setDiscTarget(null); }} />
      <UnitSheet item={unitFor} wholesale={wholesale} m={m} onClose={() => setUnitFor(null)} onPick={(u) => unitFor && pickPack(unitFor, u)} />
      <SerialPicker item={serialFor} selected={serialFor ? (lines.find((l) => l.productId === serialFor._id)?.serials ?? []) : []} onClose={() => setSerialFor(null)} onApply={(s) => serialFor && applySerials(serialFor, s)} />
      <ScanDialog open={camera} onOpenChange={setCamera} continuous title="Scan items" onScan={(r) => void onScan(r.code)} />
      <WarrantyDialog open={dlg === "warranty"} onClose={() => setDlg(null)} />
    </div>
  );
}

function Tile({ p, n, wholesale, m, low, negOk, onTap }: {
  p: CatalogItem; n: number; wholesale: boolean; m: (c: number) => string; low: number; negOk: boolean; onTap: () => void;
}) {
  const counted = p.type === "STOCKABLE";
  const out = counted && p.stock <= 0;
  const soon = p.sellableUntil !== undefined && p.sellableUntil - Date.now() <= 30 * DAY_MS;
  const blocked = p.allExpired || (out && !negOk);
  const price = wholesale && p.wholesalePriceCents !== undefined ? p.wholesalePriceCents : p.priceCents;
  return (
    <button onClick={onTap} aria-label={`Add ${p.name}`}
      className={cn("relative flex min-h-28 flex-col justify-between rounded-xl border bg-card p-3 text-left shadow-card transition-[transform,box-shadow,border-color] duration-100 active:scale-[0.97]",
        blocked ? "border-danger/30 opacity-60" : n > 0 ? "border-brand-600 ring-1 ring-brand-600" : "hover:border-brand-300 hover:shadow-pop")}>
      {n > 0 && <span className="absolute -right-1.5 -top-1.5 grid min-w-6 place-items-center rounded-full bg-brand-600 px-1.5 text-xs font-bold text-white tabular-nums ring-2 ring-background">{fmtQty(n)}</span>}
      <span className="line-clamp-2 text-[15px] font-medium leading-snug">{p.name}</span>
      <span className="mt-2 block">
      <span className="flex items-end justify-between gap-2">
        <span className="font-display text-lg font-semibold tabular-nums text-brand-700">{m(price)}{p.allowDecimal && <span className="text-xs font-medium text-muted-foreground">/{p.unit}</span>}</span>
        {counted && <span className={cn("text-xs tabular-nums", out ? "font-semibold text-danger" : p.stock <= low ? "font-semibold text-warning" : "text-muted-foreground")}>{out ? "Out" : `${fmtQty(p.stock)} ${p.unit}`}</span>}
      </span>
      {(p.allExpired || soon) && <span className={cn("mt-1 block text-xs font-semibold", p.allExpired ? "text-danger" : "text-warning")}>{p.allExpired ? "Expired" : "Expires soon"}</span>}
      </span>
    </button>
  );
}

function CartRow({ l, row, m, canDiscount, wholesale, onQty, onRemove, onKeypad, onSerials, onDiscount }: {
  l: CartLine; row: { price: number; gross: number; discount: number; net: number }; m: (c: number) => string; canDiscount: boolean; wholesale: boolean;
  onQty: (q: number) => void; onRemove: () => void; onKeypad: () => void; onSerials: () => void; onDiscount: () => void;
}) {
  const ws = wholesale && l.wholesaleCents !== undefined;
  return (
    <div className="space-y-1.5 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{l.name}{l.unitName && <span className="ml-1.5 rounded-md bg-brand-50 px-1.5 py-0.5 text-xs font-semibold text-brand-800">{l.unitName}</span>}</p>
          <p className="text-xs tabular-nums text-muted-foreground">{m(unitPrice(l, wholesale))} / {l.unit}{ws && <span className="ml-1 font-semibold text-info">wholesale</span>}</p>
          {l.serials && <p className="break-all font-mono text-xs tabular-nums text-muted-foreground">{l.serials.join(", ")}</p>}
        </div>
        <div className="shrink-0 text-right text-sm font-semibold tabular-nums">
          {row.discount > 0 && <p className="text-xs font-normal text-muted-foreground line-through">{m(row.gross)}</p>}
          {m(row.net)}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {l.serials ? (
          <Button type="button" variant="outline" size="lg" onClick={onSerials} aria-label={`Change IMEI numbers of ${l.name}`}>{l.serials.length} IMEI · change</Button>
        ) : <div className="flex items-center rounded-lg border bg-card">
          <button type="button" className="grid size-11 place-items-center rounded-l-lg text-muted-foreground active:bg-muted" onClick={() => onQty(l.qty - 1)} aria-label={`Less ${l.name}`}><Minus className="size-4" /></button>
          {l.allowDecimal ? (
            <button type="button" onClick={onKeypad} aria-label={`Set quantity of ${l.name}`} className="h-11 min-w-16 px-2 text-center text-sm font-semibold tabular-nums hover:bg-muted">{fmtQty(l.qty)} {l.unit}</button>
          ) : (
            <span className="w-9 text-center text-sm font-semibold tabular-nums">{fmtQty(l.qty)}</span>
          )}
          <button type="button" className="grid size-11 place-items-center rounded-r-lg text-brand-700 active:bg-muted" onClick={() => onQty(l.qty + 1)} aria-label={`More ${l.name}`}><Plus className="size-4" /></button>
        </div>}
        {canDiscount && (
          <Button type="button" variant={l.disc ? "secondary" : "ghost"} size="lg" className="text-muted-foreground" onClick={onDiscount} aria-label={`Discount ${l.name}`}>
            <Tag />{row.discount > 0 ? `-${m(row.discount)}` : <span className="hidden sm:inline">Discount</span>}
          </Button>
        )}
        <div className="flex-1" />
        <button type="button" className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-danger active:bg-muted" onClick={onRemove} aria-label={`Remove ${l.name}`}><Trash2 className="size-4" /></button>
      </div>
    </div>
  );
}

function RecentSales({ open, onClose, currency, onOpen }: { open: boolean; onClose: () => void; currency: string; onOpen: (id: Id<"sales">) => void }) {
  const sales = useQuery(api.sales.recentForCashier, open ? {} : "skip");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>My recent sales</DialogTitle></DialogHeader>
        <div className="max-h-[60dvh] divide-y overflow-y-auto">
          {sales === undefined ? <Skeleton className="h-32" /> : sales.length === 0 ? <EmptyState icon={Banknote} title="No sales yet" /> : sales.map((s) => (
            <button key={s._id} onClick={() => onOpen(s._id)} className="flex min-h-14 w-full items-center justify-between gap-3 px-1 py-2.5 text-left text-sm hover:bg-muted">
              <span>#{s.receiptNo}<span className="block text-xs text-muted-foreground">{fmtDateTime(s.createdAt)} · {[...new Set(s.payments.map((p) => METHOD_LABEL[p.method] ?? p.method))].join(" + ")}</span></span>
              <span className="font-medium tabular-nums">{formatCents(s.totalCents, currency)}{s.status !== "COMPLETED" && <span className="ml-2 text-xs text-danger">{s.status === "REFUNDED" ? "refunded" : "part refund"}</span>}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
