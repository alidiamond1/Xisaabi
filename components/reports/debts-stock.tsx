"use client";
import { useQuery } from "convex/react";
import { Banknote, Lock, MessageCircle, Users } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Col, DataTable, EmptyState, Money, Panel, Stat } from "@/components/common";
import { useBiz } from "@/components/guard";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/convex/shared/money";
import { hasPermission } from "@/convex/shared/permissions";
import { cents2, ExportBar, LOCKED_NOTE } from "./bits";

const wa = (phone?: string) => { const d = (phone ?? "").replace(/\D/g, ""); return d ? `https://wa.me/${d}` : null; };
function WhatsApp({ phone }: { phone?: string }) {
  const href = wa(phone);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" aria-label="Message on WhatsApp" className="inline-grid size-9 place-items-center rounded-lg text-success hover:bg-success-soft"><MessageCircle className="size-4" /></a>
  ) : null;
}

export function DebtsView() {
  const me = useBiz();
  const cur = me.business.currency;
  const d = useQuery(api.reports.debtors);
  const hasPurchases = me.plan.modules.includes("purchases");
  const c = useQuery(api.reports.creditors, hasPurchases ? {} : "skip");

  const debtorRows = d?.customers.map((x) => ({ ...x, _id: x._id as string }));
  const creditorRows = c?.suppliers.map((x) => ({ ...x, _id: x._id as string }));
  const csv = [
    ["Type", "Name", "Phone", `Balance (${cur})`, "Days since last payment"],
    ...(d?.customers ?? []).map((x) => ["Customer owes us", x.fullName, x.phone, cents2(x.balanceCents), x.daysSinceLastPayment ?? ""]),
    ...(c?.suppliers ?? []).map((x) => ["We owe supplier", x.company ? `${x.name} (${x.company})` : x.name, x.phone, cents2(x.balanceCents), ""]),
  ];

  const debtorCols: Col<NonNullable<typeof debtorRows>[number]>[] = [
    { header: "Customer", cell: (x) => <div><p className="font-medium">{x.fullName}</p><p className="text-xs text-muted-foreground">{x.phone}</p></div> },
    { header: "Last payment", cell: (x) => (x.daysSinceLastPayment === null ? <span className="text-muted-foreground">Never</span> : x.daysSinceLastPayment === 0 ? "Today" : `${x.daysSinceLastPayment} days ago`) },
    { header: "Owes", className: "text-right", cell: (x) => <Money tone="out" className="font-medium">{formatCents(x.balanceCents, cur)}</Money> },
    { header: "", className: "w-12", cell: (x) => <WhatsApp phone={x.whatsapp ?? x.phone} /> },
  ];
  const creditorCols: Col<NonNullable<typeof creditorRows>[number]>[] = [
    { header: "Supplier", cell: (x) => <div><p className="font-medium">{x.name}</p><p className="text-xs text-muted-foreground">{x.company}</p></div> },
    { header: "Phone", cell: (x) => x.phone || <span className="text-muted-foreground">-</span> },
    { header: "We owe", className: "text-right", cell: (x) => <Money tone="out" className="font-medium">{formatCents(x.balanceCents, cur)}</Money> },
    { header: "", className: "w-12", cell: (x) => <WhatsApp phone={x.whatsapp ?? x.phone} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2"><ExportBar filename="debts" title="Debts" sub={`${me.business.name} · ${new Date().toLocaleDateString()}`} rows={csv} disabled={!d} /></div>
      <div className={hasPurchases ? "grid grid-cols-2 gap-3" : "grid grid-cols-2 gap-3 sm:max-w-md"}>
        <Stat icon={Users} label="Customers owe you" value={d ? formatCents(d.totalCents, cur) : "-"} sub={d ? `${d.customers.length} customer${d.customers.length === 1 ? "" : "s"}` : undefined} />
        {hasPurchases && <Stat label="You owe suppliers" value={c ? formatCents(c.totalCents, cur) : "-"} sub={c ? `${c.suppliers.length} supplier${c.suppliers.length === 1 ? "" : "s"}` : undefined} />}
      </div>
      <Panel>
        <div className="border-b px-4 py-3"><h2 className="font-display text-base font-semibold">Customers who owe you</h2></div>
        <DataTable rows={debtorRows} cols={debtorCols} empty={<EmptyState icon={Users} title="Nobody owes you" desc="Customers with an unpaid balance will show here." />} />
      </Panel>
      {hasPurchases && (
        <Panel>
          <div className="border-b px-4 py-3"><h2 className="font-display text-base font-semibold">Suppliers you owe</h2></div>
          <DataTable rows={creditorRows} cols={creditorCols} empty={<EmptyState icon={Banknote} title="You owe no supplier" desc="Unpaid purchases will show here." />} />
        </Panel>
      )}
    </div>
  );
}

export function StockValueView() {
  const me = useBiz();
  const cur = me.business.currency;
  const allowed = hasPermission(me.member, "seeCost");
  const v = useQuery(api.inventory.valuation, allowed ? {} : "skip");
  if (!allowed) return <Panel><EmptyState icon={Lock} title="Cost prices are hidden for you" desc={LOCKED_NOTE} /></Panel>;

  const rows = v?.byCategory.map((g) => ({ ...g, _id: g.name }));
  const csv = [
    ["Category", "Products", `Cost value (${cur})`, `Retail value (${cur})`, `Potential profit (${cur})`],
    ...(v?.byCategory ?? []).map((g) => [g.name, g.items, cents2(g.costCents), cents2(g.retailCents), cents2(g.retailCents - g.costCents)]),
    ...(v ? [["Total", "", cents2(v.totalCostCents), cents2(v.totalRetailCents), cents2(v.totalRetailCents - v.totalCostCents)]] : []),
  ];
  const cols: Col<NonNullable<typeof rows>[number]>[] = [
    { header: "Category", cell: (g) => <span className="font-medium">{g.name}</span> },
    { header: "Products", className: "text-right", cell: (g) => <span className="tnum">{g.items}</span> },
    { header: "At cost", className: "text-right", cell: (g) => <Money>{formatCents(g.costCents, cur)}</Money> },
    { header: "At retail", className: "text-right", cell: (g) => <Money>{formatCents(g.retailCents, cur)}</Money> },
    { header: "Potential profit", className: "text-right", cell: (g) => <Money cents={g.retailCents - g.costCents} tone="auto">{formatCents(g.retailCents - g.costCents, cur)}</Money> },
  ];
  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2"><ExportBar filename="stock-value" title="Stock value" sub={`${me.business.name} · ${new Date().toLocaleDateString()}`} rows={csv} disabled={!v} /></div>
      {v === undefined ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)}</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat icon={Banknote} label="Stock at cost" value={formatCents(v.totalCostCents, cur)} sub="what you paid" />
          <Stat label="Stock at retail" value={formatCents(v.totalRetailCents, cur)} sub="if all sold at full price" />
          <Stat label="Potential profit" value={formatCents(v.totalRetailCents - v.totalCostCents, cur)} tone="text-success" sub="retail minus cost" />
        </div>
      )}
      <Panel><DataTable rows={rows} cols={cols} empty={<EmptyState icon={Banknote} title="No stock to value" desc="Receive or add stock and its value will appear here." />} /></Panel>
    </div>
  );
}
