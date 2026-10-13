// All money is integer cents. Convert only at the UI edge.

export function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/** "12.5" → 1250. Returns null for invalid/negative input. */
export function parseToCents(input: string): number | null {
  const s = input.trim();
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}
