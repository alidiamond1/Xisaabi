import { create } from "zustand";
import type { Id } from "@/convex/_generated/dataModel";

/** Discount entered by the cashier: fixed money (cents) or a percent of the base it applies to. */
export type Disc = { kind: "AMT" | "PCT"; value: number };

export type CartLine = {
  productId: Id<"products">;
  name: string;
  unit: string;
  allowDecimal: boolean;
  retailCents: number;
  wholesaleCents?: number;
  /** stock on hand when added; null = not counted (service) */
  stock: number | null;
  qty: number;
  disc?: Disc;
  /** v3: sold in a pack ("box"); qty and prices are per pack, stock moves qty x unitFactor base units */
  unitName?: string;
  unitFactor?: number;
  /** v3: IMEI / serial numbers; qty always equals their count */
  serials?: string[];
  warrantyMonths?: number;
};

/** One cart line per product + pack. */
export const lineKey = (l: { productId: string; unitName?: string }) => `${l.productId}|${l.unitName ?? ""}`;
/** Base units a line takes out of stock. */
export const baseQty = (l: Pick<CartLine, "qty" | "unitFactor">) => roundQty(l.qty * (l.unitFactor ?? 1));

export type CartCustomer = {
  id: Id<"customers">;
  name: string;
  phone: string;
  group: "RETAIL" | "WHOLESALE" | "VIP";
  balanceCents: number;
  creditLimitCents: number;
  creditBlocked: boolean;
};

export type CartSnapshot = { lines: CartLine[]; orderDisc?: Disc; customer?: CartCustomer; note: string };

type CartState = CartSnapshot & {
  add: (l: Omit<CartLine, "qty" | "disc">, qty?: number) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  setLineDisc: (key: string, d?: Disc) => void;
  /** replace the serials of a serial line (qty follows); none = remove the line */
  setSerials: (key: string, serials: string[]) => void;
  setOrderDisc: (d?: Disc) => void;
  setCustomer: (c?: CartCustomer) => void;
  setNote: (n: string) => void;
  restore: (s: CartSnapshot) => void;
  clear: () => void;
};

export const roundQty = (n: number) => Math.round(n * 1000) / 1000;

export const useCart = create<CartState>((set) => ({
  lines: [],
  note: "",
  add: (l, qty = 1) =>
    set((s) => {
      const k = lineKey(l);
      const have = s.lines.find((x) => lineKey(x) === k);
      if (l.serials) {
        const serials = [...new Set([...(have?.serials ?? []), ...l.serials])];
        return have
          ? { lines: s.lines.map((x) => (x === have ? { ...x, serials, qty: serials.length } : x)) }
          : { lines: [...s.lines, { ...l, serials, qty: serials.length }] };
      }
      return have
        ? { lines: s.lines.map((x) => (x === have ? { ...x, qty: roundQty(x.qty + qty) } : x)) }
        : { lines: [...s.lines, { ...l, qty }] };
    }),
  setQty: (key, qty) =>
    set((s) => ({ lines: qty <= 0 ? s.lines.filter((x) => lineKey(x) !== key) : s.lines.map((x) => (lineKey(x) === key ? { ...x, qty: roundQty(qty) } : x)) })),
  remove: (key) => set((s) => ({ lines: s.lines.filter((x) => lineKey(x) !== key) })),
  setLineDisc: (key, disc) => set((s) => ({ lines: s.lines.map((x) => (lineKey(x) === key ? { ...x, disc } : x)) })),
  setSerials: (key, serials) =>
    set((s) => ({ lines: serials.length === 0 ? s.lines.filter((x) => lineKey(x) !== key) : s.lines.map((x) => (lineKey(x) === key ? { ...x, serials, qty: serials.length } : x)) })),
  setOrderDisc: (orderDisc) => set({ orderDisc }),
  setCustomer: (customer) => set({ customer }),
  setNote: (note) => set({ note }),
  restore: (s) => set({ lines: s.lines, orderDisc: s.orderDisc, customer: s.customer, note: s.note }),
  clear: () => set({ lines: [], orderDisc: undefined, customer: undefined, note: "" }),
}));

/** Price the customer pays per unit: wholesale price for WHOLESALE customers when the product has one. */
export const unitPrice = (l: CartLine, wholesale: boolean) => (wholesale && l.wholesaleCents !== undefined ? l.wholesaleCents : l.retailCents);

/** Percent rounds DOWN so we never exceed what the cashier meant (the server compares exact cents). */
export const discCents = (d: Disc | undefined, base: number) =>
  !d ? 0 : Math.max(0, Math.min(base, d.kind === "AMT" ? Math.round(d.value) : Math.floor((base * d.value) / 100)));

/** Same rules as the backend (`sales.create`): line discounts, then order discount, then tax. */
export function totals(lines: CartLine[], orderDisc: Disc | undefined, taxRatePercent: number, wholesale: boolean) {
  const rows = lines.map((l) => {
    const price = unitPrice(l, wholesale);
    const gross = Math.round(price * l.qty);
    const discount = discCents(l.disc, gross);
    return { price, gross, discount, net: gross - discount };
  });
  const grossCents = rows.reduce((n, r) => n + r.gross, 0);
  const lineDiscountCents = rows.reduce((n, r) => n + r.discount, 0);
  const subtotalCents = grossCents - lineDiscountCents;
  const orderDiscountCents = discCents(orderDisc, subtotalCents);
  const taxCents = Math.round(((subtotalCents - orderDiscountCents) * taxRatePercent) / 100);
  const totalCents = subtotalCents - orderDiscountCents + taxCents;
  const discountPercent = grossCents > 0 ? ((lineDiscountCents + orderDiscountCents) * 100) / grossCents : 0;
  return { rows, grossCents, lineDiscountCents, subtotalCents, orderDiscountCents, taxCents, totalCents, discountPercent };
}

/** 1.25 -> "1.25", 2 -> "2" */
export const fmtQty = (q: number) => String(roundQty(q));
