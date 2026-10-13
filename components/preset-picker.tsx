"use client";
import {
  Beef, BookOpen, Check, Coffee, Croissant, Flame, Hammer, Pill, Scissors, Shirt, ShoppingBasket, Smartphone, Sofa, Sparkles, Store,
  Wallet, Warehouse, Wrench, type LucideIcon,
} from "lucide-react";
import { MAX_BUSINESS_TYPES, PRESETS } from "@/convex/shared/presets";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  Store, ShoppingBasket, Pill, Smartphone, Wallet, Shirt, Sparkles, Hammer, Wrench, Coffee, Croissant, Beef, Sofa, BookOpen, Warehouse, Flame, Scissors,
};
export const PresetIcon = ({ name, className }: { name: string; className?: string }) => {
  const Icon = ICONS[name] ?? Store;
  return <Icon className={className} />;
};

/** Pick up to `max` business types. `disabled` keys (already added) cannot be changed. */
export function PresetGrid({ value, onChange, max = MAX_BUSINESS_TYPES, disabled = [] }: {
  value: string[]; onChange: (v: string[]) => void; max?: number; disabled?: string[];
}) {
  const full = value.length >= max;
  const toggle = (key: string) => {
    if (disabled.includes(key)) return;
    onChange(value.includes(key) ? value.filter((k) => k !== key) : full ? value : [...value, key]);
  };
  return (
    <div role="group" aria-label="Business types" className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2 md:grid-cols-3">
      {PRESETS.map((p) => {
        const on = value.includes(p.key) || disabled.includes(p.key);
        const locked = disabled.includes(p.key);
        const blocked = !on && full;
        return (
          <button key={p.key} type="button" aria-pressed={on} disabled={locked || blocked} onClick={() => toggle(p.key)}
            className={cn("relative flex min-h-[72px] items-center gap-3 rounded-xl border bg-card p-3 text-left shadow-card transition-[transform,border-color,box-shadow] duration-100 active:scale-[0.98]",
              on ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "hover:border-brand-300 hover:shadow-pop",
              blocked && "opacity-50", locked && "cursor-default")}>
            <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", on ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-700")}>
              <PresetIcon name={p.icon} className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-tight">{p.label}</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{p.description}</span>
            </span>
            {on && <span className="absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-brand-600 text-white"><Check className="size-3.5" /></span>}
          </button>
        );
      })}
    </div>
  );
}
