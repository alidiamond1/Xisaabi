"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, Info } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { ConfirmDialog, ListSkeleton, PageHeader, Panel, Pill } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatCents } from "@/convex/shared/money";
import { run } from "@/lib/run";
import { fmtDate } from "@/lib/session";
import { cn } from "@/lib/utils";

type Plan = FunctionReturnType<typeof api.billing.plans>[number];

const FALLBACK_PAYMENT_INFO = process.env.NEXT_PUBLIC_PAYMENT_INSTRUCTIONS ?? "Pay via EVC Plus or Zaad to the number our team sends you, then we activate your plan.";

function Usage({ label, used, max }: { label: string; used: number; max: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm"><span>{label}</span><span className="tabular-nums text-muted-foreground">{used} / {max === 0 ? "unlimited" : max}</span></div>
      <Progress value={max === 0 ? 0 : Math.min(100, (used / max) * 100)} />
    </div>
  );
}

export default function BillingPage() {
  const b = useQuery(api.billing.current);
  const plans = useQuery(api.billing.plans);
  const request = useMutation(api.billing.requestPlan);
  const PAYMENT_INFO = useQuery(api.platformSettings.get)?.paymentInstructions || FALLBACK_PAYMENT_INFO;
  const [pick, setPick] = useState<Plan | null>(null);

  if (!b || !plans) return <Panel><ListSkeleton /></Panel>;
  const days = Math.ceil((b.subscriptionEndsAt - Date.now()) / 86_400_000);
  const expired = days <= 0;

  return (
    <>
      <PageHeader title="Billing" desc="Your plan, usage and payments." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="space-y-4 p-5 lg:col-span-2">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Current plan</p>
              <p className="text-2xl font-semibold">{b.plan.name}</p>
              <p className="text-sm text-muted-foreground">{expired ? "Expired" : b.subscriptionStatus === "TRIAL" ? "Trial ends" : "Renews"} {fmtDate(b.subscriptionEndsAt)}{!expired && ` (${days} days)`}</p>
            </div>
            <Pill tone={expired ? "red" : b.subscriptionStatus === "ACTIVE" ? "green" : "amber"}>{expired ? "Expired" : b.subscriptionStatus}</Pill>
          </div>
          <Usage label="Users" used={b.usage.users} max={b.plan.maxUsers} />
          <Usage label="Products" used={b.usage.products} max={b.plan.maxProducts} />
        </Panel>
        <Panel className="p-5">
          <h2 className="mb-2 flex items-center gap-2 font-semibold"><Info className="size-4 text-indigo-600" />How to pay</h2>
          <p className="text-sm text-muted-foreground">{PAYMENT_INFO}</p>
          <p className="mt-2 text-sm text-muted-foreground">Choose a plan below and we will contact you to confirm payment.</p>
        </Panel>
      </div>

      <h2 className="mb-3 mt-6 font-semibold">Plans</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const current = p._id === b.plan._id;
          return (
            <div key={p._id} className={cn("flex flex-col rounded-xl border bg-white p-5", current && "border-indigo-600 ring-1 ring-indigo-600")}>
              <div className="flex items-center justify-between"><h3 className="font-semibold">{p.name}</h3>{current && <Pill tone="indigo">Current</Pill>}</div>
              <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
              <p className="mt-3 text-3xl font-semibold tabular-nums">{p.priceCents === 0 ? "Free" : formatCents(p.priceCents)}<span className="text-sm font-normal text-muted-foreground">{p.priceCents ? " / month" : ""}</span></p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                {p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{f}</li>)}
              </ul>
              <Button className="mt-5" variant={current ? "outline" : "default"} onClick={() => setPick(p)}>{current ? "Renew this plan" : "Request this plan"}</Button>
            </div>
          );
        })}
      </div>

      <h2 className="mb-3 mt-6 font-semibold">Payment history</h2>
      <Panel>
        {b.payments.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No payments recorded yet.</p> : (
          <ul className="divide-y">
            {b.payments.map((p) => (
              <li key={p._id} className="flex items-center justify-between p-3 text-sm">
                <span>{fmtDate(p.createdAt)} · {p.method}{p.reference && ` · ${p.reference}`}<span className="block text-xs text-muted-foreground">{p.months} month{p.months === 1 ? "" : "s"}</span></span>
                <span className="font-medium tabular-nums">{formatCents(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ConfirmDialog open={!!pick} onOpenChange={(o) => !o && setPick(null)} destructive={false} title={`Request ${pick?.name}?`}
        desc={`We will create a billing ticket. ${PAYMENT_INFO}`} confirmLabel="Send request"
        onConfirm={async () => { if (pick) await run(request({ planId: pick._id }), "Request sent. Check Support for our reply."); }} />
    </>
  );
}
