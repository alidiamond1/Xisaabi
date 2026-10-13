"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { ChevronDown, FileClock } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { EmptyState, Field, ListSkeleton, Pill, SubmitButton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/convex/shared/money";
import { fmtDate } from "@/lib/session";
import { cn } from "@/lib/utils";

/** Native select styled like the rest of the platform filters (44px tap target on phones). */
export const SEL = "h-11 min-w-0 rounded-lg border bg-card px-2 text-base md:h-9 md:text-sm";

/** Client time rounded to the minute, as the backend queries expect. Stable for the page's life. */
export function useNow() {
  return useState(() => Math.floor(Date.now() / 60_000) * 60_000)[0];
}

/** Download rows as a CSV file (client Blob, no lib). */
export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const esc = (c: string | number | null | undefined) => `"${String(c ?? "").replace(/"/g, '""')}"`;
  const url = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const HEALTH = { ACTIVE: "green", QUIET: "amber", DORMANT: "red", NEW: "blue" } as const;
export function HealthPill({ h }: { h: keyof typeof HEALTH }) {
  return <Pill tone={HEALTH[h]} dot>{h.charAt(0) + h.slice(1).toLowerCase()}</Pill>;
}

/** "3 d", "5 h" since a timestamp. */
export function ago(t: number, now = Date.now()) {
  const m = Math.max(0, Math.floor((now - t) / 60_000));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`;
}

/** Audit `changes` value: money for ...Cents, dates for ...At epochs. */
function fmtVal(field: string, v: string) {
  if (v === "") return "(empty)";
  const n = Number(v);
  if (field.endsWith("Cents") && Number.isFinite(n)) return formatCents(n);
  if (field.endsWith("At") && Number.isFinite(n) && n > 1e11) return fmtDate(n);
  return v;
}

type Filters = { businessId?: Id<"businesses">; module?: string; actorMemberId?: Id<"members">; from?: number; to?: number };
export type ActivityRow = NonNullable<ReturnType<typeof usePaginatedQuery<typeof api.platformActivity.list>>["results"]>[number];

/** Live activity feed grouped by day, with expandable "field: from → to" diffs. */
export function ActivityFeed({ filters, showBusiness = true, onRows }: { filters: Filters; showBusiness?: boolean; onRows?: (rows: ActivityRow[]) => void }) {
  const { results, status, loadMore } = usePaginatedQuery(api.platformActivity.list, filters, { initialNumItems: 40 });
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => { onRows?.(results); }, [results, onRows]);
  if (status === "LoadingFirstPage") return <ListSkeleton />;
  if (results.length === 0) return <EmptyState icon={FileClock} title="No activity" desc="Nothing matches these filters yet." />;
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  let lastDay = "";
  return (
    <div>
      <ul>
        {results.map((r) => {
          const day = new Date(r.createdAt).toDateString();
          const head = day !== lastDay;
          lastDay = day;
          const has = !!r.changes?.length;
          return (
            <li key={r._id}>
              {head && <p className="border-y bg-muted/50 px-4 py-1.5 text-xs font-semibold text-muted-foreground first:border-t-0">{fmtDate(r.createdAt)}</p>}
              <div className="border-b px-4 py-3 text-sm last:border-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Pill tone="indigo">{r.action}</Pill>
                  {r.targetName && <span className="font-medium">{r.targetName}</span>}
                  <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <p className="mt-1 break-words text-muted-foreground">
                  {r.actorName}
                  {showBusiness && r.businessId && <> · <Link href={`/platform/businesses/${r.businessId}`} className="text-brand-700 hover:underline">{r.businessName ?? "business"}</Link></>}
                  {r.details && <> · {r.details}</>}
                </p>
                {has && (
                  <>
                    <button type="button" onClick={() => toggle(r._id)} aria-expanded={open.has(r._id)}
                      className="mt-1 inline-flex min-h-8 items-center gap-1 text-xs font-medium text-brand-700">
                      {r.changes!.length} change{r.changes!.length === 1 ? "" : "s"}<ChevronDown className={cn("size-3.5 transition", open.has(r._id) && "rotate-180")} />
                    </button>
                    {open.has(r._id) && (
                      <ul className="mt-1 space-y-1 rounded-lg bg-muted/60 p-2.5 text-xs">
                        {r.changes!.map((c) => (
                          <li key={c.field} className="break-words"><span className="font-medium">{c.field}:</span> {fmtVal(c.field, c.from)} <span aria-label="to">→</span> {fmtVal(c.field, c.to)}</li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {status === "CanLoadMore" && <div className="p-3 text-center"><Button variant="outline" onClick={() => loadMore(40)}>Load more</Button></div>}
      {status === "LoadingMore" && <ListSkeleton rows={2} />}
    </div>
  );
}

/** Ask for a new password (min 8). `submit` resolves true on success. */
export function PasswordDialog({ open, onClose, title, submit }: { open: boolean; onClose: () => void; title: string; submit: (pw: string) => Promise<boolean> }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); const ok = await submit(pw); setBusy(false); if (ok) { setPw(""); onClose(); } }} className="space-y-4">
          <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>They are signed out everywhere. Share the new password with them yourself.</DialogDescription></DialogHeader>
          <Field label="New password" hint="At least 8 characters."><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required /></Field>
          <DialogFooter><SubmitButton type="submit" busy={busy} disabled={pw.length < 8}>Reset password</SubmitButton></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Reason prompt for voiding a payment. `submit` resolves true on success. */
export function VoidDialog({ open, onClose, submit }: { open: boolean; onClose: () => void; submit: (reason: string) => Promise<boolean> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Void this payment?</DialogTitle><DialogDescription>It stops counting in totals and the months it bought are taken back from the subscription.</DialogDescription></DialogHeader>
        <Field label="Reason" required><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton variant="destructive" busy={busy} disabled={!reason.trim()} onClick={async () => { setBusy(true); const ok = await submit(reason.trim()); setBusy(false); if (ok) { setReason(""); onClose(); } }}>Void payment</SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
