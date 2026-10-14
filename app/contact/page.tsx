import type { Metadata } from "next";
import { ContactCards } from "@/components/marketing/contact";
import { MarketingShell, PageHero, Section } from "@/components/marketing/shell";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact the XisabSax team by WhatsApp, phone or email.",
  alternates: { canonical: "/contact" },
};

export default function Contact() {
  return (
    <MarketingShell>
      <PageHero title="Contact us" text="Need help or have a question? We are happy to help." />
      <Section>
        <ContactCards />
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border bg-card p-5"><h2 className="font-display text-lg font-semibold">Support hours</h2><p className="mt-1 text-sm text-muted-foreground">We answer messages and calls as quickly as we can during working hours.</p></div>
          <div className="rounded-2xl border bg-card p-5"><h2 className="font-display text-lg font-semibold">Already have an account?</h2><p className="mt-1 text-sm text-muted-foreground">Open <strong>Support</strong> inside the app to send a request. Our team replies there.</p></div>
        </div>
      </Section>
    </MarketingShell>
  );
}
