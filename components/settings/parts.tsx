"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { Check, Pencil, Plus, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Panel, SubmitButton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { act } from "@/lib/run";
import { cn } from "@/lib/utils";

export type Biz = Doc<"businesses">;
type Patch = Partial<Pick<Biz["settings"], "receiptHeader" | "receiptFooter" | "taxRatePercent" | "lowStockThreshold" | "allowNegativeStock" | "paymentMethods" | "maxCashierDiscountPercent" | "defaultCreditLimitCents" | "expenseCategories" | "discountPresets">>;

/** updateSettings needs three fields every time; fill them from the current settings and send only what a section changed. */
export function useSaveSettings(biz: Biz) {
  const m = useMutation(api.settings.updateSettings);
  const s = biz.settings;
  return (patch: Patch, ok = "Settings saved") =>
    act(m({ taxRatePercent: s.taxRatePercent, lowStockThreshold: s.lowStockThreshold, allowNegativeStock: s.allowNegativeStock, ...patch }), ok);
}

/** A settings section: title, helper, fields, one Save button. */
export function SettingsCard({ title, desc, onSave, disabled, children }: {
  title: string; desc?: string; onSave: () => Promise<unknown>; disabled?: boolean; children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Panel className="max-w-2xl p-5">
      <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await onSave(); } finally { setBusy(false); } }} className="space-y-5">
        <div><h2 className="font-display text-lg font-semibold">{title}</h2>{desc && <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>}</div>
        {children}
        <SubmitButton type="submit" busy={busy} disabled={disabled}>Save changes</SubmitButton>
      </form>
    </Panel>
  );
}

/** Switch row with a title and a plain-words explanation. */
export function SwitchRow({ title, desc, checked, onChange, disabled }: { title: string; desc?: string; checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn("flex min-h-14 items-center justify-between gap-4 rounded-xl border p-3.5", !disabled && "cursor-pointer")}>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        {desc && <span className="block text-xs text-muted-foreground">{desc}</span>}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
    </label>
  );
}

/** Editable list of short text chips: add, rename (pencil) and remove (x). */
export function ChipEditor({ items, onChange, max, suffix = "", placeholder, label, validate }: {
  items: string[]; onChange: (v: string[]) => void; max: number; suffix?: string; placeholder: string; label: string; validate?: (v: string) => boolean;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [edit, setEdit] = useState("");
  const ok = (v: string, skip?: number) => v.trim() !== "" && (validate?.(v.trim()) ?? true) && !items.some((x, i) => i !== skip && x.toLowerCase() === v.trim().toLowerCase());
  const add = () => { if (ok(draft) && items.length < max) { onChange([...items, draft.trim()]); setDraft(""); } };
  const commit = () => {
    if (editing !== null && ok(edit, editing)) onChange(items.map((x, i) => (i === editing ? edit.trim() : x)));
    setEditing(null);
  };
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-2" aria-label={label}>
        {items.map((it, i) => (
          <li key={it} className="flex h-10 items-center gap-1 rounded-full border bg-card pl-3.5 pr-1 text-sm">
            {editing === i ? (
              <>
                <Input autoFocus value={edit} onChange={(e) => setEdit(e.target.value)} aria-label={`Rename ${it}`} className="h-8 w-36"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") setEditing(null); }} />
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Save name" onClick={commit}><Check /></Button>
              </>
            ) : (
              <>
                <span>{it}{suffix}</span>
                {!suffix && <Button type="button" size="icon-sm" variant="ghost" aria-label={`Rename ${it}`} onClick={() => { setEditing(i); setEdit(it); }}><Pencil /></Button>}
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${it}`} disabled={items.length <= 1 && max > 6} onClick={() => onChange(items.filter((_, j) => j !== i))}><X /></Button>
              </>
            )}
          </li>
        ))}
        {items.length === 0 && <li className="text-sm text-muted-foreground">None yet.</li>}
      </ul>
      {items.length < max && (
        <div className="flex gap-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} aria-label={`Add ${label}`} maxLength={40} className="max-w-xs"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <Button type="button" variant="outline" onClick={add} disabled={!ok(draft)}><Plus />Add</Button>
        </div>
      )}
    </div>
  );
}
