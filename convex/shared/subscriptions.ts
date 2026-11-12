export type BillingPeriod = "monthly" | "yearly";

export const planPriceCents = (plan: { priceCents: number; yearlyPriceCents?: number }, period: BillingPeriod) =>
  period === "yearly" ? plan.yearlyPriceCents ?? plan.priceCents * 12 : plan.priceCents;

/** Calendar renewal, clamping Jan 31 / leap-day renewals to the target month's last day. */
export function extendSubscription(start: number, period: BillingPeriod): number {
  const date = new Date(start);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + (period === "yearly" ? 12 : 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.getTime();
}
