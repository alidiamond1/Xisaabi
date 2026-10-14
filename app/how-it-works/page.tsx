import type { Metadata } from "next";
import { Smartphone, Wifi } from "lucide-react";
import { CtaBand, IconTile, MarketingShell, PageHero, Section } from "@/components/marketing/shell";
import { STEPS } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "How it works",
  description: "Five steps: sign up, choose your business type, add products, start selling, close your shift. All you need is a smartphone.",
  alternates: { canonical: "/how-it-works" },
};

export default function HowItWorks() {
  return (
    <MarketingShell>
      <PageHero title="Five steps and your shop is ready" text="You do not need a computer or special equipment. Your phone is enough." />
      <Section>
        <ol className="space-y-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4 rounded-2xl border bg-card p-5 shadow-card">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-600 font-display text-xl font-semibold text-white">{i + 1}</span>
              <div><h2 className="font-display text-xl font-semibold">{s.title}</h2><p className="mt-1 text-muted-foreground">{s.text}</p></div>
            </li>
          ))}
        </ol>
      </Section>
      <Section tint>
        <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">What you need</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="flex gap-3 rounded-2xl border bg-background p-5"><IconTile icon={Smartphone} /><div><h3 className="font-semibold">A smartphone</h3><p className="text-sm text-muted-foreground">Chrome or Safari is enough. Nothing to download from an app store.</p></div></div>
          <div className="flex gap-3 rounded-2xl border bg-background p-5"><IconTile icon={Wifi} /><div><h3 className="font-semibold">Internet, some of the time</h3><p className="text-sm text-muted-foreground">Needed to sign up and to sync. Selling works offline too.</p></div></div>
        </div>
      </Section>
      <CtaBand />
    </MarketingShell>
  );
}
