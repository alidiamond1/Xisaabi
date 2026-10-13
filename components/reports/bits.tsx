"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, PrintButton, PrintSheet } from "@/components/inventory/bits";
import { downloadCsv, type CsvCell } from "@/lib/csv";
import { dayEnd, dayStart, isoDay } from "@/lib/session";

export const METHOD_LABEL = { CASH: "Cash", EVC: "EVC Plus", ZAAD: "Zaad", EDAHAB: "eDahab", BANK: "Bank", CREDIT: "Credit" } as const;
export type Method = keyof typeof METHOD_LABEL;
export const METHODS = Object.keys(METHOD_LABEL) as Method[];
/** Methods an expense can be paid with (never credit). */
export const PAID_VIA = METHODS.filter((m) => m !== "CREDIT");

/** Browser timezone as minutes east of UTC (what the reports queries expect). */
export const tzNow = () => -new Date().getTimezoneOffset();
export const cents2 = (c: number | null | undefined) => (c == null ? "" : Math.round(c) / 100);

/* ------------------------------------------------------------ date range */

export type RangePreset = "today" | "yesterday" | "week" | "month" | "lastMonth" | "custom";
const PRESETS: { value: RangePreset; label: string }[] = [
  { value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "week", label: "This week" },
  { value: "month", label: "This month" }, { value: "lastMonth", label: "Last month" }, { value: "custom", label: "Custom" },
];

function dates(p: Exclude<RangePreset, "custom">) {
  const now = new Date();
  const day = (d: Date) => isoDay(d.getTime());
  const at = (y: number, m: number, d: number) => new Date(y, m, d);
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  if (p === "today") return { from: day(now), to: day(now) };
  if (p === "yesterday") return { from: day(at(y, m, d - 1)), to: day(at(y, m, d - 1)) };
  if (p === "week") return { from: day(at(y, m, d - ((now.getDay() + 6) % 7))), to: day(now) }; // Monday start
  if (p === "month") return { from: day(at(y, m, 1)), to: day(now) };
  return { from: day(at(y, m - 1, 1)), to: day(at(y, m, 0)) };
}

/** Date range with presets. `fromMs`/`toMs` are local day bounds; `valid` is false for inverted or > 1 year ranges. */
export function useDateRange(initial: Exclude<RangePreset, "custom"> = "month") {
  const [s, setS] = useState(() => ({ preset: initial as RangePreset, ...dates(initial) }));
  const fromMs = dayStart(s.from), toMs = dayEnd(s.to);
  return {
    ...s, fromMs, toMs,
    valid: toMs >= fromMs && toMs - fromMs <= 365 * 86_400_000,
    label: s.from === s.to ? s.from : `${s.from} to ${s.to}`,
    setPreset: (p: RangePreset) => setS((o) => (p === "custom" ? { ...o, preset: p } : { preset: p, ...dates(p) })),
    setFrom: (from: string) => setS((o) => ({ ...o, preset: "custom", from })),
    setTo: (to: string) => setS((o) => ({ ...o, preset: "custom", to })),
  };
}
export type DateRange = ReturnType<typeof useDateRange>;

export function RangeBar({ r }: { r: DateRange }) {
  return (
    <>
      <NativeSelect aria-label="Date range" className="w-auto" value={r.preset} onChange={(v) => r.setPreset(v as RangePreset)} options={PRESETS} />
      {r.preset === "custom" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Input type="date" aria-label="From" value={r.from} onChange={(e) => e.target.value && r.setFrom(e.target.value)} className="w-40" />
          <span className="text-muted-foreground">to</span>
          <Input type="date" aria-label="To" value={r.to} onChange={(e) => e.target.value && r.setTo(e.target.value)} className="w-40" />
        </div>
      )}
      {!r.valid && <p role="alert" className="w-full text-xs text-danger">Pick a range of up to one year, starting before it ends.</p>}
    </>
  );
}

/* ------------------------------------------------------------ export */

/** CSV + Print for a table of rows (first row = header). Numbers are major units. */
export function ExportBar({ filename, title, sub, rows, disabled }: { filename: string; title: string; sub?: string; rows: CsvCell[][]; disabled?: boolean }) {
  const [head, ...body] = rows;
  const fmt = (c: CsvCell) => (typeof c === "number" ? c.toLocaleString("en-US", { maximumFractionDigits: 2 }) : (c ?? ""));
  return (
    <>
      <Button variant="outline" disabled={disabled} onClick={() => downloadCsv(`${filename}.csv`, rows)}><Download />CSV</Button>
      <PrintButton />
      <PrintSheet title={title} sub={sub}>
        <table>
          <thead><tr>{head?.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === "number" ? "num" : undefined}>{fmt(c)}</td>)}</tr>)}</tbody>
        </table>
      </PrintSheet>
    </>
  );
}

/** "Ask the owner" placeholder for cost/profit sections. */
export const LOCKED_NOTE = "Ask the owner for the See cost price & profit permission.";
