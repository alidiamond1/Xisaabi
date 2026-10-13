"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { Check } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/convex/shared/money";
import { cn } from "@/lib/utils";

export function Pricing() {
  const plans = useQuery(api.plans.publicList);
  if (plans === undefined) {
    return <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-80 rounded-2xl" />)}</div>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-3">
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
              <Link href="/signup">Start free trial</Link>
            </Button>
          </div>
        );
      })}
    </div>
  );
}
