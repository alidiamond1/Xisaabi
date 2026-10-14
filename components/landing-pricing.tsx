"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { Check } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/convex/shared/money";
import { MODULE_LABELS } from "@/lib/apps";
import { cn } from "@/lib/utils";

const limit = (n: number) => (n === 0 ? "Unlimited" : String(n));

export function Pricing({ compare }: { compare?: boolean }) {
  const plans = useQuery(api.plans.publicList);
  if (plans === undefined) {
    return <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-80 rounded-2xl" />)}</div>;
  }
  const trial = plans.find((p) => p.isDefaultTrial && p.trialDays > 0) ?? plans.find((p) => p.trialDays > 0);
  return (
    <>
      <div className="grid gap-5 md:grid-cols-3">
        {plans.map((p, i) => {
          const featured = plans.length > 2 ? i === 1 : i === plans.length - 1;
          return (
            <div key={p._id} className={cn("relative flex flex-col rounded-2xl border bg-card p-6 shadow-card", featured && "border-brand-600 shadow-pop ring-1 ring-brand-600")}>
              {featured && <span className="absolute -top-3 left-6 rounded-full bg-gold px-3 py-0.5 text-xs font-semibold text-brand-950">Most popular</span>}
              <h3 className="font-display text-lg font-semibold">{p.name}</h3>
              <p className="mt-1 min-h-10 text-sm text-muted-foreground">{p.description}</p>
              <p className="mt-4 font-display text-4xl font-semibold tabular-nums tracking-tight">
                {p.priceCents === 0 ? "Free" : formatCents(p.priceCents)}
                {p.priceCents > 0 && <span className="text-sm font-normal text-muted-foreground"> / month</span>}
              </p>
              {p.trialDays > 0 && <p className="text-xs font-medium text-brand-700">{p.trialDays}-day free trial</p>}
              <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand-600" />{f}</li>
                ))}
              </ul>
              <Button asChild size="lg" className="mt-6" variant={featured ? "default" : "outline"}>
                <Link href="/signup">Start free</Link>
              </Button>
            </div>
          );
        })}
      </div>
      {compare && (
        <>
          <p className="mt-8 rounded-xl border bg-brand-50 p-4 text-sm text-brand-900">
            {trial ? <><strong>{trial.trialDays}-day free trial</strong>, and no bank card is needed. </> : null}
            You can pay by <strong>EVC Plus</strong> or <strong>Zaad</strong>. Payment instructions are inside the app.
          </p>
          <h2 className="mt-12 font-display text-2xl font-semibold tracking-tight">Compare plans</h2>
          <div className="mt-4 overflow-x-auto rounded-2xl border bg-card shadow-card">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-3"><span className="sr-only">Feature</span></th>
                  {plans.map((p) => <th key={p._id} className="p-3 font-display font-semibold">{p.name}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y">
                <Row label="Price per month" cells={plans.map((p) => (p.priceCents === 0 ? "Free" : formatCents(p.priceCents)))} />
                <Row label="Users" cells={plans.map((p) => limit(p.maxUsers))} />
                <Row label="Products" cells={plans.map((p) => limit(p.maxProducts))} />
                <Row label="Modules" cells={plans.map((p) => p.modules.map((m) => MODULE_LABELS[m] ?? m).join(", "))} />
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Row({ label, cells }: { label: string; cells: string[] }) {
  return (
    <tr>
      <th scope="row" className="p-3 text-left font-medium text-muted-foreground">{label}</th>
      {cells.map((c, i) => <td key={i} className="p-3 align-top tabular-nums">{c}</td>)}
    </tr>
  );
}
