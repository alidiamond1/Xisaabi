"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarClock, PartyPopper, Percent, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useView } from "@/components/app-shell";
import { ConfirmDialog, EmptyState, Field, ListSkeleton, Money, PageHeader, Panel, Stat, SubmitButton } from "@/components/common";
import { useBiz } from "@/components/guard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ExpiryBadge, MoneyInput, PrintButton, PrintSheet, fmtQty } from "@/components/inventory/bits";
import { formatCents, parseToCents } from "@/convex/shared/money";
import { hasPermission } from "@/convex/shared/permissions";
import { act } from "@/lib/run";
import { fmtDate } from "@/lib/session";
import { cn } from "@/lib/utils";

// expiry.watchlist is typed unknown[] on the server; this is its real shape.
type Entry = {
  batch: { _id: Id<"batches">; batchNo: string; qty: number; costCents?: number; expiryDate: number };
  product: { _id: Id<"products">; name: string; variantLabel?: string; unit: string; priceCents: number; costCents?: number };
  daysLeft: number;
  valueCents?: number;
};
type Watch = { expired: Entry[]; oneMonth: Entry[]; threeMonths: Entry[] };
type Group = { product: Entry["product"]; entries: Entry[]; qty: number; value: number };

const TABS = {
  expired: { key: "expired", title: "Expired", empty: "Nothing has expired", tone: "text-danger" },
  "1m": { key: "oneMonth", title: "Expiring within 30 days", empty: "Nothing expires in the next 30 days", tone: "text-warning" },
  "3m": { key: "threeMonths", title: "Expiring in 31 to 90 days", empty: "Nothing expires in 31 to 90 days", tone: "text-info" },
} as const;

const sum = (es: Entry[]) => es.reduce((s, e) => s + (e.valueCents ?? 0), 0);
const pname = (p: Entry["product"]) => (p.variantLabel ? `${p.name} (${p.variantLabel})` : p.name);

export default function ExpiryPage() {
  const me = useBiz();
  const cur = me.business.currency;
  const seeCost = hasPermission(me.member, "seeCost");
  const canWriteOff = hasPermission(me.member, "adjustStock");
  const canPrice = hasPermission(me.member, "editPrice");
  const view = useView("expiry") as keyof typeof TABS;
  const tab = TABS[view] ?? TABS.expired;
  const data = useQuery(api.expiry.watchlist) as Watch | undefined;
  const writeOff = useMutation(api.expiry.writeOff);
  const [off, setOff] = useState<Entry | null>(null);
  const [disc, setDisc] = useState<Entry["product"] | null>(null);

  const list = data?.[tab.key];
  const groups = useMemo<Group[] | undefined>(() => {
    if (!list) return undefined;
    const m = new Map<string, Group>();
    for (const e of list) {
      const g = m.get(e.product._id) ?? { product: e.product, entries: [], qty: 0, value: 0 };
      g.entries.push(e); g.qty += e.batch.qty; g.value += e.valueCents ?? 0;
      m.set(e.product._id, g);
    }
    const out = [...m.values()];
    out.forEach((g) => g.entries.sort((a, b) => a.daysLeft - b.daysLeft));
    return out.sort((a, b) => a.entries[0].daysLeft - b.entries[0].daysLeft);
  }, [list]);

  const card = (v: keyof typeof TABS, label: string, es: Entry[] | undefined, tone?: string) => (
    <Link href={`/apps/expiry?view=${v}`} aria-current={view === v ? "page" : undefined} className={cn("block rounded-xl transition-shadow hover:shadow-pop", view === v && "ring-2 ring-brand-600 ring-offset-2")}>
      {es === undefined ? <Skeleton className="h-[92px] rounded-xl" /> : (
        <Stat label={label} value={es.length} tone={es.length ? tone : undefined} sub={seeCost ? `${formatCents(sum(es), cur)} at cost` : `batch${es.length === 1 ? "" : "es"}`} />
      )}
    </Link>
  );

  return (
    <>
      <PageHeader title="Expiry" desc="Dated stock, oldest first. Act before it becomes a loss."
        actions={<PrintButton label="Print list" />} />
      <div className="mb-4 grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
        {card("expired", "Expired", data?.expired, "text-danger")}
        {card("1m", "Within 30 days", data?.oneMonth, "text-warning")}
        {card("3m", "31 to 90 days", data?.threeMonths)}
      </div>

      <Panel>
        <div className="border-b px-4 py-3"><h2 className="font-display text-base font-semibold">{tab.title}</h2></div>
        {groups === undefined ? <ListSkeleton rows={4} /> : groups.length === 0 ? (
          <EmptyState icon={view === "expired" ? PartyPopper : CalendarClock} title={tab.empty} desc="Stock with an expiry date shows here as it gets close. Turn on Track expiry for dated products." />
        ) : (
          <ul className="divide-y">
            {groups.map((g) => (
              <li key={g.product._id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/apps/inventory/${g.product._id}`} className="font-medium hover:underline">{pname(g.product)}</Link>
                    <p className="text-xs text-muted-foreground tabular-nums">{fmtQty(g.qty)} {g.product.unit} here{seeCost && ` · ${formatCents(g.value, cur)} at cost`}</p>
                  </div>
                  {canPrice && view !== "expired" && (
                    <Button variant="outline" className="h-11 md:h-8" size="sm" onClick={() => setDisc(g.product)}><Percent />Quick discount</Button>
                  )}
                </div>
                <ul className="mt-2 divide-y rounded-lg border">
                  {g.entries.map((e) => (
                    <li key={e.batch._id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 text-sm">
                      <span className="min-w-24 font-medium">Batch {e.batch.batchNo}</span>
                      <span className="tabular-nums">{fmtQty(e.batch.qty)} {g.product.unit}</span>
                      <span className="text-muted-foreground">Expires {fmtDate(e.batch.expiryDate)}</span>
                      <ExpiryBadge days={e.daysLeft} />
                      {seeCost && e.valueCents !== undefined && <Money className="text-muted-foreground">{formatCents(e.valueCents, cur)}</Money>}
                      {canWriteOff && (
                        <Button variant="destructive" size="sm" className="ml-auto h-11 md:h-8" onClick={() => setOff(e)}><Trash2 />Write off</Button>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ConfirmDialog open={!!off} onOpenChange={(o) => !o && setOff(null)} title="Write off this batch?"
        desc={off ? `${fmtQty(off.batch.qty)} ${off.product.unit} of ${pname(off.product)} (batch ${off.batch.batchNo}) will be removed from stock and recorded as a loss. This cannot be undone.` : ""}
        confirmLabel="Write off" onConfirm={async () => { if (off) await act(writeOff({ batchId: off.batch._id, note: view === "expired" ? "Expired" : "Written off before expiry" }), "Batch written off"); }} />
      <DiscountDialog product={disc} cur={cur} onClose={() => setDisc(null)} />

      <PrintSheet title={`Expiry list: ${tab.title}`} sub={new Date().toLocaleDateString()}>
        <table>
          <thead><tr><th>Product</th><th>Batch</th><th className="num">Qty</th><th>Expires</th><th className="num">Days left</th>{seeCost && <th className="num">Value</th>}</tr></thead>
          <tbody>
            {(list ?? []).map((e) => (
              <tr key={e.batch._id}><td>{pname(e.product)}</td><td>{e.batch.batchNo}</td><td className="num">{fmtQty(e.batch.qty)} {e.product.unit}</td><td>{fmtDate(e.batch.expiryDate)}</td><td className="num">{e.daysLeft}</td>{seeCost && <td className="num">{formatCents(e.valueCents ?? 0, cur)}</td>}</tr>
            ))}
          </tbody>
        </table>
      </PrintSheet>
    </>
  );
}

function DiscountDialog({ product, cur, onClose }: { product: Entry["product"] | null; cur: string; onClose: () => void }) {
  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{product && <DiscountBody key={product._id} p={product} cur={cur} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function DiscountBody({ p, cur, onClose }: { p: Entry["product"]; cur: string; onClose: () => void }) {
  const setPrice = useMutation(api.expiry.setPrice);
  const [price, setP] = useState((p.priceCents / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const c = parseToCents(price);
  const pct = c !== null && p.priceCents > 0 ? Math.round((1 - c / p.priceCents) * 100) : null;
  const err = c === null ? "Enter an amount like 1.50." : c === p.priceCents ? "That is the current price." : undefined;

  async function save() {
    if (c === null || c === p.priceCents) return;
    setBusy(true);
    const ok = await act(setPrice({ productId: p._id, priceCents: c }), "Price updated");
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Quick discount</DialogTitle>
        <DialogDescription>{pname(p)} · now {formatCents(p.priceCents, cur)}. This changes the selling price for all its stock. Set it back when the old stock is gone.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Discount presets">
          {[10, 20, 30, 50].map((d) => (
            <Button key={d} type="button" variant="outline" size="lg" onClick={() => setP((Math.round(p.priceCents * (1 - d / 100)) / 100).toFixed(2))}>{d}% off</Button>
          ))}
        </div>
        <Field label="New selling price" required error={err}>
          <MoneyInput cur={cur} value={price} onChange={setP} autoFocus aria-invalid={!!err} />
        </Field>
        {pct !== null && pct > 0 && !err && <p className="text-sm text-muted-foreground">That is <b>{pct}% off</b>.</p>}
      </div>
      <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><SubmitButton busy={busy} disabled={!!err} onClick={save}>Set price</SubmitButton></DialogFooter>
    </>
  );
}
