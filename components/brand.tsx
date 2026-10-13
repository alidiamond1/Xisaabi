import { Store } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-800 text-white shadow-card ring-1 ring-brand-900/10", className)}>
      <Store className="size-[55%]" strokeWidth={2.2} />
    </span>
  );
}
