import type { Metadata } from "next";
import { CtaBand, MarketingShell, PageHero, Section } from "@/components/marketing/shell";
import { PaymentBadges } from "@/components/marketing/payment-badges";
import { Pricing } from "@/components/landing-pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description: "XisabSax plans and prices. Start with a free trial and pay by EVC Plus or Zaad.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <MarketingShell>
      <PageHero title="Simple pricing, nothing hidden" text="Pick the plan that fits your shop. Start with a free trial and cancel any time." />
      <Section><Pricing compare /><PaymentBadges className="mt-10" /></Section>
      <CtaBand />
    </MarketingShell>
  );
}
