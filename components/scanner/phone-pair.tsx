"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Smartphone, Unplug } from "lucide-react";
import QRCode from "qrcode";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Pill, SubmitButton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { act, run } from "@/lib/run";

export type PairTarget = "POS" | "RECEIVE" | "STOCKTAKE" | "PRODUCTS";

/**
 * Subscribe to scans pushed by the paired phone. Calls `onScan` once per scan, oldest first, then marks them
 * consumed. Pass `undefined` while there is no session.
 */
export function usePairedScans(sessionId: Id<"scanSessions"> | undefined, onScan: (code: string) => void) {
  const rows = useQuery(api.scanner.pending, sessionId ? { sessionId } : "skip");
  const consume = useMutation(api.scanner.consume);
  const handler = useRef(onScan);
  const seen = useRef(new Set<string>());
  useEffect(() => { handler.current = onScan; });
  useEffect(() => {
    if (!rows?.length) return;
    const fresh = rows.filter((r) => !seen.current.has(r._id));
    if (!fresh.length) return;
    fresh.forEach((r) => seen.current.add(r._id));
    for (const r of fresh) {
      try { handler.current(r.barcode); } catch { /* one bad scan must not block the rest */ }
    }
    consume({ scanIds: fresh.map((r) => r._id) }).catch(() => fresh.forEach((r) => seen.current.delete(r._id)));
  }, [rows, consume]);
}

type Session = { id: Id<"scanSessions">; code: string; expiresAt: number };

/**
 * "Use phone as scanner" button + pairing dialog. The session (and the scan subscription) lives as long as this
 * button is mounted, so keep it in the page toolbar. `onScan` receives each barcode exactly like a local scan.
 */
export function PhoneScannerButton({ target, onScan, label = "Use phone as scanner", ...p }: {
  target: PairTarget; onScan: (code: string) => void; label?: string;
} & Omit<React.ComponentProps<typeof Button>, "onClick" | "onScan">) {
  const create = useMutation(api.scanner.createSession);
  const end = useMutation(api.scanner.endSession);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const [qr, setQr] = useState("");
  usePairedScans(session?.id, (code) => { setCount((n) => n + 1); onScan(code); });

  const url = session ? `${window.location.origin}/apps/scan/${session.code}` : "";
  useEffect(() => {
    let live = true;
    if (url) QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: "M" }).then((d) => live && setQr(d)).catch(() => {});
    return () => { live = false; };
  }, [url]);

  async function start() {
    setBusy(true);
    const r = await run(create({ target }));
    setBusy(false);
    // ponytail: sessionId is not returned by createSession yet; the backend must add it (see report)
    const id = (r as { sessionId?: Id<"scanSessions"> } | undefined)?.sessionId;
    if (r && id) { setSession({ id, code: r.code, expiresAt: r.expiresAt }); setCount(0); setQr(""); }
    else if (r) setOpen(false);
  }
  async function disconnect() {
    if (!session) return;
    setBusy(true);
    const ok = await act(end({ sessionId: session.id }), "Phone disconnected");
    setBusy(false);
    if (ok) { setSession(null); setOpen(false); }
  }
  function openDialog() {
    setOpen(true);
    if (!session) void start();
  }

  return (
    <>
      <Button type="button" variant="outline" {...p} onClick={openDialog}>
        <Smartphone />{session ? "Phone connected" : label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Use your phone as a scanner</DialogTitle>
            <DialogDescription>Scan this code with your phone camera, sign in if asked, then scan products. They appear here instantly.</DialogDescription>
          </DialogHeader>
          {session ? (
            <div className="space-y-3 text-center">
              <div className="mx-auto grid size-[240px] place-items-center rounded-xl border bg-white p-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {qr ? <img src={qr} alt="QR code to pair your phone" width={232} height={232} /> : <span className="text-sm text-muted-foreground">Making QR...</span>}
              </div>
              <p className="text-xs text-muted-foreground">Or open <span className="break-all font-medium text-foreground">{url}</span></p>
              <p className="text-sm">Code <span className="rounded-md bg-muted px-2 py-0.5 font-mono font-semibold tracking-wide">{session.code}</span></p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Pill tone={count ? "green" : "amber"} dot>{count ? `${count} scan${count === 1 ? "" : "s"} received` : "Waiting for the first scan"}</Pill>
                <span className="text-xs text-muted-foreground">Valid until {new Date(session.expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground" role="status">{busy ? "Creating a pairing code..." : "Could not create a pairing code."}</p>
          )}
          <DialogFooter>
            {session && <SubmitButton variant="outline" size="lg" busy={busy} onClick={disconnect}><Unplug />Disconnect</SubmitButton>}
            <Button size="lg" onClick={() => setOpen(false)}>{session ? "Done" : "Close"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
