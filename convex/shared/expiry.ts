// Shared by Convex functions AND the UI. Status is computed, never stored.

export type ExpiryStatus = "OK" | "3_MONTHS" | "1_MONTH" | "EXPIRED";
export const DAY_MS = 86_400_000;

export function daysLeft(expiryDate: number, now = Date.now()): number {
  return Math.ceil((expiryDate - now) / DAY_MS);
}

export function expiryStatus(expiryDate: number | undefined, now = Date.now()): ExpiryStatus {
  if (expiryDate === undefined) return "OK";
  const d = daysLeft(expiryDate, now);
  if (d <= 0) return "EXPIRED"; // POS must block the sale
  if (d <= 30) return "1_MONTH";
  if (d <= 90) return "3_MONTHS";
  return "OK";
}
