import { DAY_MS } from "./expiry";

export type Health = "ACTIVE" | "QUIET" | "DORMANT" | "NEW";

/** Business activity from its last sale: ACTIVE ≤7d, QUIET ≤30d, else DORMANT; NEW = created ≤7d ago with no sale. */
export function healthOf(createdAt: number, lastSaleAt: number | undefined, now: number): Health {
  if (lastSaleAt === undefined) return createdAt >= now - 7 * DAY_MS ? "NEW" : "DORMANT";
  const age = now - lastSaleAt;
  return age <= 7 * DAY_MS ? "ACTIVE" : age <= 30 * DAY_MS ? "QUIET" : "DORMANT";
}
