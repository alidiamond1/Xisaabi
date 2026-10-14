import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Check } from "lucide-react";
import { CtaBand, IconTile, MarketingShell, Section } from "@/components/marketing/shell";
import { PaymentBadges } from "@/components/marketing/payment-badges";
import { Button } from "@/components/ui/button";
import { BIZ, FAQ, KEY_FEATURES, STEPS } from "@/lib/marketing";

// Static page. Logged-in users also see it (no redirect today); they reach the app via "Log in" / /apps.

const BIZ_TEASER = ["pharmacy", "electronics", "grocery", "clothing", "cosmetics", "hardware", "auto_parts", "restaurant"];

export default function Home() {
  return (
    <MarketingShell>
      <section className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(60rem_26rem_at_80%_-10%,var(--color-brand-100),transparent),radial-gradient(40rem_20rem_at_0%_0%,oklch(0.95_0.06_85/0.6),transparent)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-10 sm:px-6 sm:py-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-semibold text-brand-800 shadow-card">
              <span className="size-1.5 rounded-full bg-gold" />Made for shops in Somalia
            </span>
            <h1 className="mt-5 font-display text-[2.4rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Run your shop <span className="text-brand-700">from your phone.</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg text-muted-foreground">
              Sales, stock, customer credit, expenses and profit in one simple app. It works on any smartphone, even without internet.
            </p>
            <div className="mt-7 flex flex-col gap-3 min-[420px]:flex-row">
              <Button asChild size="xl"><Link href="/signup">Start free <ArrowRight /></Link></Button>
              <Button asChild size="xl" variant="outline"><Link href="/how-it-works">How it works</Link></Button>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
              {["No card needed", "Pay by EVC Plus or Zaad", "Cancel anytime"].map((t) => <li key={t} className="flex items-center gap-1.5"><Check className="size-4 text-brand-600" />{t}</li>)}
            </ul>
          </div>
          <div className="relative mx-auto w-full max-w-md">
            <div aria-hidden className="absolute -inset-3 -rotate-2 rounded-[2rem] bg-brand-100/70" />
            <Image
              src="/marketing/shopkeeper.png" alt="A shopkeeper managing her shop on a smartphone" width={1254} height={1254} priority
              sizes="(min-width: 448px) 448px, 100vw"
              className="relative aspect-square w-full rounded-2xl object-cover shadow-pop"
            />
          </div>
        </div>
      </section>

      <section className="border-y bg-card">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-5 sm:px-6">
          <PaymentBadges />
          <p className="text-sm font-semibold text-muted-foreground">Takes every payment. Works offline too.</p>
        </div>
      </section>

      <Section>
        <h2 className="max-w-xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">Everything your shop needs</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {KEY_FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border bg-card p-5 shadow-card">
              <IconTile icon={f.icon} />
              <h3 className="mt-4 font-display text-lg font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
        <Link href="/features" className="mt-6 inline-flex min-h-11 items-center gap-1 font-semibold text-brand-700 hover:underline">See all features <ArrowRight className="size-4" /></Link>
      </Section>

      <Section tint>
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Up and running in one day</h2>
        <ol className="mt-8 grid gap-6 md:grid-cols-3">
          {STEPS.filter((_, i) => [0, 2, 3].includes(i)).map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-600 font-display text-lg font-semibold text-white">{i + 1}</span>
              <div><h3 className="font-display text-lg font-semibold">{s.title}</h3><p className="mt-1 text-sm text-muted-foreground">{s.text}</p></div>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <h2 className="max-w-xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">Built for your kind of shop</h2>
        <p className="mt-2 max-w-xl text-muted-foreground">Pick your business type and the app sets itself up for you.</p>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {BIZ_TEASER.map((k) => (
            <li key={k} className="rounded-xl border bg-card p-4 text-sm font-semibold shadow-card">{BIZ[k].label}</li>
          ))}
        </ul>
        <Link href="/business-types" className="mt-6 inline-flex min-h-11 items-center gap-1 font-semibold text-brand-700 hover:underline">All business types <ArrowRight className="size-4" /></Link>
      </Section>

      <Section tint>
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Simple pricing</h2>
            <p className="mt-2 max-w-xl text-muted-foreground">Start with a free trial. Pay by EVC Plus or Zaad.</p>
          </div>
          <Button asChild size="lg" variant="outline"><Link href="/pricing">See pricing <ArrowRight /></Link></Button>
        </div>
      </Section>

      <Section>
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Common questions</h2>
        <div className="mt-6 divide-y rounded-2xl border bg-card shadow-card">
          {FAQ.slice(0, 3).map((f) => (
            <div key={f.q} className="p-5"><h3 className="font-semibold">{f.q}</h3><p className="mt-1 text-sm text-muted-foreground">{f.a}</p></div>
          ))}
        </div>
        <Link href="/faq" className="mt-6 inline-flex min-h-11 items-center gap-1 font-semibold text-brand-700 hover:underline">All questions <ArrowRight className="size-4" /></Link>
      </Section>

      <CtaBand />
    </MarketingShell>
  );
}
