"use client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common";
import { PRESETS } from "@/convex/shared/presets";

export type Profile = {
  name: string;
  businessType: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  country: string;
  currency: string;
};
export const EMPTY_PROFILE: Profile = {
  name: "", businessType: "General shop", phone: "", email: "", address: "", city: "", country: "Somalia", currency: "USD",
};
// same names as the business-type cards, so the profile matches what you picked
const TYPES = [...PRESETS.map((p) => p.label), "Other"];
const CURRENCIES = ["USD", "SOS", "SLSH", "EUR", "KES", "ETB"];

export function BusinessFields({ value, onChange }: { value: Profile; onChange: (p: Profile) => void }) {
  const set = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
  const types = TYPES.includes(value.businessType) ? TYPES : [value.businessType, ...TYPES];
  const currencies = CURRENCIES.includes(value.currency) ? CURRENCIES : [value.currency, ...CURRENCIES];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Business name" className="sm:col-span-2">
        <Input value={value.name} onChange={set("name")} maxLength={100} required />
      </Field>
      <Field label="Business type">
        <Select value={value.businessType} onValueChange={(t) => onChange({ ...value, businessType: t })}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Currency">
        <Select value={value.currency} onValueChange={(c) => onChange({ ...value, currency: c })}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{currencies.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Phone"><Input type="tel" value={value.phone} onChange={set("phone")} /></Field>
      <Field label="Email (optional)"><Input type="email" value={value.email} onChange={set("email")} /></Field>
      <Field label="Address" className="sm:col-span-2"><Input value={value.address} onChange={set("address")} /></Field>
      <Field label="City"><Input value={value.city} onChange={set("city")} /></Field>
      <Field label="Country"><Input value={value.country} onChange={set("country")} required /></Field>
    </div>
  );
}
