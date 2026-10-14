import type { Metadata } from "next";
import { Check } from "lucide-react";
import { CtaBand, IconTile, MarketingShell, PageHero, Section } from "@/components/marketing/shell";
import { PaymentBadges } from "@/components/marketing/payment-badges";
import { MODULES } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Features",
  description: "Point of sale, inventory, customer credit, shifts, expenses, reports and staff permissions: everything XisabSax does for your shop.",
  alternates: { canonical: "/features" },
};

export default function Features() {
  return (
    <MarketingShell>
      <PageHero title="Everything XisabSax does for your shop" text="Every part is built for small shops. From the first sale to the evening profit." />
      <Section className="grid gap-4 md:grid-cols-2">
        {MODULES.map((m) => (
          <article key={m.title} className="rounded-2xl border bg-card p-5 shadow-card sm:p-6">
            <div className="flex items-center gap-3">
              <IconTile icon={m.icon} />
              <div><h2 className="font-display text-xl font-semibold">{m.title}</h2><p className="text-sm text-muted-foreground">{m.text}</p></div>
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              {m.points?.map((p) => <li key={p} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand-600" />{p}</li>)}
            </ul>
          </article>
        ))}
      </Section>
      <Section tint>
        <h2 className="text-center font-display text-2xl font-semibold tracking-tight">Record every way your customers pay</h2>
        <PaymentBadges className="mt-5" />
        <p className="mx-auto mt-4 max-w-xl text-center text-sm text-muted-foreground">Shifts reconcile each method separately. Mobile money is recorded by your cashier; XisabSax does not move the money.</p>
      </Section>
      <CtaBand />
    </MarketingShell>
  );
}
