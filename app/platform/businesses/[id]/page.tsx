"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Banknote, CalendarPlus, Lock, Repeat, Store, Unlock } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ConfirmDialog, Field, ListSkeleton, Panel, Pill, Stat, SubmitButton } from "@/components/common";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCents, parseToCents } from "@/convex/shared/money";
import { act, run } from "@/lib/run";
import { businessStatus, fmtDate, fmtDateTime } from "@/lib/session";

type Dlg = "suspend" | "activate" | "plan" | "extend" | "payment" | null;

export default function BusinessDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = use(params).id as Id<"businesses">;
  const d = useQuery(api.platformTenants.get, { businessId: id });
  const plans = useQuery(api.platformPlans.list);
  const [dlg, setDlg] = useState<Dlg>(null);
  const activate = useMutation(api.platformTenants.activate);

  if (!d || !plans) return <Panel><ListSkeleton /></Panel>;
  const b = d.business;
  const st = businessStatus(b);
  const cur = b.currency;

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm"><Link href="/platform/businesses"><ArrowLeft /> Businesses</Link></Button>
      <Panel className="flex flex-wrap items-center gap-4 p-5">
        <Avatar className="size-16 rounded-xl"><AvatarImage src={d.logoUrl ?? undefined} alt="" /><AvatarFallback className="rounded-xl"><Store className="size-6" /></AvatarFallback></Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{b.name}</h1><Pill tone={st.tone}>{st.label}</Pill></div>
          <p className="text-sm text-muted-foreground">{b.businessType} · {b.address}, {b.city}, {b.country}</p>
          <p className="text-sm text-muted-foreground">{b.phone}{b.email && ` · ${b.email}`}</p>
          {b.status === "SUSPENDED" && b.suspendedReason && <p className="mt-1 text-sm text-red-600">Suspended: {b.suspendedReason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setDlg("plan")}><Repeat /> Change plan</Button>
          <Button variant="outline" size="sm" onClick={() => setDlg("extend")}><CalendarPlus /> Extend</Button>
          <Button size="sm" onClick={() => setDlg("payment")}><Banknote /> Record payment</Button>
          {b.status === "SUSPENDED"
            ? <Button variant="outline" size="sm" onClick={() => setDlg("activate")}><Unlock /> Activate</Button>
            : <Button variant="outline" size="sm" className="text-red-600" onClick={() => setDlg("suspend")}><Lock /> Suspend</Button>}
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Plan" value={d.plan?.name ?? "-"} sub={`${b.subscriptionStatus} · ends ${fmtDate(b.subscriptionEndsAt)}`} />
        <Stat label="Products" value={d.stats.products} />
        <Stat label="Customers" value={d.stats.customers} />
        <Stat label="Sales (30 days)" value={formatCents(d.stats.sales30dCents, cur)} sub={`${d.stats.sales30dCount} sales`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <div className="border-b p-4 font-semibold">Owner and staff</div>
          <ul className="divide-y">
            {d.staff.map((m) => (
              <li key={m._id} className="flex items-center justify-between p-3 text-sm">
                <span><span className="font-medium">{m.fullName}</span><span className="block text-xs text-muted-foreground">@{m.username}{m.phone && ` · ${m.phone}`}</span></span>
                <span className="flex gap-1.5"><Pill tone={m.role === "OWNER" ? "indigo" : "slate"}>{m.role}</Pill>{!m.isActive && <Pill tone="red">Locked</Pill>}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <div className="border-b p-4 font-semibold">Payments</div>
          {d.payments.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No payments recorded.</p> : (
            <ul className="divide-y">
              {d.payments.map((p) => (
                <li key={p._id} className="flex items-center justify-between p-3 text-sm">
                  <span>{fmtDate(p.createdAt)} · {p.method}{p.reference && ` · ${p.reference}`}<span className="block text-xs text-muted-foreground">{p.months} month{p.months === 1 ? "" : "s"}</span></span>
                  <span className="font-medium tabular-nums">{formatCents(p.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel>
        <div className="border-b p-4 font-semibold">Recent activity</div>
        {d.audit.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No activity yet.</p> : (
          <ul className="divide-y">
            {d.audit.map((a) => (
              <li key={a._id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                <span className="w-32 shrink-0 text-xs text-muted-foreground">{fmtDateTime(a.createdAt)}</span>
                <Pill tone="indigo">{a.action}</Pill><span className="text-muted-foreground">{a.actorName}</span>{a.details && <span>{a.details}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <SuspendDialog open={dlg === "suspend"} onClose={() => setDlg(null)} id={id} name={b.name} />
      <ConfirmDialog open={dlg === "activate"} onOpenChange={(o) => !o && setDlg(null)} destructive={false} title={`Activate ${b.name}?`} desc="The business can use the app again immediately." confirmLabel="Activate"
        onConfirm={async () => { await run(activate({ businessId: id }), "Business activated"); }} />
      <PlanDialog open={dlg === "plan"} onClose={() => setDlg(null)} id={id} current={b.planId} plans={plans} />
      <ExtendDialog open={dlg === "extend"} onClose={() => setDlg(null)} id={id} />
      <PaymentDialog open={dlg === "payment"} onClose={() => setDlg(null)} id={id} current={b.planId} plans={plans} />
    </div>
  );
}

type Plans = { _id: Id<"plans">; name: string; priceCents: number }[];
const sel = "h-9 w-full rounded-lg border bg-white px-2 text-sm";

function SuspendDialog({ open, onClose, id, name }: { open: boolean; onClose: () => void; id: Id<"businesses">; name: string }) {
  const suspend = useMutation(api.platformTenants.suspend);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Suspend {name}?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Everyone in this business is locked out immediately, including the POS.</p>
        <Field label="Reason (shown to the owner)"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton variant="destructive" busy={busy} disabled={!reason.trim()} onClick={async () => {
            setBusy(true); const ok = await act(suspend({ businessId: id, reason: reason.trim() }), "Business suspended"); setBusy(false); if (ok) { setReason(""); onClose(); }
          }}>Suspend</SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanDialog({ open, onClose, id, current, plans }: { open: boolean; onClose: () => void; id: Id<"businesses">; current: Id<"plans">; plans: Plans }) {
  const change = useMutation(api.platformTenants.changePlan);
  const [planId, setPlanId] = useState<Id<"plans">>(current);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Change plan</DialogTitle></DialogHeader>
        <Field label="Plan"><select className={sel} value={planId} onChange={(e) => setPlanId(e.target.value as Id<"plans">)}>{plans.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></Field>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton busy={busy} disabled={planId === current} onClick={async () => { setBusy(true); const ok = await act(change({ businessId: id, planId }), "Plan changed"); setBusy(false); if (ok) onClose(); }}>Change plan</SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExtendDialog({ open, onClose, id }: { open: boolean; onClose: () => void; id: Id<"businesses"> }) {
  const extend = useMutation(api.platformTenants.extend);
  const [days, setDays] = useState("14");
  const [busy, setBusy] = useState(false);
  const n = Number(days);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Extend subscription</DialogTitle></DialogHeader>
        <Field label="Days to add"><Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton busy={busy} disabled={!Number.isInteger(n) || n <= 0} onClick={async () => { setBusy(true); const ok = await act(extend({ businessId: id, days: n }), "Subscription extended"); setBusy(false); if (ok) onClose(); }}>Extend</SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ open, onClose, id, current, plans }: { open: boolean; onClose: () => void; id: Id<"businesses">; current: Id<"plans">; plans: Plans }) {
  const record = useMutation(api.platformTenants.recordPayment);
  const [planId, setPlanId] = useState<Id<"plans">>(current);
  const [months, setMonths] = useState("1");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("EVC");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const m = Number(months);
  const cents = parseToCents(amount);
  const suggested = (plans.find((p) => p._id === planId)?.priceCents ?? 0) * (Number.isInteger(m) ? m : 0);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Plan"><select className={sel} value={planId} onChange={(e) => setPlanId(e.target.value as Id<"plans">)}>{plans.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></Field>
          <Field label="Months"><Input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} /></Field>
          <Field label="Amount" hint={suggested ? `Plan price x months = ${formatCents(suggested)}` : undefined}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>
          <Field label="Method"><select className={sel} value={method} onChange={(e) => setMethod(e.target.value)}>{["EVC", "ZAAD", "EDAHAB", "BANK", "CASH"].map((x) => <option key={x}>{x}</option>)}</select></Field>
        </div>
        <Field label="Reference (optional)"><Input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={100} /></Field>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton busy={busy} disabled={cents === null || !Number.isInteger(m) || m <= 0} onClick={async () => {
            setBusy(true);
            const ok = await act(record({ businessId: id, planId, amountCents: cents!, months: m, method, reference: ref.trim() || undefined }), "Payment recorded, subscription updated");
            setBusy(false); if (ok) { setAmount(""); setRef(""); onClose(); }
          }}>Record payment</SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
