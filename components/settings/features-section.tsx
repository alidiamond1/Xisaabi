"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Field, ListSkeleton, Panel, SubmitButton } from "@/components/common";
import { NativeSelect } from "@/components/inventory/bits";
import { PresetGrid } from "@/components/preset-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FEATURE_LABELS, MAX_BUSINESS_TYPES, PRESETS, type AttributeDef, type Feature } from "@/convex/shared/presets";
import { act } from "@/lib/run";
import { ChipEditor, SettingsCard, SwitchRow, type Biz } from "./parts";

const FEATURES = Object.keys(FEATURE_LABELS) as Feature[];
const MAX_DEFS = 20;

/** "Part number" -> "partNumber" (must match ^[a-z][a-zA-Z0-9]{0,30}$ and be unique). */
function slug(label: string, taken: Set<string>) {
  const words = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const base = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("").replace(/^[0-9]+/, "").slice(0, 28) || "field";
  let key = base, n = 2;
  while (taken.has(key)) key = `${base}${n++}`;
  return key;
}

type Row = AttributeDef & { fresh?: boolean };

export function FeaturesSection({ biz }: { biz: Biz }) {
  const data = useQuery(api.settings.features);
  if (!data) return <Panel className="max-w-2xl"><ListSkeleton rows={6} /></Panel>;
  return (
    <div className="space-y-5">
      {/* remount after a save or a preset so the editor starts from the saved values */}
      <FeaturesEditor key={JSON.stringify([data.features, data.attributeDefs])} features={data.features} defs={data.attributeDefs} />
      <AddTypeCard types={data.businessTypes} />
      <CatalogCard biz={biz} />
    </div>
  );
}

function FeaturesEditor({ features, defs }: { features: Feature[]; defs: AttributeDef[] }) {
  const save = useMutation(api.settings.updateFeatures);
  const [on, setOn] = useState<Feature[]>(features);
  // new rows get their key from the label when saved, and keep it forever so product data stays attached
  const [rows, setRows] = useState<Row[]>(defs);
  const setRow = (i: number, patch: Partial<Row>) => setRows((r) => r.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const bad = rows.some((d) => !d.label.trim() || (d.type === "select" && !d.options?.length));
  return (
    <SettingsCard title="Features" desc="Turn on only what your shop uses. Hidden features keep their data, so you can switch them back on any time." disabled={bad}
      onSave={() => {
        const taken = new Set(rows.filter((d) => !d.fresh).map((d) => d.key));
        const attributeDefs = rows.map((d) => {
          const key = d.fresh ? slug(d.label, taken) : d.key;
          taken.add(key);
          return { key, label: d.label.trim(), type: d.type, options: d.type === "select" ? d.options : undefined, searchable: d.searchable };
        });
        return act(save({ features: on, attributeDefs }), "Features saved");
      }}>
      <div className="space-y-2">
        {FEATURES.map((f) => (
          <SwitchRow key={f} title={FEATURE_LABELS[f].label} desc={FEATURE_LABELS[f].hint} checked={on.includes(f)}
            onChange={(v) => setOn(v ? [...on, f] : on.filter((x) => x !== f))} />
        ))}
      </div>

      {on.includes("attributes") && (
        <div className="space-y-3 border-t pt-5">
          <div>
            <h3 className="text-sm font-semibold">Extra product fields</h3>
            <p className="text-xs text-muted-foreground">Extra boxes on every product, like Generic name or Part number. Turn on Searchable to find products by that field.</p>
          </div>
          {rows.length === 0 && <p className="rounded-xl bg-muted/60 p-4 text-center text-sm text-muted-foreground">No extra fields yet.</p>}
          {rows.map((d, i) => (
            <div key={d.fresh ? `n${i}` : d.key} className="space-y-3 rounded-xl border p-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_170px_auto] sm:items-end">
                <Field label="Field name" error={!d.label.trim() ? "Enter a name." : undefined}>
                  <Input value={d.label} maxLength={40} onChange={(e) => setRow(i, { label: e.target.value })} placeholder="e.g. Part number" />
                </Field>
                <Field label="Type">
                  <NativeSelect value={d.type} onChange={(t) => setRow(i, { type: t as AttributeDef["type"], options: t === "select" ? (d.options ?? []) : undefined })}
                    options={[{ value: "text", label: "Text" }, { value: "number", label: "Number" }, { value: "select", label: "Choose from list" }]} />
                </Field>
                <Button type="button" variant="ghost" size="icon-lg" className="text-danger" aria-label={`Remove ${d.label || "field"}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
              {d.type === "select" && (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Choices</p>
                  <ChipEditor label="choice" items={d.options ?? []} onChange={(o) => setRow(i, { options: o })} max={30} placeholder="e.g. Tablet" />
                  {!d.options?.length && <p role="alert" className="text-xs text-danger">Add at least one choice.</p>}
                </div>
              )}
              <SwitchRow title="Searchable" desc="Find products by this field in Inventory and at the till." checked={d.searchable} onChange={(v) => setRow(i, { searchable: v })} />
            </div>
          ))}
          {rows.length < MAX_DEFS && (
            <Button type="button" variant="outline" size="lg" onClick={() => setRows([...rows, { key: "", label: "", type: "text", searchable: false, fresh: true }])}><Plus />Add field</Button>
          )}
        </div>
      )}
    </SettingsCard>
  );
}

function AddTypeCard({ types }: { types: string[] }) {
  const apply = useMutation(api.settings.applyPreset);
  const room = MAX_BUSINESS_TYPES - types.length;
  const [pick, setPick] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const mine = PRESETS.filter((p) => types.includes(p.key)).map((p) => p.label);
  return (
    <Panel className="max-w-2xl space-y-4 p-5">
      <div>
        <h2 className="font-display text-lg font-semibold">Add a business type</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {mine.length ? `Your shop is set up as: ${mine.join(", ")}. ` : ""}Adding a type switches on its features and adds its categories and fields. Nothing is removed.
        </p>
      </div>
      {room <= 0 ? (
        <p className="rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">You already have {MAX_BUSINESS_TYPES} types, the most allowed. Use the switches above to fine-tune.</p>
      ) : (
        <>
          <PresetGrid value={pick} onChange={setPick} max={room} disabled={types} />
          <SubmitButton busy={busy} disabled={pick.length === 0}
            onClick={async () => { setBusy(true); if (await act(apply({ businessTypes: pick }), "Business type added")) setPick([]); setBusy(false); }}>
            Add {pick.length > 1 ? `${pick.length} types` : "type"}
          </SubmitButton>
        </>
      )}
    </Panel>
  );
}

function CatalogCard({ biz }: { biz: Biz }) {
  const m = useMutation(api.settings.updateSettings);
  const s = biz.settings;
  const base = { taxRatePercent: s.taxRatePercent, lowStockThreshold: s.lowStockThreshold, allowNegativeStock: s.allowNegativeStock };
  const on = s.shareToCatalog !== false;
  const set = (v: boolean) => act(m({ ...base, shareToCatalog: v }), v ? "Sharing is on" : "Sharing is off");
  return (
    <Panel className="max-w-2xl space-y-4 p-5">
      <h2 className="font-display text-lg font-semibold">Community catalog</h2>
      <SwitchRow title="Share product names with other shops" desc="Helps shops that scan a barcode get the name filled in for them." checked={on} onChange={set} />
      <div className="space-y-1.5 rounded-xl bg-muted/60 p-4 text-sm">
        <p className="font-medium">What is shared, and what is not</p>
        <p className="text-muted-foreground">When you save a product that has a barcode, we share only its <b className="text-foreground">name, brand and size</b>.</p>
        <p className="text-muted-foreground">We <b className="text-foreground">never</b> share your prices, costs, stock, sales or customers, and other shops cannot see that the product came from you.</p>
      </div>
    </Panel>
  );
}
