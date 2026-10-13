"use client";
import { use, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Ban, FileText, HandCoins, Lock, Minus, MessageCircle, Pencil, Plus, Receipt, ShieldCheck, Trash2, Users } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Banner, DataTable, EmptyState, KeyValue, PageHeader, Panel, Pill, Money } from "@/components/common";
import { CustomerSheet } from "@/components/customers/customer-form";
import { AdjustDialog, PaymentReceiptDialog, TakePaymentDialog, WriteOffDialog, type PaymentDone } from "@/components/customers/money-dialogs";
import { LEDGER_LABEL, StatementDialog } from "@/components/customers/statement-dialog";
import { useBiz } from "@/components/guard";
import { METHOD_LABEL, ReceiptDialog } from "@/components/receipt";
import { STATUS_PILL } from "@/components/sales/sale-detail";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { canOpenApp } from "@/convex/shared/modules";
import { formatCents } from "@/convex/shared/money";
import { act } from "@/lib/run";
import { fmtDate, fmtDateTime } from "@/lib/session";
import { openWhatsApp, reminderText } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

type Detail = NonNullable<FunctionReturnType<typeof api.customers.get>>;
type Ledger = Detail["ledger"][number];
type SaleRow = Detail["sales"][number];
const GROUP_LABEL = { RETAIL: "Retail", WHOLESALE: "Wholesale", VIP: "VIP" } as const;
/** +1 = customer owes more, -1 = owes less. Opening balance follows the sign of the resulting balance. */
const sign = (l: Ledger) => (l.type === "DEBT" || l.type === "ADJUST_UP" ? 1 : l.type === "OPENING" ? (l.balanceAfterCents >= 0 ? 1 : -1) : -1);

export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useBiz();
  const cur = me.business.currency;
  const m = (c: number) => formatCents(c, cur);
  const role = me.member.role as "OWNER" | "MANAGER" | "CASHIER";
  const manager = role !== "CASHIER";
  const data = useQuery(api.customers.get, { customerId: id as Id<"customers"> });
  const staff = useQuery(api.staff.list, canOpenApp(role, me.plan.modules, "staff") ? {} : "skip");
  const setBlocked = useMutation(api.customers.setCreditBlocked);
  const [tab, setTab] = useState<"ledger" | "sales" | "info">("ledger");
  const [dlg, setDlg] = useState<"pay" | "write" | "edit" | null>(null);
  const [adjust, setAdjust] = useState<"UP" | "DOWN" | null>(null);
  const [statement, setStatement] = useState(false);
  const [paid, setPaid] = useState<PaymentDone | null>(null);
  const [receipt, setReceipt] = useState<Id<"sales"> | null>(null);

  if (data === undefined) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
  if (data === null) return <Panel><EmptyState icon={Users} title="Customer not found" desc="It may have been removed." /></Panel>;
  const { customer: c, ledger, sales } = data;
  const owed = c.balanceCents;
  const names = new Map((staff ?? []).map((s) => [s._id as string, s.fullName]));
  const who = (mid: Id<"members">) => (mid === me.member._id ? "You" : names.get(mid) ?? "");
  const receiptOf = new Map(sales.map((s) => [s._id as string, s.receiptNo]));
  const available = c.creditLimitCents > 0 ? Math.max(c.creditLimitCents - owed, 0) : 0;
  const overLimit = owed > c.creditLimitCents && owed > 0;
  const tabs = [["ledger", "Ledger"], ["sales", "Sales"], ["info", "Info"]] as const;

  return (
    <>
      <PageHeader
        title={c.fullName}
        back={{ href: "/apps/customers", label: "Customers" }}
        desc={[c.companyName, c.phone, c.district].filter(Boolean).join(" · ") || undefined}
        meta={<><Pill tone={c.group === "WHOLESALE" ? "blue" : c.group === "VIP" ? "brand" : "slate"}>{GROUP_LABEL[c.group]}</Pill>{c.creditBlocked && <Pill tone="red" dot>Credit blocked</Pill>}</>}
        actions={<Button variant="outline" size="lg" onClick={() => setDlg("edit")}><Pencil /> Edit</Button>}
      />

      <div className="space-y-4">
        <section className="rounded-2xl border bg-card p-4 shadow-card sm:p-5" aria-label="Balance">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{owed > 0 ? "Owes you" : owed < 0 ? "Store credit" : "Balance"}</p>
              <p className={cn("font-display text-4xl font-semibold tabular-nums tracking-tight sm:text-5xl", owed > 0 ? "text-danger" : owed < 0 ? "text-success" : "text-muted-foreground")}>{m(Math.abs(owed))}</p>
              <p className="mt-1 text-sm text-muted-foreground tabular-nums">
                {c.creditLimitCents > 0 ? `Limit ${m(c.creditLimitCents)} · ${overLimit ? "over the limit" : `${m(available)} available`}` : "No credit allowed"}
                {c.lastPaymentAt ? ` · last paid ${fmtDate(c.lastPaymentAt)}` : owed > 0 ? " · never paid" : ""}
              </p>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
              <Button size="lg" className="col-span-2 sm:col-auto" disabled={owed <= 0} onClick={() => setDlg("pay")}><HandCoins /> Take payment</Button>
              {manager && <Button size="lg" variant="outline" onClick={() => setAdjust("UP")}><Plus /> Add debt</Button>}
              {manager && <Button size="lg" variant="outline" disabled={owed <= 0} onClick={() => setAdjust("DOWN")}><Minus /> Reduce debt</Button>}
              <Button size="lg" variant="outline" onClick={() => setStatement(true)}><FileText /> Statement</Button>
              <Button size="lg" variant="outline" disabled={owed <= 0}
                onClick={() => openWhatsApp(c.whatsapp || c.phone, reminderText({ customer: c.fullName, shop: me.business.name, amount: m(owed) }))}><MessageCircle /> WhatsApp reminder</Button>
            </div>
          </div>
          {(overLimit || c.creditBlocked) && (
            <div className="mt-4 space-y-2">
              {overLimit && <Banner tone="warning">This customer is over their credit limit. New credit sales will be refused.</Banner>}
              {c.creditBlocked && <Banner tone="danger" icon={Lock}>Credit is blocked. They can still pay cash or mobile.</Banner>}
            </div>
          )}
          {manager && (
            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
              <Button variant="ghost" size="lg" onClick={() => act(setBlocked({ customerId: c._id, blocked: !c.creditBlocked }), c.creditBlocked ? "Credit unblocked" : "Credit blocked")}>
                {c.creditBlocked ? <><ShieldCheck /> Unblock credit</> : <><Ban /> Block credit</>}
              </Button>
              {role === "OWNER" && owed > 0 && <Button variant="ghost" size="lg" className="text-danger" onClick={() => setDlg("write")}><Trash2 /> Write off debt</Button>}
            </div>
          )}
        </section>

        <div role="tablist" aria-label="Customer sections" className="flex gap-1">
          {tabs.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={cn("h-10 rounded-lg px-4 text-sm font-medium", tab === k ? "bg-brand-50 text-brand-800" : "text-muted-foreground hover:bg-muted")}>
              {label}{k === "sales" && sales.length > 0 && <span className="ml-1.5 text-xs text-muted-foreground">{sales.length}</span>}
            </button>
          ))}
        </div>

        {tab === "ledger" && (
          <Panel>
            <DataTable<Ledger>
              rows={ledger}
              pageSize={20}
              empty={<EmptyState icon={FileText} title="No activity yet" desc="Credit sales, payments and adjustments will show here." />}
              cols={[
                { header: "When", cell: (l) => <span className="text-muted-foreground">{fmtDateTime(l.createdAt)}</span> },
                { header: "Type", cell: (l) => <Pill tone={sign(l) > 0 ? "red" : l.type === "WRITE_OFF" ? "slate" : "green"}>{LEDGER_LABEL[l.type]}</Pill> },
                {
                  header: "Details", cell: (l) => {
                    const bits = [l.saleId ? (receiptOf.get(l.saleId) ? `Receipt #${receiptOf.get(l.saleId)}` : "Sale") : "", l.method ? METHOD_LABEL[l.method] : "", l.reference ?? "", l.note ?? "", who(l.createdBy) ? `by ${who(l.createdBy)}` : ""].filter(Boolean);
                    return l.saleId ? <button type="button" className="text-left text-brand-700 hover:underline" onClick={(e) => { e.stopPropagation(); setReceipt(l.saleId!); }}>{bits.join(" · ")}</button> : <span className="text-muted-foreground">{bits.join(" · ") || "-"}</span>;
                  },
                },
                { header: "Change", className: "text-right", cell: (l) => <Money tone={sign(l) > 0 ? "out" : "in"} className="font-semibold">{sign(l) > 0 ? "+" : "-"}{m(l.amountCents)}</Money> },
                { header: "Balance after", className: "text-right", cell: (l) => <Money className={l.balanceAfterCents > 0 ? "" : "text-muted-foreground"}>{l.balanceAfterCents < 0 ? `credit ${m(-l.balanceAfterCents)}` : m(l.balanceAfterCents)}</Money> },
              ]}
            />
          </Panel>
        )}

        {tab === "sales" && (
          <Panel>
            <DataTable<SaleRow>
              rows={sales}
              onRowClick={(s) => setReceipt(s._id)}
              empty={<EmptyState icon={Receipt} title="No sales yet" desc="Sales made to this customer in the POS will appear here." />}
              cols={[
                { header: "Receipt", cell: (s) => <span className="font-medium tabular-nums">#{s.receiptNo}</span> },
                { header: "When", cell: (s) => <span className="text-muted-foreground">{fmtDateTime(s.createdAt)}</span> },
                { header: "Paid with", cell: (s) => [...new Set(s.payments.map((p) => METHOD_LABEL[p.method]))].join(" + ") },
                { header: "Total", className: "text-right", cell: (s) => <Money className="font-semibold">{m(s.totalCents)}</Money> },
                { header: "Status", cell: (s) => <Pill tone={STATUS_PILL[s.status].tone} dot>{STATUS_PILL[s.status].label}</Pill> },
              ]}
            />
          </Panel>
        )}

        {tab === "info" && (
          <Panel>
            <KeyValue items={[
              { label: "Type", value: c.type === "COMPANY" ? "Company" : "Person" },
              ...(c.companyName ? [{ label: "Company", value: c.companyName }] : []),
              { label: "Phone", value: c.phone || "-" },
              { label: "WhatsApp", value: c.whatsapp || c.phone || "-" },
              { label: "District", value: c.district || "-" },
              { label: "Address", value: c.address || "-" },
              { label: "Price group", value: GROUP_LABEL[c.group] },
              { label: "Credit limit", value: c.creditLimitCents ? m(c.creditLimitCents) : "No credit" },
              { label: "Customer since", value: fmtDate(c.createdAt) },
              { label: "Notes", value: c.notes || "-" },
            ]} />
          </Panel>
        )}
      </div>

      <TakePaymentDialog open={dlg === "pay"} onClose={() => setDlg(null)} customer={c} onDone={setPaid} />
      <PaymentReceiptDialog p={paid} onClose={() => setPaid(null)} />
      <AdjustDialog direction={adjust} onClose={() => setAdjust(null)} customer={c} />
      <WriteOffDialog open={dlg === "write"} onClose={() => setDlg(null)} customer={c} />
      <StatementDialog customerId={statement ? c._id : null} onClose={() => setStatement(false)} />
      <CustomerSheet value={dlg === "edit" ? c : null} onClose={() => setDlg(null)} />
      {receipt && <ReceiptDialog open saleId={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}
