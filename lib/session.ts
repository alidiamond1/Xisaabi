"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

export type Session = NonNullable<FunctionReturnType<typeof api.members.me>>;
export type BusinessSession = Extract<Session, { kind: "business" }>;
export type PlatformSession = Extract<Session, { kind: "platform" }>;

/** undefined = loading, null = logged out. */
export function useSession() {
  return useQuery(api.members.me);
}

export function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
export function fmtDateTime(ms: number) {
  return new Date(ms).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
/** yyyy-mm-dd <input type=date> value -> local ms (start or end of day) */
export function dayStart(s: string) { return new Date(s + "T00:00:00").getTime(); }
export function dayEnd(s: string) { return new Date(s + "T23:59:59.999").getTime(); }
export function isoDay(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function businessStatus(b: { status: string; subscriptionStatus: string; subscriptionEndsAt: number }) {
  if (b.status === "SUSPENDED") return { label: "Suspended", tone: "red" as const };
  if (b.subscriptionEndsAt < Date.now()) return { label: "Expired", tone: "amber" as const };
  if (b.subscriptionStatus === "TRIAL") return { label: "Trial", tone: "blue" as const };
  return { label: "Active", tone: "green" as const };
}
