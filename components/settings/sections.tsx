"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { BusinessFields, type Profile } from "@/components/business-fields";
import { Field, Panel, SubmitButton } from "@/components/common";
import { MoneyInput } from "@/components/inventory/bits";
import { LogoUpload } from "@/components/logo-upload";
import { METHOD_LABEL, PAID_VIA, type Method } from "@/components/reports/bits";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parseToCents } from "@/convex/shared/money";
import { act } from "@/lib/run";
import { ChipEditor, SettingsCard, SwitchRow, useSaveSettings, type Biz } from "./parts";

export function ProfileSection({ biz, logoUrl }: { biz: Biz; logoUrl: string | null }) {
  const update = useMutation(api.settings.updateProfile);
  const [p, setP] = useState<Profile>({
    name: biz.name, businessType: biz.businessType, phone: biz.phone, email: biz.email ?? "",
    address: biz.address, city: biz.city, country: biz.country, currency: biz.currency,
  });
  const [logoId, setLogoId] = useState<Id<"_storage"> | undefined>();
  const [preview, setPreview] = useState<string | null>(logoUrl);
  const [busy, setBusy] = useState(false);
  return (
    <Panel className="max-w-2xl p-5">
      <form className="space-y-5" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await act(update({ ...p, email: p.email.trim() || undefined, logoId: logoId ?? biz.logoId }), "Business profile saved");
        setBusy(false);
      }}>
        <div><h2 className="font-display text-lg font-semibold">Business profile</h2><p className="mt-0.5 text-sm text-muted-foreground">Shown on receipts, invoices and your sign-in.</p></div>
        <LogoUpload generateUrl={api.settings.generateUploadUrl} preview={preview} onUploaded={(id, url) => { setLogoId(id); setPreview(url); }} />
        <BusinessFields value={p} onChange={setP} />
        <SubmitButton type="submit" busy={busy}>Save changes</SubmitButton>
      </form>
    </Panel>
  );
}

export function ReceiptSection({ biz }: { biz: Biz }) {
  const save = useSaveSettings(biz);
  const [header, setHeader] = useState(biz.settings.receiptHeader ?? "");
  const [footer, setFooter] = useState(biz.settings.receiptFooter ?? "");
  return (
    <SettingsCard title="Receipt" desc="Text printed on every customer receipt." onSave={() => save({ receiptHeader: header.trim(), receiptFooter: footer.trim() }, "Receipt saved")}>
      <Field label="Header" hint="Printed under the business name, e.g. your phone number or slogan."><Textarea rows={2} value={header} onChange={(e) => setHeader(e.target.value)} maxLength={300} /></Field>
      <Field label="Footer" hint="Printed at the bottom."><Textarea rows={2} value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={300} placeholder="Thank you for shopping with us!" /></Field>
      <div className="rounded-xl border border-dashed bg-muted/40 p-4 text-center text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">{biz.name}</p>
        {header && <p className="whitespace-pre-line">{header}</p>}
        <p className="my-2">- - - items - - -</p>
        <p className="whitespace-pre-line">{footer || "Thank you for shopping with us!"}</p>
      </div>
    </SettingsCard>
  );
}

const METHOD_DESC: Record<Method, string> = {
  CASH: "Always on.", EVC: "Hormuud EVC Plus mobile money.", ZAAD: "Telesom Zaad mobile money.", EDAHAB: "Somtel eDahab mobile money.",
  BANK: "Bank transfer or card.", CREDIT: "Sell now, customer pays later (needs a customer).",
};

export function PaymentsSection({ biz }: { biz: Biz }) {
  const save = useSaveSettings(biz);
  const [on, setOn] = useState<Method[]>(biz.settings.paymentMethods);
  const toggle = (m: Method, v: boolean) => setOn(v ? [...on, m] : on.filter((x) => x !== m));
  return (
    <SettingsCard title="Payment methods" desc="Choose what customers can pay with at the register." onSave={() => save({ paymentMethods: ["CASH", ...on.filter((m) => m !== "CASH")] }, "Payment methods saved")}>
      <div className="space-y-2">
        <SwitchRow title={METHOD_LABEL.CASH} desc={METHOD_DESC.CASH} checked disabled />
        {[...PAID_VIA.filter((m) => m !== "CASH"), "CREDIT" as const].map((m) => (
          <SwitchRow key={m} title={METHOD_LABEL[m]} desc={METHOD_DESC[m]} checked={on.includes(m)} onChange={(v) => toggle(m, v)} />
        ))}
      </div>
    </SettingsCard>
  );
}

export function SalesRulesSection({ biz }: { biz: Biz }) {
  const save = useSaveSettings(biz);
  const s = biz.settings;
  const [tax, setTax] = useState(String(s.taxRatePercent));
  const [maxDisc, setMaxDisc] = useState(String(s.maxCashierDiscountPercent));
  const [presets, setPresets] = useState(s.discountPresets.map(String));
  const [neg, setNeg] = useState(s.allowNegativeStock);
  const taxN = Number(tax), discN = Number(maxDisc);
  const valid = tax !== "" && taxN >= 0 && taxN <= 100 && maxDisc !== "" && discN >= 0 && discN <= 100;
  return (
    <SettingsCard title="Sales rules" desc="Tax, discounts and stock rules at the register." disabled={!valid}
      onSave={() => save({ taxRatePercent: taxN, maxCashierDiscountPercent: discN, discountPresets: presets.map(Number), allowNegativeStock: neg })}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tax rate (%)" hint="0 means no tax is added." error={tax !== "" && (taxN < 0 || taxN > 100 || Number.isNaN(taxN)) ? "Enter 0 to 100." : undefined}>
          <Input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />
        </Field>
        <Field label="Biggest discount a cashier can give (%)" hint="Managers and the owner are not limited." error={maxDisc !== "" && (discN < 0 || discN > 100 || Number.isNaN(discN)) ? "Enter 0 to 100." : undefined}>
          <Input inputMode="decimal" value={maxDisc} onChange={(e) => setMaxDisc(e.target.value)} />
        </Field>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Quick discount buttons</p>
        <p className="text-xs text-muted-foreground">One-tap percentages at the register. Up to 6, each from 1 to 100.</p>
        <ChipEditor label="discount" items={presets} onChange={setPresets} max={6} suffix="%" placeholder="e.g. 10"
          validate={(v) => /^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= 100} />
      </div>
      <SwitchRow title="Allow selling below zero stock" desc="Keeps offline sales from being rejected when stock counts are out of date." checked={neg} onChange={setNeg} />
    </SettingsCard>
  );
}

export function CreditSection({ biz }: { biz: Biz }) {
  const save = useSaveSettings(biz);
  const [limit, setLimit] = useState((biz.settings.defaultCreditLimitCents / 100).toFixed(2));
  const cents = parseToCents(limit);
  return (
    <SettingsCard title="Customer credit" desc="Used when you add a new customer. You can change it for each customer later." disabled={cents === null}
      onSave={() => save({ defaultCreditLimitCents: cents! })}>
      <Field label="Default credit limit" hint="The most a new customer can owe you. 0 means no credit until you give them a limit." error={cents === null ? "Enter an amount like 50 or 50.00." : undefined}>
        <MoneyInput cur={biz.currency} value={limit} onChange={setLimit} className="max-w-48" />
      </Field>
    </SettingsCard>
  );
}

export function ExpenseCategoriesSection({ biz }: { biz: Biz }) {
  const save = useSaveSettings(biz);
  const [cats, setCats] = useState(biz.settings.expenseCategories);
  return (
    <SettingsCard title="Expense categories" desc="The choices you see when recording an expense." onSave={() => save({ expenseCategories: cats }, "Categories saved")}>
      <ChipEditor label="category" items={cats} onChange={setCats} max={40} placeholder="e.g. Rent" />
      <p className="text-xs text-muted-foreground">Renaming or removing a category does not change expenses you already recorded.</p>
    </SettingsCard>
  );
}

export function InventorySection({ biz }: { biz: Biz }) {
  const save = useSaveSettings(biz);
  const [low, setLow] = useState(String(biz.settings.lowStockThreshold));
  const n = Number(low);
  const valid = low !== "" && Number.isInteger(n) && n >= 0;
  return (
    <SettingsCard title="Inventory" desc="Default stock alert level." disabled={!valid} onSave={() => save({ lowStockThreshold: n })}>
      <Field label="Low stock at" hint="Each product also has its own reorder level, which is what the Low stock list uses." error={!valid ? "Enter a whole number, 0 or more." : undefined}>
        <Input inputMode="numeric" value={low} onChange={(e) => setLow(e.target.value)} className="max-w-32" />
      </Field>
    </SettingsCard>
  );
}
