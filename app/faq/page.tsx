import type { Metadata } from "next";
import { ChevronDown } from "lucide-react";
import { CtaBand, MarketingShell, PageHero, Section } from "@/components/marketing/shell";
import { FAQ } from "@/lib/marketing";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Answers about data safety, working offline, barcodes, EVC Plus payments, subscriptions and support.",
  alternates: { canonical: "/faq" },
};

export default function FaqPage() {
  const ld = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) };
  return (
    <MarketingShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <PageHero title="Frequently asked questions" text="Short, simple answers. Still have a question? Contact us." />
      <Section className="max-w-3xl">
        <div className="divide-y rounded-2xl border bg-card shadow-card">
          {FAQ.map((f) => (
            <details key={f.q} className="group">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 p-4 font-semibold [&::-webkit-details-marker]:hidden">
                {f.q}<ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <p className="px-4 pb-4 text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>
      <CtaBand />
    </MarketingShell>
  );
}
