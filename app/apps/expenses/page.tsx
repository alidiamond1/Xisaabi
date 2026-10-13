"use client";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Download, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { ConfirmDialog, DataTable, EmptyState, Field, Money, PageHeader, Panel, Pill, Stat, SubmitButton, Toolbar, type Col } from "@/components/common";
import { useBiz } from "@/components/guard";
import { MoneyInput, NativeSelect, Segmented } from "@/components/inventory/bits";
import { METHOD_LABEL, PAID_VIA, RangeBar, cents2, useDateRange, type Method } from "@/components/reports/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatCents, parseToCents } from "@/convex/shared/money";
import { downloadCsv } from "@/lib/csv";
import { act } from "@/lib/run";
import { dayStart, fmtDate, isoDay } from "@/lib/session";

type Expense = FunctionReturnType<typeof api.expenses.list>["expenses"][number];

export default function ExpensesPage() {
  const me = useBiz();
  const cur = me.business.currency;
  const cats = me.business.settings.expenseCategories;
  const r = useDateRange("month");
  const [cat, setCat] = useState("");
  const data = useQuery(api.expenses.list, r.valid ? { from: r.fromMs, to: r.toMs, category: cat || undefined } : "skip");
  const remove = useMutation(api.expenses.remove);
  const [form, setForm] = useState<Expense | "new" | null>(null);
  const [del, setDel] = useState<Expense | null>(null);
  const top = data?.byCategory[0]?.totalCents ?? 1;

  const exportCsv = () => data && downloadCsv(`expenses-${r.from}-${r.to}.csv`, [
    ["Date", "Category", "Payee", "Paid via", `Amount (${cur})`, "Note"],
    ...data.expenses.map((e) => [isoDay(e.spentAt), e.category, e.payee, METHOD_LABEL[e.paidVia], cents2(e.amountCents), e.note]),
  ]);

  const cols: Col<Expense>[] = [
    { header: "Date", cell: (e) => fmtDate(e.spentAt) },
    { header: "Category", cell: (e) => <span className="font-medium">{e.category}</span> },
    { header: "Payee", cell: (e) => e.payee || <span className="text-muted-foreground">-</span> },
    { header: "Paid via", cell: (e) => <Pill tone="slate">{METHOD_LABEL[e.paidVia]}</Pill> },
    { header: "Note", cell: (e) => e.note || <span className="text-muted-foreground">-</span> },
    { header: "Amount", className: "text-right", cell: (e) => <Money tone="out" className="font-medium">-{formatCents(e.amountCents, cur)}</Money> },
    {
      header: "", className: "w-24",
      cell: (e) => (
        <div className="flex justify-end">
          <Button size="icon" variant="ghost" className="size-9" aria-label={`Edit ${e.category} expense`} onClick={(ev) => { ev.stopPropagation(); setForm(e); }}><Pencil /></Button>
          <Button size="icon" variant="ghost" className="size-9 text-danger" aria-label={`Delete ${e.category} expense`} onClick={(ev) => { ev.stopPropagation(); setDel(e); }}><Trash2 /></Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Expenses" desc="Everything you spend to run the shop." actions={<Button onClick={() => setForm("new")}><Plus /> Add expense</Button>} />
      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <Stat icon={Wallet} label="Total spent" value={data ? formatCents(data.totalCents, cur) : "-"} sub={r.label} />
          <Stat label="Entries" value={data?.expenses.length ?? "-"} sub={data && data.expenses.length >= 1000 ? "showing the latest 1000" : undefined} />
        </div>
        <Panel className="p-4">
          <h2 className="mb-3 font-display text-base font-semibold">By category</h2>
          {data === undefined ? <Skeleton className="h-24 w-full" /> : data.byCategory.length === 0 ? <p className="text-sm text-muted-foreground">Nothing spent in this period.</p> : (
            <ul className="space-y-2.5">
              {data.byCategory.slice(0, 6).map((c) => (
                <li key={c.category} className="text-sm">
                  <div className="mb-1 flex justify-between gap-3">
                    <span className="truncate">{c.category} <span className="text-xs text-muted-foreground">({c.count})</span></span>
                    <Money className="font-medium">{formatCents(c.totalCents, cur)}</Money>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden><div className="h-full rounded-full bg-brand-500" style={{ width: `${(c.totalCents / top) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Panel>
        <Toolbar actions={<Button variant="outline" onClick={exportCsv} disabled={!data?.expenses.length}><Download />CSV</Button>}>
          <RangeBar r={r} />
          <NativeSelect aria-label="Category" className="w-auto" value={cat} onChange={setCat} placeholder="All categories" options={cats.map((c) => ({ value: c, label: c }))} />
        </Toolbar>
        <DataTable rows={data?.expenses} cols={cols} onRowClick={setForm}
          empty={<EmptyState icon={Wallet} title={cat ? "No expenses in this category" : "No expenses in this period"} desc={cat ? "Try another category or date range." : "Record rent, transport, salaries and more."}
            action={<Button onClick={() => setForm("new")}><Plus /> Add expense</Button>} />} />
      </Panel>
      <Sheet open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <SheetContent className="w-full sm:max-w-md">
          {form && <ExpenseForm key={form === "new" ? "new" : form._id} e={form === "new" ? null : form} cats={cats} cur={cur} onClose={() => setForm(null)} />}
        </SheetContent>
      </Sheet>
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Delete this expense?"
        desc={del ? `${del.category} for ${formatCents(del.amountCents, cur)} will be removed from your records.` : ""} confirmLabel="Delete"
        onConfirm={async () => { if (del) await act(remove({ expenseId: del._id }), "Expense deleted"); }} />
    </>
  );
}

function ExpenseForm({ e, cats, cur, onClose }: { e: Expense | null; cats: string[]; cur: string; onClose: () => void }) {
  const create = useMutation(api.expenses.create);
  const update = useMutation(api.expenses.update);
  const options = useMemo(() => (e && !cats.includes(e.category) ? [e.category, ...cats] : cats), [e, cats]);
  const [category, setCategory] = useState(e?.category ?? options[0] ?? "");
  const [amount, setAmount] = useState(e ? (e.amountCents / 100).toFixed(2) : "");
  const [paidVia, setPaidVia] = useState<Method>(e?.paidVia ?? "CASH");
  const [payee, setPayee] = useState(e?.payee ?? "");
  const [note, setNote] = useState(e?.note ?? "");
  const [date, setDate] = useState(isoDay(e?.spentAt ?? Date.now()));
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const cents = parseToCents(amount);
  const amountErr = tried && !cents ? "Enter an amount greater than zero." : undefined;

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setTried(true);
    if (!cents || !category) return;
    // keep the original time when the date was not changed
    const spentAt = e && date === isoDay(e.spentAt) ? e.spentAt : Math.min(dayStart(date) + 12 * 3600_000, Date.now());
    const body = { category, amountCents: cents, paidVia, payee: payee.trim(), note: note.trim(), spentAt };
    setBusy(true);
    const ok = await act(e ? update({ expenseId: e._id, ...body }) : create(body), e ? "Expense saved" : "Expense added");
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <SheetHeader><SheetTitle>{e ? "Edit expense" : "Add expense"}</SheetTitle><SheetDescription>Cash expenses are counted in your open shift.</SheetDescription></SheetHeader>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        <Field label="Category" required><NativeSelect value={category} onChange={setCategory} options={options.map((c) => ({ value: c, label: c }))} /></Field>
        <Field label="Amount" required error={amountErr}><MoneyInput cur={cur} value={amount} onChange={setAmount} placeholder="0.00" autoFocus={!e} /></Field>
        <div role="group" aria-labelledby="paid-via" className="space-y-1.5">
          <p id="paid-via" className="text-sm font-medium">Paid with</p>
          <Segmented label="Paid with" value={paidVia} onChange={setPaidVia} className="flex-wrap" options={PAID_VIA.map((m) => ({ value: m, label: METHOD_LABEL[m] }))} />
        </div>
        <Field label="Date"><Input type="date" value={date} max={isoDay(Date.now())} onChange={(ev) => ev.target.value && setDate(ev.target.value)} /></Field>
        <Field label="Paid to" hint="Optional. Shop, person or company."><Input value={payee} onChange={(ev) => setPayee(ev.target.value)} maxLength={100} /></Field>
        <Field label="Note"><Textarea rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={500} /></Field>
      </div>
      <SheetFooter className="border-t pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="lg" className="flex-1" onClick={onClose}>Cancel</Button>
          <SubmitButton type="submit" size="lg" className="flex-1" busy={busy}>{e ? "Save" : "Add expense"}</SubmitButton>
        </div>
      </SheetFooter>
    </form>
  );
}
