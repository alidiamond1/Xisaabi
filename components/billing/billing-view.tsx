"use client";
import Link from "next/link";
import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { Check, Info, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Banner, ConfirmDialog, EmptyState, ListSkeleton, PageHeader, Panel, Pill } from "@/components/common";
import { PeriodSelector } from "@/components/billing/period-selector";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatCents } from "@/convex/shared/money";
import { errorMessage } from "@/convex/shared/errors";
import { planPriceCents, type BillingPeriod } from "@/convex/shared/subscriptions";
import { fmtDate } from "@/lib/session";
import { cn } from "@/lib/utils";

type Plan = FunctionReturnType<typeof api.billing.plans>[number];
export type BillingViewProps = {
  billing: FunctionReturnType<typeof api.billing.current> | undefined;
  plans: Plan[] | undefined;
  paymentInfo: string;
  checkoutNotice?: React.ReactNode;
  onCheckout: (plan: Plan, period: BillingPeriod) => Promise<void>;
  onRequest: (plan: Plan, period: BillingPeriod) => Promise<void>;
};

function Usage({ label, used, max }: { label: string; used: number; max: number }) {
  return <div>
    <div className="mb-1 flex justify-between gap-3 text-sm"><span>{label}</span><span className="tabular-nums text-muted-foreground">{used} / {max === 0 ? "unlimited" : max}</span></div>
    <Progress value={max === 0 ? 0 : Math.min(100, (used / max) * 100)} aria-label={`${label} usage`} />
  </div>;
}

export function BillingView({ billing: b, plans, paymentInfo, checkoutNotice, onCheckout, onRequest }: BillingViewProps) {
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [pick, setPick] = useState<{ plan: Plan; period: BillingPeriod } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  if (!b || plans === undefined) return <Panel><ListSkeleton /></Panel>;
  const days = Math.ceil((b.subscriptionEndsAt - Date.now()) / 86_400_000);
  const expired = days <= 0;
  const online = b.checkoutEnabled;
  const pickedAmount = pick ? planPriceCents(pick.plan, pick.period) : 0;
  const changingPlan = pick && pick.plan._id !== b.plan._id && !expired && b.subscriptionStatus === "ACTIVE";
  const periodLabel = (value: BillingPeriod) => value === "yearly" ? "year" : "month";

  async function confirm() {
    if (!pick) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (online) {
        await onCheckout(pick.plan, pick.period);
      } else {
        await onRequest(pick.plan, pick.period);
        setNotice("Request sent. Open Support to see our reply and payment instructions.");
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <PageHeader title="Billing" desc="Your plan, usage and payments." />
    <div className="mb-4 space-y-3">
      {checkoutNotice}
      {error && <Banner tone="danger">{error} Please try again, or <Link className="underline" href="/apps/support">contact Support</Link>.</Banner>}
      {notice && <Banner tone="success">{notice}</Banner>}
      {online && b.checkoutEnvironment === "sandbox" && <Banner tone="warning">Sandbox checkout is enabled. This is a test payment and does not collect real money.</Banner>}
    </div>
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel className="space-y-4 p-5 lg:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Current plan</p>
            <p className="break-words text-2xl font-semibold">{b.plan.name}</p>
            <p className="text-sm text-muted-foreground">{expired ? "Expired" : b.subscriptionStatus === "TRIAL" ? "Trial ends" : "Renews"} {fmtDate(b.subscriptionEndsAt)}{!expired && ` (${days} days)`}</p>
          </div>
          <Pill tone={expired ? "red" : b.subscriptionStatus === "ACTIVE" ? "green" : "amber"}>{expired ? "Expired" : b.subscriptionStatus}</Pill>
        </div>
        <Usage label="Users" used={b.usage.users} max={b.plan.maxUsers} />
        <Usage label="Products" used={b.usage.products} max={b.plan.maxProducts} />
      </Panel>
      <Panel className="p-5">
        <h2 className="mb-2 flex items-center gap-2 font-semibold"><Info aria-hidden className="size-4 shrink-0 text-brand-600" />How to pay</h2>
        {online ? <p className="text-sm text-muted-foreground">Choose a plan and billing period. Pay securely on SNAP’s hosted checkout using the payment methods it offers. Your plan updates only after the payment is verified.</p> : <>
          <p className="break-words text-sm text-muted-foreground">{paymentInfo}</p>
          <p className="mt-2 text-sm text-muted-foreground">Choose a plan below to request manual payment confirmation from our team.</p>
        </>}
      </Panel>
    </div>

    <div className="mb-4 mt-6 flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold">Plans</h2>
      <PeriodSelector value={period} onChange={setPeriod} disabled={busy} />
    </div>
    <p className="mb-4 text-sm text-muted-foreground" aria-live="polite">{period === "yearly" ? "One payment for a full year. The full yearly amount is shown below." : "One payment for a month."}</p>
    {plans.length === 0 ? <Panel><EmptyState title="No plans are available yet" desc="Contact our team to choose a plan." action={<Button asChild variant="outline"><Link href="/apps/support">Contact Support</Link></Button>} /></Panel> : <div className="grid gap-4 md:grid-cols-3">
      {plans.map((p) => {
        const current = p._id === b.plan._id;
        const price = planPriceCents(p, period);
        return <div key={p._id} className={cn("flex min-w-0 flex-col rounded-xl border bg-card p-5", current && "border-brand-600 ring-1 ring-brand-600")}>
          <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="min-w-0 break-words font-semibold">{p.name}</h3>{current && <Pill tone="brand">Current</Pill>}</div>
          <p className="mt-1 break-words text-sm text-muted-foreground">{p.description}</p>
          <p className="mt-3 break-words font-display text-3xl font-semibold tabular-nums">{price === 0 ? "Free" : formatCents(price)}{price > 0 && <span className="text-sm font-normal text-muted-foreground"> / {periodLabel(period)}</span>}</p>
          <ul className="mt-4 flex-1 space-y-1.5 text-sm">{p.features.map((f) => <li key={f} className="flex min-w-0 gap-2"><Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-600" /><span className="break-words">{f}</span></li>)}</ul>
          {p.isDefaultTrial ? <p className="mt-5 text-sm text-muted-foreground">Your free trial. Pick a plan to keep going after it ends.</p> : <Button size="lg" className="mt-5" variant={current ? "outline" : "default"} disabled={busy} onClick={() => setPick({ plan: p, period })}>{busy ? <Loader2 aria-hidden className="animate-spin" /> : null}{online ? price === 0 ? "Activate this plan" : current ? "Pay to renew" : "Pay for this plan" : current ? "Request renewal" : "Request this plan"}</Button>}
        </div>;
      })}
    </div>}

    <h2 className="mb-3 mt-6 font-semibold">Payment history</h2>
    <Panel>{b.payments.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No payments recorded yet.</p> : <ul className="divide-y">
      {b.payments.map((p) => <li key={p._id} className="flex items-start justify-between gap-3 p-3 text-sm">
        <span className="min-w-0 break-words">{fmtDate(p.createdAt)} · {p.method}{p.reference && ` · ${p.reference}`}<span className="block text-xs text-muted-foreground">{p.months} month{p.months === 1 ? "" : "s"}</span></span>
        <span className="shrink-0 font-medium tabular-nums">{formatCents(p.amountCents)}</span>
      </li>)}
    </ul>}</Panel>

    <ConfirmDialog open={!!pick} onOpenChange={(open) => !open && setPick(null)} destructive={false}
      title={pick ? `${online ? "Continue with" : "Request"} ${pick.plan.name}?` : "Choose a plan"}
      desc={pick ? `${formatCents(pickedAmount)} for one ${periodLabel(pick.period)}. ${online ? pickedAmount === 0 ? "This free plan will be activated." : "You will continue to SNAP’s hosted checkout." : `We will create a billing ticket. ${paymentInfo}`} ${changingPlan && online ? "Changing plans starts a new billing period. Unused time on your current plan is not credited." : ""}` : ""}
      confirmLabel={online ? pickedAmount === 0 ? "Activate plan" : "Continue to checkout" : "Send request"} onConfirm={confirm} />
  </>;
}
