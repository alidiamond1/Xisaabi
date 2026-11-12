"use client";
import { Button } from "@/components/ui/button";
import type { BillingPeriod } from "@/convex/shared/subscriptions";

export function PeriodSelector({ value, onChange, disabled }: {
  value: BillingPeriod; onChange: (value: BillingPeriod) => void; disabled?: boolean;
}) {
  return <fieldset className="flex flex-wrap gap-2" disabled={disabled}>
    <legend className="sr-only">Billing period</legend>
    <Button type="button" size="lg" variant={value === "monthly" ? "default" : "outline"} aria-pressed={value === "monthly"} onClick={() => onChange("monthly")}>Monthly</Button>
    <Button type="button" size="lg" variant={value === "yearly" ? "default" : "outline"} aria-pressed={value === "yearly"} onClick={() => onChange("yearly")}>Yearly</Button>
  </fieldset>;
}
