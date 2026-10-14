// Offline support for the POS: catalog cache + sale outbox, both in IndexedDB.
// Sales are saved here BEFORE being sent; they leave only on success or on a domain error.
import { get, set, del, keys, clear, createStore } from "idb-keyval";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type CatalogItem = FunctionReturnType<typeof api.products.posCatalog>[number];
export type CategoryItem = { _id: Id<"categories">; name: string; parentId?: Id<"categories"> };

export type PayMethod = "CASH" | "EVC" | "ZAAD" | "EDAHAB" | "BANK" | "CREDIT";

export type OutboxSale = {
  v: 2; // older (v1) entries in a device's outbox are dropped: their shape no longer matches the server
  clientSaleId: string;
  businessId?: string; // sales queued by another business on this device wait for that business to sign in again
  items: { productId: Id<"products">; qty: number; discountCents: number; unitName?: string; serials?: string[] }[];
  orderDiscountCents: number;
  payments: { method: PayMethod; amountCents: number; reference?: string }[];
  customerId?: Id<"customers">;
  note?: string;
  createdAt: number;
  // local snapshot for a provisional receipt
  snapshot: {
    lines: { name: string; qty: number; priceCents: number; discountCents: number; unitName?: string; serials?: string[]; warrantyUntil?: number }[];
    taxCents: number;
    totalCents: number;
    changeCents: number;
    customerName?: string;
  };
};

export type CreateSaleFn = (a: Omit<OutboxSale, "snapshot" | "v">) => Promise<{ saleId: Id<"sales">; receiptNo: number; duplicate: boolean }>;

export type FlushResult =
  | { sale: OutboxSale; ok: true; saleId: Id<"sales">; receiptNo: number }
  | { sale: OutboxSale; ok: false; error: unknown };

// Separate stores so a missing IndexedDB (private mode) fails softly in one place.
const catalogStore = typeof indexedDB !== "undefined" ? createStore("dukaan-catalog", "kv") : undefined;
const outboxStore = typeof indexedDB !== "undefined" ? createStore("dukaan-outbox", "sales") : undefined;
const CHANGED = "dukaan-outbox-changed";
const notify = () => typeof window !== "undefined" && window.dispatchEvent(new Event(CHANGED));

// Keys carry a version so a cache written by an older app version is never read with the wrong shape.
export async function saveCatalog<T = CatalogItem[]>(key: string, items: T) {
  try { await set(`v2:${key}`, items, catalogStore); } catch { /* cache is best-effort */ }
}
export async function loadCatalog<T = CatalogItem[]>(key: string): Promise<T | undefined> {
  try { return await get<T>(`v2:${key}`, catalogStore); } catch { return undefined; }
}

export async function addToOutbox(sale: OutboxSale) {
  await set(sale.clientSaleId, sale, outboxStore);
  notify();
}
export async function discardFromOutbox(id: string) {
  await del(id, outboxStore);
  notify();
}
export async function listOutbox(): Promise<OutboxSale[]> {
  try {
    const ids = await keys<string>(outboxStore);
    const all = await Promise.all(ids.map((k) => get<OutboxSale>(k, outboxStore)));
    return all.filter((s): s is OutboxSale => !!s && s.v === 2).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}
/**
 * On sign-out: wipe the cached catalog (prices/costs of this shop) from the device.
 * Queued unsynced sales are kept: dropping them would lose money, and they are only
 * readable by the next user of this device via the POS outbox. Returns how many are left.
 */
export async function clearOnLogout(): Promise<number> {
  try { await clear(catalogStore); } catch { /* best-effort */ }
  return (await listOutbox()).length;
}
export function onOutboxChange(cb: () => void) {
  window.addEventListener(CHANGED, cb);
  return () => window.removeEventListener(CHANGED, cb);
}

/** ConvexError (domain rule) carries `data`; network/timeouts do not. */
export function isDomainError(e: unknown) {
  return typeof e === "object" && e !== null && "data" in e && (e as { data: unknown }).data !== undefined;
}

const TIMEOUT_MS = 15_000;
function withTimeout<T>(p: Promise<T>): Promise<T> {
  // Convex queues mutations while disconnected instead of rejecting; treat a stall as a network error.
  // The queued call stays idempotent on clientSaleId, so a later duplicate is harmless.
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS))]);
}

let chain: Promise<unknown> = Promise.resolve();

/** Send every queued sale, oldest first. Runs one flush at a time. Stops at the first network error. */
export function flushOutbox(create: CreateSaleFn, businessId: string): Promise<FlushResult[]> {
  const next = chain.then(async () => {
    const results: FlushResult[] = [];
    if (typeof navigator !== "undefined" && !navigator.onLine) return results;
    for (const sale of await listOutbox()) {
      if (sale.businessId && sale.businessId !== businessId) continue;
      const { snapshot, v, businessId: _b, ...args } = sale;
      void snapshot;
      void v;
      void _b;
      try {
        const r = await withTimeout(create(args));
        await discardFromOutbox(sale.clientSaleId);
        results.push({ sale, ok: true, saleId: r.saleId, receiptNo: r.receiptNo });
      } catch (error) {
        if (isDomainError(error)) {
          await discardFromOutbox(sale.clientSaleId);
          results.push({ sale, ok: false, error });
        } else {
          break; // network: keep it and everything after it, retry later
        }
      }
    }
    return results;
  });
  chain = next.catch(() => undefined);
  return next;
}
