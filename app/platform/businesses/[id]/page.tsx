"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Banknote, CalendarPlus, KeyRound, Lock, LogOut, Pencil, Plus, Repeat, Store, Trash2, Unlock } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ConfirmDialog, EmptyState, Field, FilterChips, KeyValue, ListSkeleton, PageHeader, Panel, Pill, Stat, SubmitButton,
} from "@/components/common";
import { usePlatform } from "@/components/guard";
import { ActivityFeed, HealthPill, PasswordDialog, SEL, VoidDialog, ago, useNow } from "@/components/platform";
import { StatusPill } from "@/components/tickets";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatCents, parseToCents } from "@/convex/shared/money";
import { act, run } from "@/lib/run";
import { businessStatus, fmtDate, fmtDateTime } from "@/lib/session";
import { cn } from "@/lib/utils";

type Dlg = "suspend" | "activate" | "plan" | "extend" | "payment" | "profile" | null;
type Tab = "overview" | "staff" | "billing" | "activity" | "support" | "notes";
type Detail = NonNullable<FunctionReturnType<typeof api.platformTenants.get>>;
const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" }, { value: "staff", label: "Staff" }, { value: "billing", label: "Billing" },
  { value: "activity", label: "Activity" }, { value: "support", label: "Support" }, { value: "notes", label: "Notes" },
];

export default function BusinessDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = use(params).id as Id<"businesses">;
  const now = useNow();
  const d = useQuery(api.platformTenants.get, { businessId: id, now });
  const plans = useQuery(api.platformPlans.list);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const activate = useMutation(api.platformTenants.activate);

  if (!d || !plans) return <Panel><ListSkeleton /></Panel>;
  const b = d.business;
  const st = businessStatus(b);
  const close = () => setDlg(null);

  return (
    <>
      <PageHeader back={{ href: "/platform/businesses", label: "Businesses" }} title={b.name}
        meta={<><Pill tone={st.tone}>{st.label}</Pill><HealthPill h={d.health} /></>}
        desc={`${b.businessType} · ${b.city}`} />
      <div className="mb-4"><FilterChips options={TABS} value={tab} onChange={setTab} /></div>

      {tab === "overview" && <Overview d={d} onEdit={() => setDlg("profile")} onChangePlan={() => setDlg("plan")} onSuspend={() => setDlg("suspend")} onActivate={() => setDlg("activate")} />}
      {tab === "staff" && <StaffTab id={id} />}
      {tab === "billing" && <BillingTab d={d} onDialog={setDlg} />}
      {tab === "activity" && <Panel><ActivityFeed filters={{ businessId: id }} showBusiness={false} /></Panel>}
      {tab === "support" && <SupportTab d={d} />}
      {tab === "notes" && <NotesTab id={id} notes={d.notes} />}

      <SuspendDialog open={dlg === "suspend"} onClose={close} id={id} name={b.name} />
      <ConfirmDialog open={dlg === "activate"} onOpenChange={(o) => !o && close()} destructive={false} title={`Activate ${b.name}?`} desc="The business can use the app again immediately." confirmLabel="Activate"
        onConfirm={async () => { await run(activate({ businessId: id }), "Business activated"); }} />
      <PlanDialog open={dlg === "plan"} onClose={close} id={id} current={b.planId} plans={plans} />
      <ExtendDialog open={dlg === "extend"} onClose={close} id={id} />
      <PaymentDialog open={dlg === "payment"} onClose={close} id={id} current={b.planId} plans={plans} />
      <ProfileDialog open={dlg === "profile"} onClose={close} b={b} />
    </>
  );
}

function Usage({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = max === 0 ? 0 : Math.min(100, (used / max) * 100);
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-sm"><span>{label}</span><span className="tabular-nums text-muted-foreground">{used} / {max === 0 ? "unlimited" : max}</span></div>
      <Progress value={pct} className={cn("h-2", pct >= 90 && "[&>div]:bg-danger")} aria-label={label} />
    </div>
  );
}

function Overview({ d, onEdit, onChangePlan, onSuspend, onActivate }: { d: Detail; onEdit: () => void; onChangePlan: () => void; onSuspend: () => void; onActivate: () => void }) {
  const b = d.business;
  const s = d.stats;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sales (30 days)" value={formatCents(s?.sales30dCents ?? 0)} sub={`${s?.sales30dCount ?? 0} sales`} />
        <Stat label="Products" value={s?.products ?? 0} />
        <Stat label="Customers" value={s?.customers ?? 0} />
        <Stat label="Last sale" value={s?.lastSaleAt ? `${ago(s.lastSaleAt)} ago` : "never"} sub={s?.lastLoginAt ? `last login ${fmtDate(s.lastLoginAt)}` : "no logins yet"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <div className="flex items-center justify-between gap-2 border-b p-4">
            <span className="flex items-center gap-3">
              <Avatar className="size-10 rounded-lg"><AvatarImage src={d.logoUrl ?? undefined} alt="" /><AvatarFallback className="rounded-lg"><Store className="size-4" /></AvatarFallback></Avatar>
              <span className="font-semibold">Profile</span>
            </span>
            <Button variant="outline" size="sm" onClick={onEdit}><Pencil /> Edit</Button>
          </div>
          <KeyValue items={[
            { label: "Owner", value: d.owner ? `${d.owner.fullName} (@${d.owner.username})` : "-" },
            { label: "Phone", value: <a href={`tel:${b.phone}`} className="text-brand-700">{b.phone}</a> },
            { label: "Email", value: b.email ?? "-" },
            { label: "Address", value: `${b.address}, ${b.city}, ${b.country}` },
            { label: "Type", value: b.businessType },
            { label: "Joined", value: fmtDate(b.createdAt) },
          ]} />
        </Panel>
        <Panel>
          <div className="flex items-center justify-between gap-2 border-b p-4">
            <span className="font-semibold">Plan</span>
            <Button variant="outline" size="sm" onClick={onChangePlan}><Repeat /> Change</Button>
          </div>
          <KeyValue items={[
            { label: "Plan", value: d.plan?.name ?? "-" },
            { label: "Subscription", value: b.subscriptionStatus },
            { label: "Ends", value: fmtDate(b.subscriptionEndsAt) },
          ]} />
          <div className="space-y-4 border-t p-4">
            <Usage label="Users" used={d.usage.users.used} max={d.usage.users.max} />
            <Usage label="Products" used={d.usage.products.used} max={d.usage.products.max} />
            {s && <p className="text-xs text-muted-foreground">Stats updated {fmtDateTime(s.updatedAt)}</p>}
          </div>
        </Panel>
      </div>
      <Panel className="border-danger/30">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="font-semibold text-danger">Danger zone</p>
            <p className="text-sm text-muted-foreground">{b.status === "SUSPENDED" ? `Suspended: ${b.suspendedReason ?? ""}` : "Suspending locks everyone out of this business, including the POS."}</p>
          </div>
          {b.status === "SUSPENDED"
            ? <Button variant="outline" onClick={onActivate}><Unlock /> Activate</Button>
            : <Button variant="destructive" onClick={onSuspend}><Lock /> Suspend</Button>}
        </div>
      </Panel>
    </div>
  );
}

function StaffTab({ id }: { id: Id<"businesses"> }) {
  const sup = usePlatform().member.role === "SUPER_ADMIN";
  const members = useQuery(api.platformTenants.members, { businessId: id });
  const setActive = useMutation(api.platformTenants.setMemberActive);
  const forceLogout = useAction(api.platformTenants.forceLogout);
  const reset = useAction(api.platformTenants.resetMemberPassword);
  const [resetFor, setResetFor] = useState<{ _id: Id<"members">; fullName: string } | null>(null);
  const [logoutFor, setLogoutFor] = useState<{ _id: Id<"members">; fullName: string } | null>(null);
  if (!members) return <Panel><ListSkeleton /></Panel>;
  return (
    <Panel>
      <ul className="divide-y">
        {members.map((m) => (
          <li key={m._id} className="space-y-2 p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0"><span className="block font-medium">{m.fullName}</span><span className="block truncate text-xs text-muted-foreground">@{m.username}{m.phone && ` · ${m.phone}`}</span></span>
              <span className="flex shrink-0 items-center gap-2"><Pill tone={m.role === "OWNER" ? "indigo" : "slate"}>{m.role}</Pill>
                <Switch checked={m.isActive} aria-label={`${m.fullName} active`} onCheckedChange={(v) => run(setActive({ memberId: m._id, isActive: v }), v ? "Account unlocked" : "Account locked")} /></span>
            </div>
            <p className="text-xs text-muted-foreground">Last login: {m.lastLoginAt ? fmtDateTime(m.lastLoginAt) : "never"}{!m.isActive && " · locked"}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setLogoutFor(m)}><LogOut /> Force logout</Button>
              {sup && <Button variant="outline" size="sm" onClick={() => setResetFor(m)}><KeyRound /> Reset password</Button>}
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog open={!!logoutFor} onOpenChange={(o) => !o && setLogoutFor(null)} destructive={false} title={`Sign ${logoutFor?.fullName} out?`} desc="Every device of this person is logged out. They can log in again with their password." confirmLabel="Force logout"
        onConfirm={async () => { if (logoutFor) await run(forceLogout({ memberId: logoutFor._id }), "Signed out everywhere"); }} />
      <PasswordDialog open={!!resetFor} onClose={() => setResetFor(null)} title={`Reset password for ${resetFor?.fullName}`}
        submit={(pw) => act(reset({ memberId: resetFor!._id, newPassword: pw }), "Password reset")} />
    </Panel>
  );
}

function BillingTab({ d, onDialog }: { d: Detail; onDialog: (x: Dlg) => void }) {
  const sup = usePlatform().member.role === "SUPER_ADMIN";
  const voidPay = useMutation(api.platformBilling.voidPayment);
  const [voiding, setVoiding] = useState<Id<"subscriptionPayments"> | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {sup && <Button onClick={() => onDialog("payment")}><Banknote /> Record payment</Button>}
        {sup && <Button variant="outline" onClick={() => onDialog("plan")}><Repeat /> Change plan</Button>}
        {sup && <Button variant="outline" onClick={() => onDialog("extend")}><CalendarPlus /> Add days</Button>}
      </div>
      <Panel>
        <div className="border-b p-4 font-semibold">Payments</div>
        {d.payments.length === 0 ? <EmptyState icon={Banknote} title="No payments recorded" /> : (
          <ul className="divide-y">
            {d.payments.map((p) => {
              const gone = p.voidedAt !== undefined;
              return (
                <li key={p._id} className="flex items-start justify-between gap-3 p-4 text-sm">
                  <span className="min-w-0">
                    <span className={cn("block", gone && "text-muted-foreground line-through")}>{fmtDate(p.createdAt)} · {p.method}{p.reference && ` · ${p.reference}`}</span>
                    <span className="block text-xs text-muted-foreground">{p.months} month{p.months === 1 ? "" : "s"}{gone && ` · voided: ${p.voidReason ?? ""}`}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className={cn("font-medium tabular-nums", gone && "text-muted-foreground line-through")}>{formatCents(p.amountCents)}</span>
                    {gone ? <Pill tone="slate">Void</Pill> : sup && <Button variant="ghost" size="sm" className="text-danger" onClick={() => setVoiding(p._id)}>Void</Button>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <VoidDialog open={!!voiding} onClose={() => setVoiding(null)} submit={(reason) => act(voidPay({ paymentId: voiding!, reason }), "Payment voided")} />
    </div>
  );
}

function SupportTab({ d }: { d: Detail }) {
  return (
    <Panel>
      {d.openTickets.length === 0 ? <EmptyState title="No open tickets" /> : (
        <ul className="divide-y">
          {d.openTickets.map((t) => (
            <li key={t._id}>
              <Link href={`/platform/support?t=${t._id}`} className="flex min-h-14 items-center justify-between gap-3 p-4 text-sm hover:bg-muted">
                <span className="min-w-0"><span className="block truncate font-medium">{t.subject}</span><span className="text-xs text-muted-foreground">{fmtDateTime(t.lastMessageAt)}</span></span>
                <StatusPill status={t.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function NotesTab({ id, notes }: { id: Id<"businesses">; notes: Detail["notes"] }) {
  const add = useMutation(api.platformTenants.addNote);
  const del = useMutation(api.platformTenants.deleteNote);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      <Panel className="space-y-3 p-4">
        <p className="text-xs text-muted-foreground">Internal notes. Never visible to the business.</p>
        <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} placeholder="Add a note..." />
        <SubmitButton busy={busy} disabled={!body.trim()} onClick={async () => { setBusy(true); const ok = await act(add({ businessId: id, body: body.trim() }), "Note added"); setBusy(false); if (ok) setBody(""); }}><Plus /> Add note</SubmitButton>
      </Panel>
      <Panel>
        {notes.length === 0 ? <EmptyState title="No notes yet" /> : (
          <ul className="divide-y">
            {notes.map((n) => (
              <li key={n._id} className="flex items-start justify-between gap-3 p-4 text-sm">
                <span className="min-w-0"><span className="block whitespace-pre-wrap break-words">{n.body}</span><span className="text-xs text-muted-foreground">{n.authorName} · {fmtDateTime(n.createdAt)}</span></span>
                <Button variant="ghost" size="icon" aria-label="Delete note" className="text-danger" onClick={() => run(del({ noteId: n._id }), "Note deleted")}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

type Plans = { _id: Id<"plans">; name: string; priceCents: number }[];

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

function ProfileDialog({ open, onClose, b }: { open: boolean; onClose: () => void; b: Detail["business"] }) {
  const edit = useMutation(api.platformTenants.editProfile);
  const [f, setF] = useState({ name: b.name, phone: b.phone, city: b.city, address: b.address, email: b.email ?? "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true);
          const ok = await act(edit({ businessId: b._id, name: f.name.trim(), phone: f.phone.trim(), city: f.city.trim(), address: f.address.trim(), email: f.email.trim() || undefined }), "Profile updated");
          setBusy(false); if (ok) onClose();
        }}>
          <DialogHeader><DialogTitle>Edit business profile</DialogTitle></DialogHeader>
          <Field label="Name" required><Input value={f.name} onChange={set("name")} required /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone" required><Input inputMode="tel" value={f.phone} onChange={set("phone")} required /></Field>
            <Field label="City" required><Input value={f.city} onChange={set("city")} required /></Field>
          </div>
          <Field label="Address" required><Input value={f.address} onChange={set("address")} required /></Field>
          <Field label="Email (optional)"><Input type="email" value={f.email} onChange={set("email")} /></Field>
          <DialogFooter><SubmitButton type="submit" busy={busy}>Save</SubmitButton></DialogFooter>
        </form>
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
        <Field label="Plan"><select className={`${SEL} w-full`} value={planId} onChange={(e) => setPlanId(e.target.value as Id<"plans">)}>{plans.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></Field>
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
        <DialogHeader><DialogTitle>Add days</DialogTitle></DialogHeader>
        <Field label="Days to add (trial or paid)"><Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        <div className="flex gap-2">{[7, 14, 30].map((d) => <Button key={d} type="button" variant="outline" size="sm" onClick={() => setDays(String(d))}>+{d} days</Button>)}</div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton busy={busy} disabled={!Number.isInteger(n) || n <= 0} onClick={async () => { setBusy(true); const ok = await act(extend({ businessId: id, days: n }), "Subscription extended"); setBusy(false); if (ok) onClose(); }}>Add days</SubmitButton>
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Plan"><select className={`${SEL} w-full`} value={planId} onChange={(e) => setPlanId(e.target.value as Id<"plans">)}>{plans.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></Field>
          <Field label="Months"><Input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} /></Field>
          <Field label="Amount" hint={suggested ? `Plan price x months = ${formatCents(suggested)}` : undefined}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>
          <Field label="Method"><select className={`${SEL} w-full`} value={method} onChange={(e) => setMethod(e.target.value)}>{["EVC", "ZAAD", "EDAHAB", "BANK", "CASH"].map((x) => <option key={x}>{x}</option>)}</select></Field>
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
