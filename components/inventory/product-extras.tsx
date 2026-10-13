"use client";
// Feature-gated parts of the product form: packs & units, extra fields, serial (IMEI) tracking.
import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Field, FormSection } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AttributeDef } from "@/convex/shared/presets";
import { formatCents, parseToCents } from "@/convex/shared/money";
import { parseSerials, serialProblem } from "@/lib/packs";
import { cn } from "@/lib/utils";
import { MoneyInput, NativeSelect, parseQty } from "./bits";

export type URow = { key: number; name: string; factor: string; barcode: string; price: string };
let uKey = 1;
export const newURow = (): URow => ({ key: uKey++, name: "", factor: "", barcode: "", price: "" });
export const MAX_UNITS = 6;

/** Problems per field ("u<key>.name" ...) for the unit rows. */
export function unitErrors(rows: URow[], base: string, allowDecimal: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  const seen = new Set([base.trim().toLowerCase()]);
  for (const r of rows) {
    const n = r.name.trim().toLowerCase();
    if (!n) e[`u${r.key}.name`] = "Name this pack, e.g. box.";
    else if (seen.has(n)) e[`u${r.key}.name`] = n === base.trim().toLowerCase() ? "This is already your base unit." : "Two packs have the same name.";
    seen.add(n);
    const q = parseQty(r.factor);
    if (q === null || q < 0.001) e[`u${r.key}.factor`] = "Enter how many.";
    else if (!allowDecimal && !Number.isInteger(q)) e[`u${r.key}.factor`] = "Enter a whole number.";
    if (r.price.trim() && parseToCents(r.price) === null) e[`u${r.key}.price`] = "Invalid price.";
  }
  return e;
}

export function PacksSection({ rows, onChange, unit, allowDecimal, priceCents, cur, suggestions, err }: {
  rows: URow[]; onChange: (r: URow[]) => void; unit: string; allowDecimal: boolean; priceCents: number | null; cur: string;
  suggestions: string[]; err: Record<string, string>;
}) {
  const list = useId();
  const set = (key: number, patch: Partial<URow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <FormSection title="Packs & units" desc={`Sell or buy in bigger packs. Stock is always counted in ${unit}.`}>
      <datalist id={list}>{suggestions.filter((s) => s.toLowerCase() !== unit.toLowerCase()).map((s) => <option key={s} value={s} />)}</datalist>
      {rows.length === 0 && <p className="rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">No packs yet. Add one if you also sell this by the box, strip or carton, for example 1 box = 10 {unit}.</p>}
      {rows.map((r, i) => {
        const f = parseQty(r.factor);
        const auto = priceCents !== null && f !== null ? Math.round(f * priceCents) : null;
        return (
          <div key={r.key} className="space-y-3 rounded-xl border p-3">
            <div className="grid grid-cols-[1fr_auto] items-start gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Field label={`Pack ${i + 1} name`} required error={err[`u${r.key}.name`]}>
                <Input list={list} value={r.name} maxLength={30} onChange={(e) => set(r.key, { name: e.target.value })} placeholder="e.g. box" aria-invalid={!!err[`u${r.key}.name`]} />
              </Field>
              <Field label={`1 ${r.name.trim() || "pack"} = how many ${unit}?`} required error={err[`u${r.key}.factor`]} className="order-last col-span-2 sm:order-none sm:col-span-1">
                <Input inputMode={allowDecimal ? "decimal" : "numeric"} value={r.factor} onChange={(e) => set(r.key, { factor: e.target.value })} placeholder="e.g. 10" className="tabular-nums" aria-invalid={!!err[`u${r.key}.factor`]} />
              </Field>
              <Button type="button" variant="ghost" size="icon-lg" className="mt-6 text-danger" aria-label={`Remove pack ${i + 1}`} onClick={() => onChange(rows.filter((x) => x.key !== r.key))}><Trash2 /></Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Pack barcode" hint="Optional. Scanning it sells this pack." error={err[`u${r.key}.barcode`]}>
                <Input inputMode="numeric" value={r.barcode} onChange={(e) => set(r.key, { barcode: e.target.value })} onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} />
              </Field>
              <Field label="Pack price" error={err[`u${r.key}.price`]} hint={auto !== null ? `Leave empty for ${formatCents(auto, cur)} (${r.factor.trim()} × the ${unit} price)` : "Leave empty to use the automatic price"}>
                <MoneyInput cur={cur} value={r.price} onChange={(price) => set(r.key, { price })} placeholder={auto !== null ? (auto / 100).toFixed(2) : "auto"} aria-invalid={!!err[`u${r.key}.price`]} />
              </Field>
            </div>
          </div>
        );
      })}
      {rows.length < MAX_UNITS && <Button type="button" variant="outline" size="lg" onClick={() => onChange([...rows, newURow()])}><Plus />Add pack</Button>}
    </FormSection>
  );
}

/** Problems for the extra fields (numbers must be numbers). */
export function attrErrors(defs: AttributeDef[], vals: Record<string, string>): Record<string, string> {
  const e: Record<string, string> = {};
  for (const d of defs) {
    const v = (vals[d.key] ?? "").trim();
    if (v && d.type === "number" && !Number.isFinite(Number(v))) e[`a.${d.key}`] = "Enter a number.";
  }
  return e;
}

export function AttributesSection({ defs, values, onChange, err }: {
  defs: AttributeDef[]; values: Record<string, string>; onChange: (v: Record<string, string>) => void; err: Record<string, string>;
}) {
  if (defs.length === 0) return null;
  const set = (k: string, v: string) => onChange({ ...values, [k]: v });
  return (
    <FormSection title="More details" desc="Extra fields for your kind of shop. Change them in Settings > Features.">
      <div className="grid gap-4 sm:grid-cols-2">
        {defs.map((d) => (
          <Field key={d.key} label={d.label} error={err[`a.${d.key}`]} hint={d.searchable ? "You can search by this" : undefined}>
            {d.type === "select" ? (
              <NativeSelect value={values[d.key] ?? ""} onChange={(v) => set(d.key, v)} placeholder="Not set" options={(d.options ?? []).map((o) => ({ value: o, label: o }))} />
            ) : (
              <Input inputMode={d.type === "number" ? "decimal" : undefined} value={values[d.key] ?? ""} maxLength={200} onChange={(e) => set(d.key, e.target.value)} aria-invalid={!!err[`a.${d.key}`]} />
            )}
          </Field>
        ))}
      </div>
    </FormSection>
  );
}

/** Serial tracking: switch, warranty, opening serials (create only). */
export function SerialSection({ track, onTrack, warranty, onWarranty, serialsText, onSerials, openingQty, lockedReason, showOpening, err }: {
  track: boolean; onTrack: (v: boolean) => void; warranty: string; onWarranty: (v: string) => void;
  serialsText: string; onSerials: (v: string) => void; openingQty: number | null; lockedReason?: string; showOpening: boolean; err: Record<string, string>;
}) {
  const list = parseSerials(serialsText);
  const want = openingQty ?? 0;
  const bad = list.map((s) => ({ s, p: serialProblem(s) })).filter((x) => x.p);
  const match = list.length === want;
  return (
    <FormSection title="IMEI / serial numbers" desc="For phones and devices you track one by one.">
      <label className={cn("flex min-h-11 items-start gap-3 rounded-lg border p-3", lockedReason && "opacity-60")}>
        <Switch checked={track} disabled={!!lockedReason} onCheckedChange={onTrack} className="mt-0.5" />
        <span>
          <span className="block text-sm font-medium">Track each unit by IMEI / serial number</span>
          <span className="block text-xs text-muted-foreground">Each one you receive and sell is recorded, with its warranty.{lockedReason && ` ${lockedReason}`}</span>
        </span>
      </label>
      {track && (
        <>
          <Field label="Warranty (months)" hint="0 or empty means no warranty." error={err.warranty}>
            <Input inputMode="numeric" value={warranty} onChange={(e) => onWarranty(e.target.value)} className="max-w-32 tabular-nums" placeholder="e.g. 12" aria-invalid={!!err.warranty} />
          </Field>
          {showOpening && (
            <Field label="Opening IMEI / serial numbers" error={err.serials} hint="One per line. Scan them with your scanner or paste a list. IMEI is 15 digits.">
              <Textarea rows={5} value={serialsText} onChange={(e) => onSerials(e.target.value)} className="font-mono tabular-nums" placeholder={"356938035643809\n356938035643817"} aria-invalid={!!err.serials} spellCheck={false} />
            </Field>
          )}
          {showOpening && (
            <div className="space-y-1" aria-live="polite">
              <p className={cn("text-sm font-medium", match ? "text-success" : "text-danger")}>
                {list.length} {list.length === 1 ? "number" : "numbers"} entered{want > 0 || list.length > 0 ? ` · opening stock is ${want}` : ""}{match ? "" : " · they must match"}
              </p>
              {bad.slice(0, 3).map((b) => <p key={b.s} className="text-xs text-danger"><span className="font-mono">{b.s}</span>: {b.p}</p>)}
              {bad.length > 3 && <p className="text-xs text-danger">…and {bad.length - 3} more to check.</p>}
            </div>
          )}
          {!showOpening && <p className="text-xs text-muted-foreground">Add more units from Purchases &gt; Receive stock, where you enter each IMEI.</p>}
        </>
      )}
    </FormSection>
  );
}
