"use client";
import Link from "next/link";
import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Banknote, Download } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DataTable, EmptyState, PageHeader, Panel, Pill, Stat } from "@/components/common";
import { usePlatform } from "@/components/guard";
import { SEL, VoidDialog, downloadCsv } from "@/components/platform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/convex/shared/money";
import { act } from "@/lib/run";
import { dayEnd, dayStart, fmtDate, isoDay } from "@/lib/session";
import { cn } from "@/lib/utils";

const METHODS = ["EVC", "ZAAD", "EDAHAB", "BANK", "CASH"];

export default function PlatformBillingPage() {
  const sup = usePlatform().member.role === "SUPER_ADMIN";
  const [from, setFrom] = useState(() => { const d = new Date(); return isoDay(new Date(d.getFullYear(), d.getMonth(), 1).getTime()); });
  const [to, setTo] = useState("");
  const [method, setMethod] = useState("");
  const f = { from: from ? dayStart(from) : undefined, to: to ? dayEnd(to) : undefined, method: method || undefined };
  const totals = useQuery(api.platformBilling.totals, f);
  const { results, status, loadMore } = usePaginatedQuery(api.platformBilling.payments, f, { initialNumItems: 25 });
  const voidPay = useMutation(api.platformBilling.voidPayment);
  const [voiding, setVoiding] = useState<Id<"subscriptionPayments"> | null>(null);

  function exportCsv() {
    downloadCsv("payments.csv", [
      ["Date", "Business", "Plan", "Months", "Method", "Reference", "Amount (cents)", "Recorded by", "Voided"],
      ...results.map((p) => [new Date(p.createdAt).toISOString().slice(0, 10), p.businessName, p.planName, p.months, p.method, p.reference, p.amountCents, p.recordedByName, p.isVoid ? `void: ${p.voidReason ?? ""}` : ""]),
    ]);
  }

  return (
    <>
      <PageHeader title="Billing" desc="Subscription payments across all businesses."
        actions={<Button variant="outline" onClick={exportCsv} disabled={!results.length}><Download /> Export CSV</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
        <label className="space-y-1 text-xs font-medium text-muted-foreground">From<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 text-base md:h-9 md:text-sm" /></label>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">To<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 text-base md:h-9 md:text-sm" /></label>
        <select aria-label="Method" value={method} onChange={(e) => setMethod(e.target.value)} className={cn(SEL, "col-span-2 sm:col-span-1")}>
          <option value="">All methods</option>{METHODS.map((m) => <option key={m}>{m}</option>)}
        </select>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Collected" value={totals ? formatCents(totals.totalCents) : "..."} sub={totals ? `${totals.count} payments (voids excluded)` : undefined} icon={Banknote} />
        {totals?.byMethod.slice(0, 3).map((m) => <Stat key={m.method} label={m.method} value={formatCents(m.cents)} sub={`${m.count} payments`} />)}
      </div>

      <Panel>
        <DataTable
          rows={status === "LoadingFirstPage" ? undefined : results}
          pageSize={100}
          empty={<EmptyState icon={Banknote} title="No payments" desc="Nothing matches these filters." />}
          cols={[
            { header: "Date", cell: (p) => <span className={cn(p.isVoid && "line-through")}>{fmtDate(p.createdAt)}</span> },
            { header: "Business", cell: (p) => <Link href={`/platform/businesses/${p.businessId}`} className="font-medium text-brand-700 hover:underline">{p.businessName}</Link> },
            { header: "Plan", cell: (p) => `${p.planName} · ${p.months} mo` },
            { header: "Method", cell: (p) => <>{p.method}{p.reference && <span className="block text-xs text-muted-foreground">{p.reference}</span>}</> },
            { header: "Amount", className: "text-right", cell: (p) => <span className={cn("font-medium tabular-nums", p.isVoid && "text-muted-foreground line-through")}>{formatCents(p.amountCents)}</span> },
            { header: "Recorded by", cell: (p) => p.recordedByName },
            { header: "", className: "w-24 text-right", cell: (p) => p.isVoid ? <Pill tone="slate">Void</Pill> : sup ? <Button variant="ghost" size="sm" className="text-danger" onClick={() => setVoiding(p._id)}>Void</Button> : null },
          ]}
        />
        {status === "CanLoadMore" && <div className="border-t p-3 text-center"><Button variant="outline" onClick={() => loadMore(25)}>Load more</Button></div>}
      </Panel>
      <VoidDialog open={!!voiding} onClose={() => setVoiding(null)} submit={(reason) => act(voidPay({ paymentId: voiding!, reason }), "Payment voided")} />
    </>
  );
}
