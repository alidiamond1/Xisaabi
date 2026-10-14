"use client";
import { useQuery } from "convex/react";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { waLink } from "@/lib/whatsapp";

/** Public support contacts from platformSettings. Each link renders only when that field is set. */
export function useContacts() {
  const s = useQuery(api.platformSettings.get);
  return {
    loading: s === undefined,
    whatsapp: s?.supportWhatsApp ? { label: s.supportWhatsApp, href: waLink(s.supportWhatsApp, "Hello XisabSax, ") } : null,
    phone: s?.supportPhone ? { label: s.supportPhone, href: `tel:${s.supportPhone.replace(/[^\d+]/g, "")}` } : null,
    email: s?.supportEmail ? { label: s.supportEmail, href: `mailto:${s.supportEmail}` } : null,
  };
}

export function FooterContact() {
  const c = useContacts();
  const items = [
    c.whatsapp && { ...c.whatsapp, icon: MessageCircle, name: "WhatsApp" },
    c.phone && { ...c.phone, icon: Phone, name: "Phone" },
    c.email && { ...c.email, icon: Mail, name: "Email" },
  ].filter(Boolean) as { label: string; href: string; icon: typeof Mail; name: string }[];
  if (!items.length) return null;
  return (
    <ul className="space-y-1">
      {items.map((i) => (
        <li key={i.name}>
          <a href={i.href} className="flex min-h-11 items-center gap-2 text-sm text-brand-100 hover:text-white">
            <i.icon className="size-4 shrink-0" /><span className="break-all">{i.label}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ContactCards() {
  const c = useContacts();
  const items = [
    c.whatsapp && { ...c.whatsapp, icon: MessageCircle, name: "WhatsApp", cta: "Send a message" },
    c.phone && { ...c.phone, icon: Phone, name: "Phone", cta: "Call us" },
    c.email && { ...c.email, icon: Mail, name: "Email", cta: "Send an email" },
  ].filter(Boolean) as { label: string; href: string; icon: typeof Mail; name: string; cta: string }[];
  if (c.loading) return <div className="h-32 animate-pulse rounded-2xl bg-muted" />;
  if (!items.length) return <p className="rounded-2xl border bg-card p-6 text-muted-foreground">Contact details are not available yet. Please check back soon.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {items.map((i) => (
        <a key={i.name} href={i.href} className="flex flex-col gap-1 rounded-2xl border bg-card p-5 shadow-card transition-colors hover:border-brand-300">
          <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100"><i.icon className="size-5" /></span>
          <span className="mt-2 font-display text-lg font-semibold">{i.name}</span>
          <span className="break-all text-sm text-muted-foreground">{i.label}</span>
          <span className="mt-1 text-sm font-semibold text-brand-700">{i.cta} &rarr;</span>
        </a>
      ))}
    </div>
  );
}
