import Image from "next/image";
import { Banknote, Landmark } from "lucide-react";
import { cn } from "@/lib/utils";

// Set a flag to true after adding the official logo to public/marketing/payments/ (see README.txt there).
const PAYMENT_LOGOS = { evc: false, zaad: false, edahab: false };

const BADGES = [
  { key: "evc", name: "EVC Plus" },
  { key: "zaad", name: "Zaad" },
  { key: "edahab", name: "eDahab" },
] as const;

const pill = "flex min-h-11 items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 shadow-card";

export function PaymentBadges({ className }: { className?: string }) {
  return (
    <ul aria-label="Payment methods" className={cn("flex flex-wrap items-center justify-center gap-2.5", className)}>
      {BADGES.map((b) => (
        <li key={b.key} className={pill}>
          {PAYMENT_LOGOS[b.key] ? (
            <Image src={`/marketing/payments/${b.key}.png`} alt={b.name} width={28} height={28} className="size-7 object-contain" />
          ) : null}
          <span className="leading-tight">
            <span className="block text-sm font-bold">{b.name}</span>
            <span className="block text-[11px] text-muted-foreground">mobile money</span>
          </span>
        </li>
      ))}
      <li className={pill}><Banknote className="size-5 text-brand-700" /><span className="text-sm font-bold">Cash</span></li>
      <li className={pill}><Landmark className="size-5 text-brand-700" /><span className="text-sm font-bold">Bank</span></li>
    </ul>
  );
}
