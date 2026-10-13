import { isValidGtin, parseGs1, type Gs1 } from "@/convex/shared/barcode";

/** What a scanner hands to the page. `gs1` is set for GS1 DataMatrix / GS1-128 (batch, expiry, serial). */
export type ScanResult = { code: string; format: string; gs1?: Gs1 };

export const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code", "data_matrix"] as const;
const GTIN_FORMATS = new Set(["ean_13", "ean_8", "upc_a", "upc_e"]);
const GS1_FORMATS = new Set(["data_matrix", "code_128", "qr_code"]);
// GS1 element strings start with a symbology prefix, "(01)" or AI 01 + 14 digits; a plain Code 128 label does not.
const LOOKS_GS1 = /^(\][A-Za-z][0-9A-Za-z])?(\(01\)|01\d{14})/;

/** Turn one raw detection into a ScanResult, or null when it is a misread (bad check digit). */
export function interpret(raw: string, format: string): ScanResult | null {
  const text = raw.trim();
  if (!text) return null;
  if (GTIN_FORMATS.has(format)) return isValidGtin(text) ? { code: text, format } : null;
  if (GS1_FORMATS.has(format) && LOOKS_GS1.test(text)) {
    const gs1 = parseGs1(text);
    if (gs1.gtin) return { code: gs1.gtin, format, gs1 };
  }
  return { code: text, format };
}

type Detection = { rawValue: string; format: string };
export type Detector = { detect: (src: HTMLVideoElement) => Promise<Detection[]> };
type NativeCtor = { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

let cached: Promise<Detector> | null = null;

/**
 * Native BarcodeDetector when it reads EAN-13 (Chrome on Android), else the lazy ZXing-wasm ponyfill.
 * The wasm is self-hosted at /wasm/zxing_reader.wasm (copied from node_modules/zxing-wasm/dist/reader).
 */
export function getDetector(): Promise<Detector> {
  cached ??= (async () => {
    const Native = (window as unknown as { BarcodeDetector?: NativeCtor }).BarcodeDetector;
    if (Native) {
      try {
        const sup = (await Native.getSupportedFormats?.()) ?? [];
        if (sup.includes("ean_13")) return new Native({ formats: FORMATS.filter((f) => sup.includes(f)) });
      } catch { /* fall through to the ponyfill */ }
    }
    const m = await import("barcode-detector/ponyfill");
    m.prepareZXingModule({
      overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? `/wasm/${path}` : prefix + path) },
    });
    return new m.BarcodeDetector({ formats: [...FORMATS] }) as unknown as Detector;
  })().catch((e) => { cached = null; throw e; });
  return cached;
}

let audio: AudioContext | undefined;
/** Short beep + vibration. Silent if the browser blocks audio. */
export function feedback() {
  try {
    navigator.vibrate?.(40);
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = "square"; o.frequency.value = 1800;
    g.gain.setValueAtTime(0.08, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.09);
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.1);
  } catch { /* no audio */ }
}
