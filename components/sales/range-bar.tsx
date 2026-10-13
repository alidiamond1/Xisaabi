"use client";
import { useState } from "react";
import { FilterChips } from "@/components/common";
import { Input } from "@/components/ui/input";
import { dayEnd, dayStart, isoDay } from "@/lib/session";

export type Preset = "today" | "yesterday" | "week" | "month" | "custom";
const DAY = 86_400_000;

function presetRange(p: Exclude<Preset, "custom">): [string, string] {
  const now = Date.now();
  if (p === "today") return [isoDay(now), isoDay(now)];
  if (p === "yesterday") return [isoDay(now - DAY), isoDay(now - DAY)];
  if (p === "week") {
    const back = (new Date(now).getDay() + 6) % 7; // week starts Monday
    return [isoDay(now - back * DAY), isoDay(now)];
  }
  const d = new Date(now);
  return [isoDay(new Date(d.getFullYear(), d.getMonth(), 1).getTime()), isoDay(now)];
}

// ponytail: 3 date-range hooks (here, inventory/bits, reports/bits) with different presets; merge into one parameterised hook when a 4th appears
/** Date-range state: presets plus a custom from/to. `fromMs`/`toMs` are local day bounds. */
export function useRange(initial: Preset = "today") {
  const [preset, setPreset] = useState<Preset>(initial);
  const [custom, setCustom] = useState<[string, string]>(() => presetRange("today"));
  const [from, to] = preset === "custom" ? custom : presetRange(preset);
  return {
    preset, from, to,
    setPreset: (p: Preset) => { if (p === "custom" && preset !== "custom") setCustom([from, to]); setPreset(p); },
    setFrom: (v: string) => setCustom(([, t]) => [v, t < v ? v : t]),
    setTo: (v: string) => setCustom(([f]) => [f > v ? v : f, v]),
    fromMs: dayStart(from), toMs: dayEnd(to),
  };
}
export type Range = ReturnType<typeof useRange>;

export function RangeBar({ r }: { r: Range }) {
  return (
    <>
      <FilterChips<Preset> value={r.preset} onChange={r.setPreset} options={[
        { value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "week", label: "This week" },
        { value: "month", label: "This month" }, { value: "custom", label: "Custom" },
      ]} />
      {r.preset === "custom" && (
        <div className="flex items-center gap-2">
          <Input type="date" aria-label="From date" value={r.from} onChange={(e) => e.target.value && r.setFrom(e.target.value)} className="h-10 w-40" />
          <span className="text-muted-foreground">to</span>
          <Input type="date" aria-label="To date" value={r.to} onChange={(e) => e.target.value && r.setTo(e.target.value)} className="h-10 w-40" />
        </div>
      )}
    </>
  );
}
