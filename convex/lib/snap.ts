export type SnapEnvironment = "sandbox" | "live";
type SnapEnv = {
  CONVEX_SITE_URL?: string;
  SNAP_SECRET_KEY?: string; SNAP_WEBHOOK_SECRET?: string; SNAP_MERCHANT_ID?: string;
  SNAP_ENVIRONMENT?: string; SNAP_ENABLE_LIVE?: string; SNAP_API_BASE_URL?: string;
  SNAP_CHECKOUT_ORIGINS?: string; SNAP_APP_ORIGIN?: string; SNAP_SANDBOX_BUSINESS_IDS?: string;
};
export type SnapConfig = {
  secretKey: string; webhookSecret: string; merchantId: string; environment: SnapEnvironment;
  apiBaseUrl: string; appOrigin: string; checkoutOrigins: string[]; sandboxBusinessIds: string[];
};

function httpsOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}

export function snapConfig(env: SnapEnv): SnapConfig | null {
  const environment = env.SNAP_ENVIRONMENT ?? "sandbox";
  if (environment !== "sandbox" && environment !== "live") return null;
  const secretKey = env.SNAP_SECRET_KEY ?? "";
  const prefix = environment === "sandbox" ? "sk_test_" : "sk_live_";
  if (!secretKey.startsWith(prefix) || secretKey.length <= prefix.length) return null;
  if (environment === "live" && env.SNAP_ENABLE_LIVE !== "true") return null;
  const apiBaseUrl = httpsOrigin(env.SNAP_API_BASE_URL ?? "https://api.snap.so");
  const rawAppOrigin = env.SNAP_APP_ORIGIN ?? "";
  // Sandbox may return to a local dev server; live must be https.
  const appOrigin = environment === "sandbox" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(rawAppOrigin) ? rawAppOrigin : httpsOrigin(rawAppOrigin);
  const checkoutOrigins = (env.SNAP_CHECKOUT_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean).map(httpsOrigin);
  const merchantId = env.SNAP_MERCHANT_ID?.trim() ?? ""; // optional: SNAP dashboard does not show one
  const webhookSecret = env.SNAP_WEBHOOK_SECRET ?? "";
  if (!apiBaseUrl || !appOrigin || merchantId.length > 200 || !webhookSecret.startsWith("whsec_") || webhookSecret.length <= 6 || !checkoutOrigins.length || checkoutOrigins.some(s => s === null)) return null;
  return {secretKey, webhookSecret, merchantId, environment, apiBaseUrl, appOrigin, checkoutOrigins: checkoutOrigins as string[],
    sandboxBusinessIds: (env.SNAP_SANDBOX_BUSINESS_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean)};
}

export const canUseSnap = (config: SnapConfig | null, businessId: string): config is SnapConfig =>
  config !== null && (config.environment === "live" || config.sandboxBusinessIds.includes(businessId));

export function isCheckoutUrl(value: string, origins: string[]): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && origins.includes(url.origin);
  } catch { return false; }
}

export const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200;
export const stringMap = (value: unknown): value is Record<string, string> => object(value) && Object.values(value).every(v => typeof v === "string");
export type SnapPayment = {id: string; amount: number; currency: string; provider: string; status: string; refunded_amount: number; metadata: Record<string, string>};

export function readPayment(value: unknown): SnapPayment | null {
  if (!object(value) || value.object !== "payment" || !identifier(value.id) || !Number.isSafeInteger(value.amount) || (value.amount as number) < 0 || typeof value.currency !== "string" || !identifier(value.provider) || !identifier(value.status) || !Number.isSafeInteger(value.refunded_amount) || (value.refunded_amount as number) < 0 || !stringMap(value.metadata)) return null;
  return {id: value.id, amount: value.amount as number, currency: value.currency, provider: value.provider, status: value.status, refunded_amount: value.refunded_amount as number, metadata: value.metadata};
}

/** Verify exact raw bytes with the full whsec_ UTF-8 key; WebCrypto verifies the MAC in constant time. */
export async function verifySnapSignature(raw: Uint8Array, header: string, secret: string, now = Date.now()): Promise<boolean> {
  const parts = header.split(",").map(part => part.trim().split("="));
  if (parts.length !== 2 || parts.some(p => p.length !== 2)) return false;
  const timestamp = parts.find(p => p[0] === "t")?.[1];
  const signed = parts.find(p => p[0] === "v1" || p[0] === "v2");
  if (!timestamp || !/^[0-9]+$/.test(timestamp) || !signed) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || Math.abs(Math.floor(now / 1000) - seconds) > 300) return false;
  const expectedLength = signed[0] === "v2" ? 128 : 64;
  if (signed[1].length !== expectedLength || !/^[a-f0-9]+$/i.test(signed[1])) return false;
  const signature = Uint8Array.from(signed[1].match(/../g)!, byte => parseInt(byte, 16));
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const message = new Uint8Array(prefix.length + raw.length);
  message.set(prefix); message.set(raw, prefix.length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name: "HMAC", hash: signed[0] === "v2" ? "SHA-512" : "SHA-256"}, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, signature, message);
}

export async function snapRequest(config: SnapConfig, path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init, headers: {...init.headers, Authorization: `Bearer ${config.secretKey}`, "Content-Type": "application/json"},
    redirect: "error", signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`SNAP ${path} HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}
