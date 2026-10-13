"use client";
import { useEffect, useRef, useState } from "react";
import { CameraOff, Check, SwitchCamera, Flashlight, FlashlightOff, Keyboard, Loader2, Lock, ScanLine, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { feedback, getDetector, interpret, type ScanResult } from "./scan-utils";

export type { ScanResult } from "./scan-utils";

type Cam = "starting" | "scanning" | "denied" | "nocamera" | "insecure" | "error";
const DEDUPE_MS = 1500;
const CAM_KEY = "xisaabi-camera"; // the lens the user picked with "Switch camera"
const camId = () => { try { return localStorage.getItem(CAM_KEY) ?? undefined; } catch { return undefined; } };

const PROBLEMS: Record<Exclude<Cam, "starting" | "scanning">, { icon: typeof CameraOff; title: string; body: string }> = {
  denied: { icon: Lock, title: "Camera is blocked", body: "Allow the camera for this site in your browser settings, then tap Try again. You can also type the code below." },
  nocamera: { icon: CameraOff, title: "No camera found", body: "This device has no usable camera. Type the code below or use a USB scanner." },
  insecure: { icon: ShieldAlert, title: "Camera needs a secure page", body: "Open the HTTPS address of Xisaabi (https://...) to use the camera. Typing the code below always works." },
  error: { icon: CameraOff, title: "Could not start the scanner", body: "Check your connection and tap Try again, or type the code below." },
};

/**
 * Live camera barcode scanner. Mount it only while it should be using the camera; it releases the camera on unmount.
 * Single mode (default) reports the first valid read once. `continuous` keeps scanning; the same code is
 * ignored until it has been out of view for 1.5 s. `paused` keeps the camera open but ignores reads.
 */
export function CameraScanner({ onScan, continuous = false, paused = false, className }: {
  onScan: (r: ScanResult) => void; continuous?: boolean; paused?: boolean; className?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const [cam, setCam] = useState<Cam>("starting");
  const [torch, setTorch] = useState<boolean | null>(null); // null = not supported
  const [flash, setFlash] = useState(false);
  const [manual, setManual] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [cams, setCams] = useState<string[]>([]); // back cameras, for the switch button
  const [zoom, setZoom] = useState<{ max: number; value: number } | null>(null); // null = lens has no zoom
  const live = useRef({ onScan, continuous, paused });
  const last = useRef({ code: "", at: 0 });
  const done = useRef(false);
  useEffect(() => { live.current = { onScan, continuous, paused }; });

  function emit(r: ScanResult) {
    const now = Date.now();
    const { code, at } = last.current;
    last.current = { code: r.code, at: now };
    if (r.code === code && now - at < DEDUPE_MS) return false;
    if (!live.current.continuous) done.current = true;
    feedback();
    setFlash(true);
    window.setTimeout(() => setFlash(false), 450);
    live.current.onScan(r);
    return true;
  }

  useEffect(() => {
    let stop = false;
    let timer = 0;
    let stream: MediaStream | undefined;
    done.current = false;
    (async () => {
      setCam("starting");
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setCam("insecure"); return; }
      const open = (deviceId?: string) => navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }), width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      try {
        stream = await open(camId());
        // Labels exist only after permission. Many phones (Samsung…) hand out the ultra-wide back lens,
        // which cannot focus up close, so barcodes never read: list the back cameras and prefer the main one.
        const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
        const back = cams.filter((d) => !/front|user|facetime/i.test(d.label));
        const list = back.length ? back : cams;
        if (!stop) setCams(list.map((d) => d.deviceId));
        const using = stream.getVideoTracks()[0]?.getSettings().deviceId;
        const main = list.find((d) => /camera2 0|back camera$|rear camera$/i.test(d.label)) ?? list.find((d) => !/ultra|wide|0\.5|tele|depth|macro/i.test(d.label));
        if (!camId() && main && using && main.deviceId !== using) {
          stream.getTracks().forEach((t) => t.stop());
          stream = await open(main.deviceId);
        }
      } catch (e) {
        const n = (e as DOMException)?.name;
        if (n === "OverconstrainedError" && camId()) { try { localStorage.removeItem(CAM_KEY); } catch {} if (!stop) setAttempt((x) => x + 1); return; }
        if (!stop) setCam(n === "NotAllowedError" || n === "SecurityError" ? "denied" : n === "NotFoundError" || n === "OverconstrainedError" || n === "DevicesNotFoundError" ? "nocamera" : "error");
        return;
      }
      if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
      const el = video.current;
      const t = stream.getVideoTracks()[0];
      if (!el || !t) { stream.getTracks().forEach((x) => x.stop()); setCam("error"); return; }
      track.current = t;
      const caps = (t.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[]; zoom?: { min: number; max: number } };
      setTorch(caps.torch ? false : null);
      if (caps.focusMode?.includes("continuous")) void t.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
      // Phone lenses can't focus closer than ~10–15 cm: start at 2× zoom so the barcode looks big from a distance that stays sharp.
      if (caps.zoom && caps.zoom.max >= 1.5) { setZoom({ max: caps.zoom.max, value: 1 }); void setLensZoom(t, Math.min(2, caps.zoom.max)); }
      el.srcObject = stream;
      await el.play().catch(() => {});
      let det;
      try { det = await getDetector(); } catch { if (!stop) setCam("error"); return; }
      if (stop) return;
      setCam("scanning");
      const tick = async () => {
        if (stop || done.current) return;
        if (!live.current.paused && el.readyState >= 2) {
          try {
            for (const b of await det.detect(el)) {
              const r = interpret(b.rawValue, b.format);
              if (r && emit(r)) break;
            }
          } catch { /* a bad frame is not an error */ }
        }
        if (!stop && !done.current) timer = window.setTimeout(tick, 120);
      };
      void tick();
    })();
    return () => {
      stop = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      track.current = null;
    };
    // emit only touches refs and stable setters, so [attempt] is the only real dependency
  }, [attempt]);

  async function setLensZoom(t: MediaStreamTrack, value: number) {
    try {
      await t.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] });
      setZoom((z) => z && { ...z, value });
    } catch { /* lens refused: keep current zoom */ }
  }

  /** Tap the picture: re-run autofocus (single-shot where supported, else re-arm continuous). */
  function refocus() {
    const t = track.current;
    const modes = (t?.getCapabilities?.() as { focusMode?: string[] } | undefined)?.focusMode ?? [];
    const mode = modes.includes("single-shot") ? "single-shot" : modes.includes("continuous") ? "continuous" : null;
    if (t && mode) void t.applyConstraints({ advanced: [{ focusMode: mode } as MediaTrackConstraintSet] }).catch(() => {});
  }

  function switchCamera() {
    const cur = track.current?.getSettings().deviceId;
    const next = cams[(cams.indexOf(cur ?? "") + 1) % cams.length];
    try { localStorage.setItem(CAM_KEY, next); } catch {}
    setAttempt((n) => n + 1);
  }

  async function toggleTorch() {
    const next = !torch;
    try {
      await track.current?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch(next);
    } catch { setTorch(null); }
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const code = manual.trim();
    if (!code) return;
    last.current = { code: "", at: 0 };
    if (emit({ code, format: "manual" })) setManual("");
  }

  const problem = cam === "starting" || cam === "scanning" ? null : PROBLEMS[cam];
  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <div className="relative min-h-64 flex-1 overflow-hidden rounded-2xl bg-foreground">
        <style>{"@keyframes dk-scan{0%,100%{top:0}50%{top:calc(100% - 2px)}}"}</style>
        <video ref={video} playsInline muted onClick={refocus} className={cn("absolute inset-0 size-full object-cover", problem && "hidden")} />
        {problem ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-white">
            <div className="max-w-xs">
              <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-white/10"><problem.icon className="size-6" /></div>
              <p className="font-display text-base font-semibold">{problem.title}</p>
              <p className="mt-1 text-sm text-white/75">{problem.body}</p>
              {cam !== "insecure" && cam !== "nocamera" && (
                <Button variant="secondary" size="lg" className="mt-4" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className={cn("relative h-[34%] w-[78%] rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] transition-colors", flash ? "ring-4 ring-success" : "ring-2 ring-white/70")}>
                {cam === "scanning" && !flash && (
                  <span className="absolute inset-x-3 h-0.5 animate-[dk-scan_2.2s_ease-in-out_infinite] rounded-full bg-brand-300 motion-reduce:hidden" />
                )}
                {flash && <span className="absolute inset-0 grid place-items-center"><span className="grid size-14 place-items-center rounded-full bg-success text-white"><Check className="size-7" /></span></span>}
              </div>
            </div>
            <p className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-xs font-medium text-white">
                {cam === "starting" ? <><Loader2 className="size-3.5 animate-spin" />Starting camera</> : <><ScanLine className="size-3.5" />{continuous ? "Scanning, keep going" : "Point at the barcode"} · hold 20 cm away, tap to focus</>}
              </span>
            </p>
            {cams.length > 1 && (
              <Button type="button" size="lg" variant="secondary" className="absolute left-3 top-3 bg-black/55 text-white hover:bg-black/70" onClick={switchCamera}>
                <SwitchCamera /> Switch camera
              </Button>
            )}
            {zoom && track.current && (
              <Button type="button" size="lg" variant="secondary" className={cn("absolute top-3 bg-black/55 font-semibold tabular-nums text-white hover:bg-black/70", torch !== null ? "right-16" : "right-3")}
                aria-label="Zoom" onClick={() => track.current && void setLensZoom(track.current, zoom.value >= 2 ? 1 : Math.min(2, zoom.max))}>
                {zoom.value >= 2 ? "2×" : "1×"}
              </Button>
            )}
            {torch !== null && (
              <Button type="button" size="icon-lg" variant="secondary" className="absolute right-3 top-3 bg-black/55 text-white hover:bg-black/70" aria-label={torch ? "Turn light off" : "Turn light on"} aria-pressed={torch} onClick={toggleTorch}>
                {torch ? <FlashlightOff /> : <Flashlight />}
              </Button>
            )}
          </>
        )}
      </div>
      <form onSubmit={submitManual} className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Keyboard className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
          <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Type code instead" aria-label="Type code instead" autoComplete="off" className="h-11 pl-9" />
        </div>
        <Button type="submit" size="lg" variant="outline" disabled={!manual.trim()}>Use code</Button>
      </form>
    </div>
  );
}

/**
 * Full-screen (phones) / centred (desktop) scanner dialog. Single mode closes itself after one scan;
 * `continuous` stays open (show recent scans via `children`). The camera runs only while open.
 */
export function ScanDialog({ open, onOpenChange, onScan, continuous = false, title = "Scan barcode", children }: {
  open: boolean; onOpenChange: (o: boolean) => void; onScan: (r: ScanResult) => void; continuous?: boolean; title?: string; children?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-lg">
        <div className="flex h-full max-h-dvh min-h-0 flex-col gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="pr-10">
            <DialogTitle className="font-display text-base font-semibold">{title}</DialogTitle>
            <DialogDescription className="sr-only">Point the camera at a barcode, or type the code.</DialogDescription>
          </div>
          <CameraScanner
            className="flex-1 sm:h-[26rem] sm:flex-none"
            continuous={continuous}
            onScan={(r) => { onScan(r); if (!continuous) onOpenChange(false); }}
          />
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}

