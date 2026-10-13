"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useSearchParams } from "next/navigation";
import { Download, Receipt, Timer } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DataTable, EmptyState, PageHeader, Panel, Pill, Stat, Toolbar, Money } from "@/components/common";
import { useBiz } from "@/components/guard";
import { ZReportDialog } from "@/components/pos/z-report";
import { METHOD_LABEL } from "@/components/receipt";
import { RangeBar, useRange, type Range } from "@/components/sales/range-bar";
import { SaleDetail, STATUS_PILL } from "@/components/sales/sale-detail";
import { Button } from "@/components/ui/button";
import { canOpenApp } from "@/convex/shared/modules";
import { errorMessage } from "@/convex/shared/errors";
import { formatCents } from "@/convex/shared/money";
import { hasPermission } from "@/convex/shared/permissions";
import { downloadCsv } from "@/lib/csv";
import { fmtDateTime } from "@/lib/session";
import { cn } from "@/lib/utils";

type Sale = FunctionReturnType<typeof api.sales.list>["sales"][number];
type Shift = FunctionReturnType<typeof api.shifts.list>[number];
type Status = "" | "COMPLETED" | "PARTIALLY_REFUNDED" | "REFUNDED";
type Method = "" | "CASH" | "EVC" | "ZAAD" | "EDAHAB" | "BANK" | "CREDIT";

const selectCls = "h-10 rounded-lg border border-input bg-card px-3 text-base shadow-card md:text-sm";

export default function SalesPage() {
  const view = useSearchParams().get("view") === "shifts" ? "shifts" : "sales";
  return (
    <>
      <PageHeader title={view === "shifts" ? "Shifts" : "Sales"} desc={view === "shifts" ? "Cash drawer sessions and Z-reports." : "Every sale, with refunds and receipts."} />
      <nav aria-label="Sales sections" className="mb-4 flex gap-1">
        {([["sales", "Sales", Receipt], ["shifts", "Shifts", Timer]] as const).map(([v, label, Icon]) => (
          <Link key={v} href={`/apps/sales?view=${v}`} aria-current={view === v ? "page" : undefined}
            className={cn("inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium", view === v ? "bg-brand-50 text-brand-800" : "text-muted-foreground hover:bg-muted")}>
            <Icon className="size-4" />{label}
          </Link>
        ))}
      </nav>
      {view === "shifts" ? <ShiftsView /> : <SalesView />}
    </>
  );
}

/* ------------------------------------------------------------------ sales */

function SalesView() {
  const me = useBiz();
  const cur = me.business.currency;
  const m = (c: number) => formatCents(c, cur);
  const convex = useConvex();
  const seeCost = hasPermission(me.member, "seeCost");
  const role = me.member.role as "OWNER" | "MANAGER" | "CASHIER";
  const range = useRange("today");
  const [method, setMethod] = useState<Method>("");
  const [status, setStatus] = useState<Status>("");
  const [cashier, setCashier] = useState("");
  const [customer, setCustomer] = useState("");
  const [open, setOpen] = useState<Id<"sales"> | null>(null);
  const [exporting, setExporting] = useState(false);

  const data = useQuery(api.sales.list, {
    from: range.fromMs, to: range.toMs,
    method: method || undefined, status: status || undefined,
    cashierId: (cashier || undefined) as Id<"members"> | undefined,
    customerId: (customer || undefined) as Id<"customers"> | undefined,
  });
  const staff = useQuery(api.staff.list, canOpenApp(role, me.plan.modules, "staff") ? {} : "skip");
  const customers = useQuery(api.customers.list, canOpenApp(role, me.plan.modules, "customers") ? {} : "skip");

  const profit = useMemo(() => !seeCost || !data ? null : data.sales.reduce((n, s) =>
    n + s.items.reduce((k, i) => k + Math.round(i.priceCents * i.qty) - i.discountCents - Math.round(("costCents" in i ? i.costCents : 0) * i.qty), 0) - s.discountCents, 0), [data, seeCost]);

  async function exportCsv() {
    setExporting(true);
    try {
      const rows = await convex.query(api.sales.exportCsv, { from: range.fromMs, to: range.toMs });
      downloadCsv(`sales-${range.from}_${range.to}.csv`, [
        ["Receipt", "Date", "Cashier", "Customer", "Items", "Subtotal", "Discount", "Tax", "Total", "Refunded", "Payment", "Status"],
        ...rows.map((r) => [r.receiptNo, r.date, r.cashier, r.customer, r.items, r.subtotalCents / 100, r.discountCents / 100, r.taxCents / 100, r.totalCents / 100, r.refundedCents / 100, r.methods, r.status]),
      ]);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  const filtered = !!(method || status || cashier || customer);
  const t = data?.totals;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sales" value={t ? t.count : "-"} sub={t && data && data.sales.length >= 500 ? "First 500 shown" : "in this period"} />
        <Stat label="Total" value={t ? m(t.totalCents) : "-"} sub={t && t.discountCents > 0 ? `${m(t.discountCents)} given as discounts` : undefined} />
        <Stat label="Refunded" value={t ? m(t.refundedCents) : "-"} tone={t && t.refundedCents > 0 ? "text-danger" : undefined} />
        {profit !== null ? <Stat label="Profit (est.)" value={m(profit)} sub="before tax and refunds" tone={profit < 0 ? "text-danger" : "text-success"} /> :
          <Stat label="Cash taken" value={t ? m(t.byMethod.CASH) : "-"} sub="net of change" />}
      </div>
      {t && (Object.entries(t.byMethod) as [keyof typeof t.byMethod, number][]).some(([, c]) => c !== 0) && (
        <div className="flex flex-wrap gap-2" aria-label="Takings by method">
          {(Object.entries(t.byMethod) as [string, number][]).filter(([, c]) => c !== 0).map(([k, c]) => (
            <span key={k} className="rounded-full border bg-card px-3 py-1 text-sm shadow-card"><span className="text-muted-foreground">{METHOD_LABEL[k]}</span> <span className="font-semibold tabular-nums">{m(c)}</span></span>
          ))}
        </div>
      )}

      <Panel>
        <Toolbar actions={<Button variant="outline" onClick={exportCsv} disabled={exporting}><Download /> Export CSV</Button>}>
          <RangeBar r={range} />
        </Toolbar>
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 p-3">
          <select aria-label="Payment method" className={selectCls} value={method} onChange={(e) => setMethod(e.target.value as Method)}>
            <option value="">All payments</option>
            {(["CASH", "EVC", "ZAAD", "EDAHAB", "BANK", "CREDIT"] as const).map((k) => <option key={k} value={k}>{METHOD_LABEL[k]}</option>)}
          </select>
          <select aria-label="Status" className={selectCls} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            <option value="">All statuses</option>
            <option value="COMPLETED">Paid</option><option value="PARTIALLY_REFUNDED">Part refunded</option><option value="REFUNDED">Refunded</option>
          </select>
          {staff && <select aria-label="Cashier" className={selectCls} value={cashier} onChange={(e) => setCashier(e.target.value)}>
            <option value="">All cashiers</option>{staff.map((s) => <option key={s._id} value={s._id}>{s.fullName}</option>)}
          </select>}
          {customers && <select aria-label="Customer" className={cn(selectCls, "max-w-48")} value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">All customers</option>{customers.map((c) => <option key={c._id} value={c._id}>{c.fullName}</option>)}
          </select>}
          {filtered && <Button variant="ghost" onClick={() => { setMethod(""); setStatus(""); setCashier(""); setCustomer(""); }}>Clear filters</Button>}
        </div>
        <DataTable<Sale>
          rows={data?.sales}
          onRowClick={(s) => setOpen(s._id)}
          empty={<EmptyState icon={Receipt} title={filtered ? "No sales match these filters" : "No sales in this period"} desc={filtered ? "Try removing a filter." : "Pick another date range, or sell something in the POS."}
            action={filtered ? <Button variant="outline" onClick={() => { setMethod(""); setStatus(""); setCashier(""); setCustomer(""); }}>Clear filters</Button> : undefined} />}
          cols={[
            { header: "Receipt", cell: (s) => <span className="font-medium tabular-nums">#{s.receiptNo}</span> },
            { header: "When", cell: (s) => <span className="text-muted-foreground">{fmtDateTime(s.createdAt)}</span> },
            { header: "Customer", cell: (s) => s.customerName ?? <span className="text-muted-foreground">Walk-in</span> },
            { header: "Cashier", hideOnCard: true, cell: (s) => <span className="text-muted-foreground">{s.cashierName}</span> },
            { header: "Payment", cell: (s) => <div className="flex flex-wrap justify-end gap-1 md:justify-start">{[...new Set(s.payments.map((p) => p.method))].map((k) => <Pill key={k} tone={k === "CREDIT" ? "amber" : k === "CASH" ? "green" : "blue"}>{METHOD_LABEL[k]}</Pill>)}</div> },
            { header: "Total", className: "text-right", cell: (s) => <Money className="font-semibold">{m(s.totalCents)}</Money> },
            { header: "Status", cell: (s) => <Pill tone={STATUS_PILL[s.status].tone} dot>{STATUS_PILL[s.status].label}</Pill> },
          ]}
        />
      </Panel>
      <SaleDetail saleId={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ shifts */

function ShiftsView() {
  const me = useBiz();
  const m = (c: number) => formatCents(c, me.business.currency);
  const range: Range = useRange("week");
  const shifts = useQuery(api.shifts.list, { from: range.fromMs, to: range.toMs });
  const [open, setOpen] = useState<Id<"shifts"> | null>(null);
  return (
    <>
      <Panel>
        <Toolbar><RangeBar r={range} /></Toolbar>
        <DataTable<Shift>
          rows={shifts}
          onRowClick={(s) => setOpen(s._id)}
          empty={<EmptyState icon={Timer} title="No shifts in this period" desc="Shifts appear when cashiers open the cash drawer in the POS." />}
          cols={[
            { header: "Cashier", cell: (s) => <span className="font-medium">{s.memberName}</span> },
            { header: "Opened", cell: (s) => <span className="text-muted-foreground">{fmtDateTime(s.openedAt)}</span> },
            { header: "Status", cell: (s) => s.status === "OPEN" ? <Pill tone="green" dot>Open</Pill> : <Pill tone="slate">Closed {s.closedAt ? fmtDateTime(s.closedAt) : ""}</Pill> },
            { header: "Float", className: "text-right", hideOnCard: true, cell: (s) => <Money>{m(s.openingFloatCents)}</Money> },
            { header: "Expected", className: "text-right", cell: (s) => s.expectedCashCents === undefined ? <span className="text-muted-foreground">-</span> : <Money>{m(s.expectedCashCents)}</Money> },
            { header: "Counted", className: "text-right", cell: (s) => s.countedCashCents === undefined ? <span className="text-muted-foreground">-</span> : <Money>{m(s.countedCashCents)}</Money> },
            {
              header: "Difference", className: "text-right",
              cell: (s) => s.differenceCents === null ? <span className="text-muted-foreground">-</span> : s.differenceCents === 0
                ? <Money tone="in" className="font-medium">Balanced</Money>
                : <Money tone={s.differenceCents < 0 ? "out" : "in"} className="font-semibold">{s.differenceCents < 0 ? "Short " : "Over "}{m(Math.abs(s.differenceCents))}</Money>,
            },
          ]}
        />
      </Panel>
      <ZReportDialog shiftId={open} onClose={() => setOpen(null)} />
    </>
  );
}
