"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Banner, Field, FormSection, ListSkeleton, PageHeader, Panel, SubmitButton } from "@/components/common";
import { usePlatform } from "@/components/guard";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { act } from "@/lib/run";

export default function PlatformSettingsPage() {
  const router = useRouter();
  const sup = usePlatform().member.role === "SUPER_ADMIN";
  useEffect(() => { if (!sup) router.replace("/platform"); }, [sup, router]);
  const cur = useQuery(api.platformSettings.get);
  if (!sup) return null;
  return (
    <>
      <PageHeader title="Settings" desc="Contact details businesses see, and whether new shops can sign up." />
      {!cur ? <Panel><ListSkeleton rows={4} /></Panel> : <Form key={JSON.stringify(cur)} cur={cur} />}
    </>
  );
}

function Form({ cur }: { cur: NonNullable<ReturnType<typeof useQuery<typeof api.platformSettings.get>>> }) {
  const save = useMutation(api.platformSettings.update);
  const [f, setF] = useState(cur);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  return (
    <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); await act(save(f), "Settings saved"); setBusy(false); }}>
      <Panel className="p-5">
        <FormSection title="Payment instructions" desc="Shown on every business's Billing page.">
          <Field label="How to pay"><Textarea rows={4} value={f.paymentInstructions} onChange={(e) => set("paymentInstructions", e.target.value)} maxLength={2000} /></Field>
        </FormSection>
        <FormSection title="Support contact" desc="Shown on the business Support page.">
          <Field label="Phone"><Input inputMode="tel" value={f.supportPhone} onChange={(e) => set("supportPhone", e.target.value)} maxLength={50} /></Field>
          <Field label="WhatsApp"><Input inputMode="tel" value={f.supportWhatsApp} onChange={(e) => set("supportWhatsApp", e.target.value)} maxLength={50} /></Field>
          <Field label="Email"><Input type="email" value={f.supportEmail} onChange={(e) => set("supportEmail", e.target.value)} maxLength={100} /></Field>
        </FormSection>
        <FormSection title="Signups" desc="Closing signups stops new shops from being created. Existing businesses are not affected.">
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium"><Switch checked={f.signupsOpen} onCheckedChange={(v) => set("signupsOpen", v)} />New signups are {f.signupsOpen ? "open" : "closed"}</label>
          {!f.signupsOpen && <Banner tone="warning">New people will see: &ldquo;New signups are closed right now.&rdquo;</Banner>}
        </FormSection>
        <div className="pt-4"><SubmitButton type="submit" busy={busy}>Save settings</SubmitButton></div>
      </Panel>
    </form>
  );
}
