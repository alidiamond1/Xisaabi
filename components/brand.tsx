import { cn } from "@/lib/utils";

/** The XisabSax mark (same art as app/icon.svg and brand/xisabsax-mark.svg). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden className={cn("size-8 shrink-0", className)}>
      <defs>
        <linearGradient id="xs-mark-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1f9284" /><stop offset="1" stopColor="#0a3d38" /></linearGradient>
      </defs>
      <rect width="100" height="100" rx="24" fill="url(#xs-mark-g)" />
      <path d="M30 28 L70 72" stroke="#fff" strokeWidth="13" strokeLinecap="round" />
      <path d="M22 56 L38 72 L76 27" fill="none" stroke="#e8b23a" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** "Xisab" + accented "Sax". dark = on a dark background (Sax in gold). */
export function Wordmark({ dark, className }: { dark?: boolean; className?: string }) {
  return (
    <span className={cn("font-display font-semibold tracking-tight", className)}>
      Xisab<span className={dark ? "text-gold" : "text-brand-600"}>Sax</span>
    </span>
  );
}
