import type { Metadata } from "next";
import { CtaBand, MarketingShell, PageHero, Section } from "@/components/marketing/shell";
import { FEATURE_LABELS, PRESETS } from "@/convex/shared/presets";
import { BIZ } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "Business types",
  description: "Pharmacy, electronics, grocery, clothing, cosmetics, hardware, auto parts and more: XisabSax adjusts to your type of shop.",
  alternates: { canonical: "/business-types" },
};

export default function Businesses() {
  return (
    <MarketingShell>
      <PageHero title="Made for your kind of shop" text="Choose your business type when you start. The app shows only the tools you need, and you can change them any time." />
      <Section>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PRESETS.map((p) => (
            <li key={p.key} className="flex flex-col rounded-2xl border bg-card p-5 shadow-card">
              <h2 className="font-display text-lg font-semibold">{BIZ[p.key]?.label ?? p.label}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{BIZ[p.key]?.text ?? p.description}</p>
              <ul className="mt-4 flex flex-wrap gap-1.5">
                {p.features.map((f) => (
                  <li key={f} title={FEATURE_LABELS[f].hint} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 ring-1 ring-brand-100">{FEATURE_LABELS[f].label}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-muted-foreground">Not on the list? Choose &ldquo;General shop&rdquo; and turn features on or off in Settings.</p>
      </Section>
      <CtaBand />
    </MarketingShell>
  );
}
