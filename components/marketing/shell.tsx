import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BrandMark, Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { FooterContact } from "@/components/marketing/contact";
import { MobileNav } from "@/components/marketing/mobile-nav";
import { NAV } from "@/lib/marketing";

/** Shared header + footer for every public marketing page. Server component; only the menu sheet and contact links are client islands. */
export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-clip">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
          <Link href="/" className="flex min-h-11 items-center gap-2"><BrandMark className="size-9" /><Wordmark className="text-xl" /></Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground lg:flex">
            {NAV.map((n) => <Link key={n.href} href={n.href} className="hover:text-foreground">{n.label}</Link>)}
          </nav>
          <div className="flex items-center gap-1 sm:gap-2">
            <Button asChild variant="ghost" size="lg"><Link href="/login">Log in</Link></Button>
            <Button asChild size="lg" className="hidden sm:inline-flex"><Link href="/signup">Start free</Link></Button>
            <MobileNav />
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="bg-brand-950 text-brand-100">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Link href="/" className="flex items-center gap-2"><BrandMark className="size-9" /><Wordmark dark className="text-xl text-white" /></Link>
            <p className="mt-3 max-w-xs text-sm text-brand-200">Xisaab sax ah, ganacsi fudud. Simple, correct bookkeeping for your shop, on your phone.</p>
          </div>
          <nav>
            <h2 className="font-display text-sm font-semibold text-white">Pages</h2>
            <ul className="mt-2">
              {NAV.map((n) => <li key={n.href}><Link href={n.href} className="flex min-h-11 items-center text-sm hover:text-white">{n.label}</Link></li>)}
              <li><Link href="/login" className="flex min-h-11 items-center text-sm hover:text-white">Log in</Link></li>
            </ul>
          </nav>
          <div>
            <h2 className="font-display text-sm font-semibold text-white">Contact us</h2>
            <div className="mt-2"><FooterContact /></div>
            <Button asChild variant="secondary" size="lg" className="mt-3"><Link href="/signup">Start free <ArrowRight /></Link></Button>
          </div>
        </div>
        <p className="border-t border-white/10 py-5 text-center text-xs text-brand-200">&copy; {new Date().getFullYear()} XisabSax. All rights reserved.</p>
      </footer>
    </div>
  );
}

/** Page title band used at the top of inner pages. */
export function PageHero({ title, text }: { title: string; text: string }) {
  return (
    <section className="relative border-b bg-[radial-gradient(50rem_20rem_at_80%_-20%,var(--color-brand-100),transparent)]">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="max-w-2xl font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">{title}</h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{text}</p>
      </div>
    </section>
  );
}

export function Section({ children, className, tint }: { children: React.ReactNode; className?: string; tint?: boolean }) {
  return (
    <section className={tint ? "border-y bg-card" : ""}>
      <div className={`mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 ${className ?? ""}`}>{children}</div>
    </section>
  );
}

export function CtaBand({ title = "Ready to know your numbers?", text = "Set up your shop in two minutes." }: { title?: string; text?: string }) {
  return (
    <section className="px-4 py-12 sm:px-6 sm:py-16">
      <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 to-brand-950 px-6 py-12 text-center text-white">
        <span aria-hidden className="absolute -right-10 -top-16 size-56 rounded-full bg-gold/20" />
        <h2 className="relative font-display text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
        <p className="relative mt-2 text-brand-100">{text}</p>
        <Button asChild size="xl" variant="secondary" className="relative mt-7"><Link href="/signup">Start free</Link></Button>
      </div>
    </section>
  );
}

export function IconTile({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  return <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100"><Icon className="size-5" /></span>;
}
