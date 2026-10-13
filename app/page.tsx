import Link from "next/link";
import { ArrowRight, BarChart3, Check, ShieldCheck, Smartphone, WifiOff } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Pricing } from "@/components/landing-pricing";
import { Button } from "@/components/ui/button";
import { BUSINESS_APPS } from "@/lib/apps";
import { cn } from "@/lib/utils";

const MODULES = BUSINESS_APPS.filter((a) => !["settings", "billing", "support"].includes(a.key));

const HIGHLIGHTS = [
  { icon: WifiOff, title: "Sells offline", text: "Internet down? Keep selling. Every sale syncs the moment you are back online." },
  { icon: Smartphone, title: "Mobile money ready", text: "Take cash, EVC or Zaad, or put it on a customer's credit tab. Nothing gets forgotten." },
  { icon: ShieldCheck, title: "Right access for every person", text: "Owners, managers and cashiers each see only what they need." },
];

const STEPS = [
  { n: "1", title: "Create your shop", text: "Sign up and add your name, currency and logo. Two minutes." },
  { n: "2", title: "Add your products", text: "Type them in or scan barcodes. Set prices, stock and expiry dates." },
  { n: "3", title: "Start selling", text: "Open the register on any phone or tablet. See your profit every evening." },
];

/** Static preview of the POS, drawn in CSS so it costs no image bytes. */
function PosPreview() {
  const items = [["Rice 25kg", "2", "$44.00"], ["Sugar 1kg", "3", "$4.50"], ["Cooking oil 3L", "1", "$7.20"]];
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-md">
      <div className="absolute -inset-3 -rotate-2 rounded-[2rem] bg-brand-100/70" />
      <div className="relative overflow-hidden rounded-2xl border bg-card shadow-pop">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="font-display text-sm font-semibold">Point of Sale</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success"><span className="size-1.5 rounded-full bg-success" />Online</span>
        </div>
        <div className="grid grid-cols-3 gap-2 border-b bg-muted/50 p-3">
          {["Rice", "Sugar", "Oil", "Milk", "Tea", "Flour"].map((n, i) => (
            <div key={n} className={cn("rounded-lg border bg-card px-2.5 py-2", i === 0 && "border-brand-600 ring-1 ring-brand-600")}>
              <p className="text-xs font-medium">{n}</p><p className="font-display text-sm font-semibold tabular-nums text-brand-700">${(2 + i * 1.7).toFixed(2)}</p>
            </div>
          ))}
        </div>
        <ul className="divide-y px-4">
          {items.map(([n, q, t]) => (
            <li key={n} className="flex items-center justify-between py-2.5 text-sm"><span>{n} <span className="text-muted-foreground">x{q}</span></span><span className="font-medium tabular-nums">{t}</span></li>
          ))}
        </ul>
        <div className="space-y-3 border-t p-4">
          <div className="flex items-baseline justify-between"><span className="text-sm text-muted-foreground">Total</span><span className="font-display text-3xl font-semibold tabular-nums tracking-tight">$55.70</span></div>
          <div className="grid h-12 place-items-center rounded-xl bg-brand-600 font-display font-semibold text-white">Pay $55.70</div>
        </div>
      </div>
      <div className="absolute -bottom-5 -left-3 flex items-center gap-2.5 rounded-xl border bg-card px-3.5 py-2.5 shadow-pop sm:-left-8">
        <span className="grid size-8 place-items-center rounded-lg bg-gold/25 text-brand-900"><BarChart3 className="size-4" /></span>
        <div><p className="text-xs text-muted-foreground">Today&apos;s profit</p><p className="font-display text-sm font-semibold tabular-nums text-success">+$182.40</p></div>
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="overflow-x-clip">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5"><BrandMark className="size-9" /><span className="font-display text-xl font-semibold tracking-tight">Dukaan</span></Link>
          <nav className="hidden gap-7 text-sm font-medium text-muted-foreground sm:flex">
            <a href="#modules" className="hover:text-foreground">Modules</a>
            <a href="#how" className="hover:text-foreground">How it works</a>
            <a href="#pricing" className="hover:text-foreground">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost"><Link href="/login">Log in</Link></Button>
            <Button asChild className="hidden min-[400px]:inline-flex"><Link href="/signup">Start free trial</Link></Button>
          </div>
        </div>
      </header>

      <section className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(60rem_26rem_at_80%_-10%,var(--color-brand-100),transparent),radial-gradient(40rem_20rem_at_0%_0%,oklch(0.95_0.06_85/0.6),transparent)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-semibold text-brand-800 shadow-card">
              <span className="size-1.5 rounded-full bg-gold" />Made for shops in Somalia
            </span>
            <h1 className="mt-5 font-display text-[2.6rem] font-semibold leading-[1.02] tracking-tight sm:text-6xl">
              Know your money.<br />Run your shop <span className="relative whitespace-nowrap text-brand-700">with calm<span aria-hidden className="absolute inset-x-0 -bottom-1 h-2 rounded-full bg-gold/60 -z-10" /></span>.
            </h1>
            <p className="mt-5 max-w-lg text-lg text-muted-foreground">
              Sales, stock, customer credit, expiry dates and profit in one simple app. Works on any phone, tablet or computer, even without internet.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="xl"><Link href="/signup">Start free trial <ArrowRight /></Link></Button>
              <Button asChild size="xl" variant="outline"><Link href="/login">Log in</Link></Button>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
              {["No card needed", "Pay by EVC or Zaad", "Cancel anytime"].map((t) => <li key={t} className="flex items-center gap-1.5"><Check className="size-4 text-brand-600" />{t}</li>)}
            </ul>
          </div>
          <PosPreview />
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-10 sm:px-6 md:grid-cols-3">
        {HIGHLIGHTS.map((h) => (
          <div key={h.title} className="rounded-2xl border bg-card p-6 shadow-card">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100"><h.icon className="size-5" /></span>
            <h3 className="mt-4 font-display text-lg font-semibold">{h.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{h.text}</p>
          </div>
        ))}
      </section>

      <section id="modules" className="scroll-mt-16 border-y bg-card py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="max-w-xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">One launcher, every tool your shop needs</h2>
          <p className="mt-2 max-w-xl text-muted-foreground">Open only the modules you use. Add more as your business grows.</p>
          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {MODULES.map((m) => (
              <div key={m.key} className="rounded-xl border bg-background p-4 transition-colors hover:border-brand-300">
                <span className={cn("grid size-11 place-items-center rounded-xl", m.tile)}><m.icon className="size-5" /></span>
                <p className="mt-3 font-semibold">{m.name}</p>
                <p className="text-sm text-muted-foreground">{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-16 sm:px-6 sm:py-20">
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Up and running before lunch</h2>
        <ol className="mt-10 grid gap-6 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="flex gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-600 font-display text-lg font-semibold text-white">{s.n}</span>
              <div><h3 className="font-display text-lg font-semibold">{s.title}</h3><p className="mt-1 text-sm text-muted-foreground">{s.text}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section id="pricing" className="scroll-mt-16 border-t bg-card py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-center font-display text-3xl font-semibold tracking-tight sm:text-4xl">Simple pricing</h2>
          <p className="mx-auto mb-12 mt-2 max-w-xl text-center text-muted-foreground">Pay by EVC or Zaad. Cancel anytime.</p>
          <Pricing />
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6">
        <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 to-brand-950 px-6 py-14 text-center text-white">
          <span aria-hidden className="absolute -right-10 -top-16 size-56 rounded-full bg-gold/20" />
          <h2 className="relative font-display text-3xl font-semibold tracking-tight sm:text-4xl">Ready to know your numbers?</h2>
          <p className="relative mt-2 text-brand-100">Set up your shop in two minutes.</p>
          <Button asChild size="xl" variant="secondary" className="relative mt-7"><Link href="/signup">Start free trial</Link></Button>
        </div>
      </section>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        <p>Dukaan. Business software for small shops.</p>
        <p className="mt-1"><Link href="/login" className="hover:underline">Log in</Link> · <Link href="/signup" className="hover:underline">Sign up</Link></p>
      </footer>
    </div>
  );
}
