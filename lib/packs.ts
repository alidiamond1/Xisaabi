// Small helpers for packs (units) and serial numbers, shared by the product form, POS and receiving.

export type PackUnit = { name: string; factor: number; barcode: string; priceCents?: number };

/** Price of one pack: its own price, else factor x the base price (same rule as the server). */
export const packPrice = (u: PackUnit, baseCents: number) => u.priceCents ?? Math.round(u.factor * baseCents);

/** Calendar months later, for "warranty until" on a provisional receipt. */
export function addMonths(t: number, months: number) {
  const d = new Date(t);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
}

/** Split typed/pasted text into unique serials: one per line, comma or space; trimmed and uppercase like the server. */
export function parseSerials(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
}

const luhn = (s: string) => {
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    let d = Number(s[s.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
};

/** Hint for the user while typing; the server is still the judge. */
export function serialProblem(s: string): string | null {
  if (!/^[A-Z0-9][A-Z0-9\-_./]{0,63}$/.test(s)) return "Letters, numbers and - _ . / only";
  if (/^\d{15}$/.test(s) && !luhn(s)) return "Not a valid IMEI (check the digits)";
  return null;
}
