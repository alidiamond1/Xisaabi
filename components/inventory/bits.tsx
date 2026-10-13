"use client";
import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/common";
import { cn } from "@/lib/utils";
import { dayEnd, dayStart, isoDay } from "@/lib/session";

export const UNITS = ["pcs", "kg", "g", "litre", "ml", "box", "carton", "pack", "metre", "dozen"];

export const REASONS = [
  { value: "DAMAGED", label: "Damaged" }, { value: "EXPIRED", label: "Expired" }, { value: "LOST", label: "Lost" },
  { value: "FOUND", label: "Found" }, { value: "CORRECTION", label: "Correction" }, { value: "OWN_USE", label: "Own use" },
  { value: "OTHER", label: "Other" },
] as const;
export type Reason = (typeof REASONS)[number]["value"];

export const MOVE_TYPES = [
  { value: "OPENING", label: "Opening stock" }, { value: "SALE", label: "Sale" }, { value: "REFUND", label: "Refund" },
  { value: "PURCHASE", label: "Purchase" }, { value: "ADJUSTMENT", label: "Adjustment" }, { value: "STOCKTAKE", label: "Stocktake" },
  { value: "WRITE_OFF", label: "Write-off" },
] as const;
export type MoveType = (typeof MOVE_TYPES)[number]["value"];
export const moveLabel = (t: string) => MOVE_TYPES.find((m) => m.value === t)?.label ?? t;
export const reasonLabel = (r?: string) => REASONS.find((x) => x.value === r)?.label ?? (r ? r.charAt(0) + r.slice(1).toLowerCase() : "");

/** 1.2000000004 -> "1.2" */
export const fmtQty = (n: number) => String(Number(n.toFixed(3)));
export const signedQty = (n: number) => (n > 0 ? "+" : "") + fmtQty(n);
/** 1250 -> "12.50" for inputs. */
export const centsToInput = (c: number | undefined) => (c === undefined ? "" : (c / 100).toFixed(2));
/** Decimal text -> number or null. Accepts "1.5" and "1,5". */
export function parseQty(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
/** yyyy-mm-dd -> end of that local day (expiry is valid through the day). */
export const expiryMs = (s: string) => dayEnd(s);

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Native select styled like Input (best on cheap phones). */
export function NativeSelect({ value, onChange, options, placeholder, className, ...p }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string;
} & Omit<React.ComponentProps<"select">, "value" | "onChange" | "children">) {
  return (
    <select {...p} value={value} onChange={(e) => onChange(e.target.value)}
      className={cn("h-11 w-full min-w-0 rounded-lg md:h-10 border border-input bg-card px-2.5 text-base shadow-card outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm", className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Radio-style segmented control. 44px targets. */
export function Segmented<V extends string>({ value, onChange, options, label, className }: {
  value: V; onChange: (v: V) => void; label: string; className?: string;
  options: { value: V; label: string; icon?: React.ReactNode; disabled?: boolean }[];
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex gap-1 rounded-xl bg-muted p-1", className)}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={o.disabled} onClick={() => onChange(o.value)}
          className={cn("flex h-11 min-w-fit flex-1 whitespace-nowrap items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium transition-colors disabled:opacity-50",
            value === o.value ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground")}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

/** Currency-prefixed decimal input. */
export function MoneyInput({ value, onChange, cur, className, ...p }: {
  value: string; onChange: (v: string) => void; cur: string;
} & Omit<React.ComponentProps<"input">, "value" | "onChange">) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">{cur}</span>
      <Input {...p} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className={cn("tabular-nums", cur.length > 3 ? "pl-14" : "pl-11", className)} />
    </div>
  );
}

/** Days-left badge for a batch / product. */
export function ExpiryBadge({ days }: { days: number }) {
  if (days <= 0) return <Pill tone="red">{days === 0 ? "Expires today" : `Expired ${-days}d ago`}</Pill>;
  if (days <= 30) return <Pill tone="amber">{days} day{days === 1 ? "" : "s"} left</Pill>;
  if (days <= 90) return <Pill tone="blue">{days} days left</Pill>;
  return <Pill tone="slate">{days} days left</Pill>;
}

/* ------------------------------------------------------------ date range */

export type Preset = "today" | "7d" | "30d" | "month" | "custom";
export const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "Today" }, { value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" },
  { value: "month", label: "This month" }, { value: "custom", label: "Custom range" },
];

function presetDates(p: Exclude<Preset, "custom">) {
  const now = Date.now();
  const today = isoDay(now);
  if (p === "today") return { from: today, to: today };
  if (p === "7d") return { from: isoDay(now - 6 * 86_400_000), to: today };
  if (p === "30d") return { from: isoDay(now - 29 * 86_400_000), to: today };
  const d = new Date(now);
  return { from: isoDay(new Date(d.getFullYear(), d.getMonth(), 1).getTime()), to: today };
}

/** Stable date range for Convex query args (changes only when the user changes it). */
export function useRange(initial: Exclude<Preset, "custom"> = "30d") {
  const [s, setS] = useState(() => ({ preset: initial as Preset, ...presetDates(initial) }));
  return {
    ...s,
    fromMs: dayStart(s.from),
    toMs: dayEnd(s.to),
    setPreset: (p: Preset) => setS((o) => (p === "custom" ? { ...o, preset: p } : { preset: p, ...presetDates(p) })),
    setFrom: (from: string) => setS((o) => ({ ...o, preset: "custom", from })),
    setTo: (to: string) => setS((o) => ({ ...o, preset: "custom", to })),
  };
}

export function RangeBar({ r }: { r: ReturnType<typeof useRange> }) {
  return (
    <>
      <NativeSelect aria-label="Date range" className="w-auto" value={r.preset} onChange={(v) => r.setPreset(v as Preset)} options={PRESETS} />
      {r.preset === "custom" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Input type="date" aria-label="From" value={r.from} max={r.to} onChange={(e) => e.target.value && r.setFrom(e.target.value)} className="w-40" />
          <span className="text-muted-foreground">to</span>
          <Input type="date" aria-label="To" value={r.to} min={r.from} onChange={(e) => e.target.value && r.setTo(e.target.value)} className="w-40" />
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------ printing */

/** Content shown only when printing (A4). Mount one PrintSheet per page. */
export function PrintSheet({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <>
      <style>{`@media print { body * { visibility: hidden !important; } #sheet-print, #sheet-print * { visibility: visible !important; }
        #sheet-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0; background: #fff; color: #000; font-size: 12px; }
        #sheet-print table { width: 100%; border-collapse: collapse; } #sheet-print th, #sheet-print td { border-bottom: 1px solid #ccc; padding: 5px 6px; text-align: left; }
        #sheet-print .num { text-align: right; } @page { size: A4; margin: 12mm; } }`}</style>
      <div id="sheet-print" className="hidden print:block">
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>{title}</h1>
        {sub && <p style={{ marginBottom: 8 }}>{sub}</p>}
        {children}
      </div>
    </>
  );
}

export function PrintButton({ label = "Print" }: { label?: string }) {
  return <Button variant="outline" onClick={() => window.print()}><Printer />{label}</Button>;
}
