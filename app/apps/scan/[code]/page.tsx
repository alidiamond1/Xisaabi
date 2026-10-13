"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Loader2, TriangleAlert, Wifi, WifiOff, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { EmptyState, Pill } from "@/components/common";
import { BrandMark } from "@/components/brand";
import { useBiz } from "@/components/guard";
import { CameraScanner, type ScanResult } from "@/components/scanner/camera-scanner";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/convex/shared/errors";
import { cn } from "@/lib/utils";

const TARGETS: Record<string, string> = { POS: "Point of Sale", RECEIVE: "Receive stock", STOCKTAKE: "Stocktake", PRODUCTS: "Products" };
type Sent = { id: number; code: string; state: "sending" | "ok" | "fail"; msg?: string };

function useOnline() {
  return useSyncExternalStore(
    (cb) => { window.addEventListener("online", cb); window.addEventListener("offline", cb); return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); }; },
    () => navigator.onLine,
    () => true,
  );
}

/** Phone side of "Use phone as scanner": every read is pushed to the desktop session. */
export default function PhoneScanPage() {
  const { code } = useParams<{ code: string }>();
  const me = useBiz();
  const [now] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
  const info = useQuery(api.scanner.sessionInfo, { code, now });
  const push = useMutation(api.scanner.push);
  const online = useOnline();
  const [sent, setSent] = useState<Sent[]>([]);
  const [ended, setEnded] = useState(false);
  const seq = useRef(0);

  const dead = info === null || (info && (!info.active || info.expired)) || ended;

  async function onScan(r: ScanResult) {
    const id = ++seq.current;
    const patch = (p: Partial<Sent>) => setSent((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
    setSent((l) => [{ id, code: r.code, state: "sending" as const }, ...l].slice(0, 5));
    try {
      await push({ code, barcode: r.code });
      patch({ state: "ok" });
    } catch (e) {
      const invalid = (e as { data?: unknown })?.data === "SCAN_SESSION_INVALID";
      if (invalid) setEnded(true);
      patch({ state: "fail", msg: errorMessage(e) });
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-3 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:py-6">
      <header className="flex items-center gap-3">
        <BrandMark />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-lg font-semibold leading-tight">Phone scanner</h1>
          <p className="truncate text-xs text-muted-foreground">{me.business.name}{info ? ` · for ${TARGETS[info.target] ?? info.target}${info.createdBy ? ` (${info.createdBy})` : ""}` : ""}</p>
        </div>
        {online ? <Pill tone="green" dot><Wifi className="size-3" />Online</Pill> : <Pill tone="amber" dot><WifiOff className="size-3" />Offline</Pill>}
      </header>

      {info === undefined ? (
        <div className="grid flex-1 place-items-center text-muted-foreground" role="status"><Loader2 className="size-6 animate-spin" /></div>
      ) : dead ? (
        <div className="rounded-xl border bg-card shadow-card">
          <EmptyState icon={TriangleAlert} title={info === null ? "This scanner link is not valid" : "This scanner link has ended"}
            desc={info === null ? "It may belong to another shop, or the code was typed wrong. Open the QR on your computer again." : "Pair again: tap Use phone as scanner on your computer and scan the new QR."}
            action={<Button asChild size="lg" variant="outline"><Link href="/apps">Back to Dukaan</Link></Button>} />
        </div>
      ) : (
        <>
          {!online && <p role="status" className="rounded-xl bg-warning-soft px-4 py-2.5 text-sm text-warning">You are offline. Scans cannot reach your computer until the connection is back.</p>}
          <CameraScanner continuous onScan={onScan} className="h-[52dvh] sm:h-[28rem]" />
          <section aria-label="Recent scans" className="rounded-xl border bg-card shadow-card">
            <h2 className="border-b px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Last scans</h2>
            {sent.length === 0 ? (
              <p className="px-4 py-5 text-center text-sm text-muted-foreground">Scan a product. It shows up on your computer.</p>
            ) : (
              <ul className="divide-y">
                {sent.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-white", s.state === "ok" ? "bg-success" : s.state === "fail" ? "bg-danger" : "bg-muted text-muted-foreground")}>
                      {s.state === "ok" ? <Check className="size-3.5" /> : s.state === "fail" ? <X className="size-3.5" /> : <Loader2 className="size-3.5 animate-spin" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono tabular-nums">{s.code}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{s.state === "ok" ? "Sent" : s.state === "fail" ? s.msg : "Sending"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
