"use client";
import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Inbox, Loader2, Search, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ page chrome */

/** Title row. `back` renders a quiet link above the title for detail pages. */
export function PageHeader({ title, desc, actions, back, meta }: {
  title: string; desc?: string; actions?: React.ReactNode; back?: { href: string; label: string }; meta?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      {back && (
        <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" />{back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>{meta}
          </div>
          {desc && <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("overflow-hidden rounded-xl border bg-card shadow-card", className)}>{children}</div>;
}

/** Grouped form block: title + helper on the left (md+), fields on the right. */
export function FormSection({ title, desc, children, className }: { title: string; desc?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("grid gap-3 border-b py-5 first:pt-0 last:border-0 md:grid-cols-[200px_1fr] md:gap-8", className)}>
      <div><h3 className="text-sm font-semibold">{title}</h3>{desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}</div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** Detail page: main column + sticky side summary (stacks on mobile). */
export function DetailLayout({ main, side }: { main: React.ReactNode; side: React.ReactNode }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-4">{main}</div>
      <aside className="space-y-4 lg:sticky lg:top-20">{side}</aside>
    </div>
  );
}

/** Label/value rows for side summaries. */
export function KeyValue({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="divide-y text-sm">
      {items.map((i) => (
        <div key={i.label} className="flex items-center justify-between gap-3 px-4 py-2.5">
          <dt className="text-muted-foreground">{i.label}</dt><dd className="text-right font-medium">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Banner({ tone = "info", icon: Icon, children }: { tone?: "danger" | "warning" | "info" | "success"; icon?: LucideIcon; children: React.ReactNode }) {
  const t = {
    danger: "border-danger/25 bg-danger-soft text-danger", warning: "border-warning/25 bg-warning-soft text-warning",
    info: "border-brand-200 bg-brand-50 text-brand-800", success: "border-success/25 bg-success-soft text-success",
  }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm", t)}>
      {Icon && <Icon className="mt-0.5 size-4 shrink-0" />}<p className="min-w-0 flex-1">{children}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ states */

export function EmptyState({ icon: Icon = Inbox, title, desc, action }: { icon?: LucideIcon; title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100"><Icon className="size-5" /></div>
      <p className="font-display text-base font-semibold">{title}</p>
      {desc && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{desc}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
    </div>
  );
}

/* ------------------------------------------------------------------ money */

/** Tabular figures. `tone="auto"` colors by sign of `cents`: green in, red out. */
export function Money({ children, className, cents, tone }: { children: React.ReactNode; className?: string; cents?: number; tone?: "auto" | "in" | "out" | "muted" }) {
  const t = tone === "auto" ? (cents && cents > 0 ? "in" : cents && cents < 0 ? "out" : "muted") : tone;
  return (
    <span className={cn("tnum tabular-nums", t === "in" && "text-success", t === "out" && "text-danger", t === "muted" && "text-muted-foreground", className)}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ forms */

export function Field({ label, hint, error, required, children, className }: {
  label: string; hint?: string; error?: string; required?: boolean; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{label}{required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}</span>
        {children}
      </label>
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SubmitButton({ busy, children, ...p }: React.ComponentProps<typeof Button> & { busy?: boolean }) {
  return (
    <Button disabled={busy || p.disabled} {...p}>
      {busy && <Loader2 className="animate-spin" />}
      {children}
    </Button>
  );
}

export function ConfirmDialog({
  open, onOpenChange, title, desc, confirmLabel = "Confirm", destructive = true, onConfirm,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; desc: string;
  confirmLabel?: string; destructive?: boolean; onConfirm: () => Promise<unknown> | void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{desc}</DialogDescription></DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <SubmitButton busy={busy} variant={destructive ? "destructive" : "default"}
            onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); onOpenChange(false); } }}>
            {confirmLabel}
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ table */

/** Search box for toolbars. */
export function SearchInput({ value, onChange, placeholder = "Search", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn("relative w-full sm:w-72", className)}>
      <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-9 text-base shadow-card outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm" />
      {value && <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted"><X className="size-4" /></button>}
    </div>
  );
}

/** Table toolbar row: search + filters on the left, actions on the right. */
export function Toolbar({ children, actions }: { children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-card p-3">
      <div className="flex min-w-0 basis-full flex-wrap items-center gap-2 sm:flex-1 sm:basis-0">{children}</div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Single-select pill filter. */
export function FilterChips<V extends string>({ options, value, onChange }: { options: { value: V; label: string }[]; value: V; onChange: (v: V) => void }) {
  return (
    <div className="flex max-w-full gap-1.5 overflow-x-auto" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
          className={cn("h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors",
            value === o.value ? "border-brand-600 bg-brand-600 text-white" : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type Col<T> = {
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string; // applied to th/td on desktop ("text-right" for numbers)
  hideOnCard?: boolean;
};

function Check({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} onClick={(e) => e.stopPropagation()} className="size-4 cursor-pointer accent-[var(--color-brand-600)]" />;
}

/**
 * Table on md+, stacked cards on phones. Client-side pagination (`pageSize`, default 25).
 * `bulkActions` turns on row selection and shows an action bar while rows are selected.
 */
export function DataTable<T extends { _id: string }>({
  rows, cols, onRowClick, empty, loading, pageSize = 25, bulkActions,
}: {
  rows: T[] | undefined; cols: Col<T>[]; onRowClick?: (r: T) => void; empty?: React.ReactNode; loading?: boolean;
  pageSize?: number; bulkActions?: (selected: T[], clear: () => void) => React.ReactNode;
}) {
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  if (rows === undefined || loading) return <ListSkeleton />;
  if (rows.length === 0) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const p = Math.min(page, pages - 1);
  const slice = rows.slice(p * pageSize, (p + 1) * pageSize);
  const selected = rows.filter((r) => sel.has(r._id));
  const allOnPage = slice.every((r) => sel.has(r._id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  const togglePage = () => setSel((s) => { const n = new Set(s); slice.forEach((r) => (allOnPage ? n.delete(r._id) : n.add(r._id))); return n; });
  const clear = () => setSel(new Set());

  return (
    <>
      {bulkActions && selected.length > 0 && (
        <div className="flex items-center gap-3 border-b bg-brand-50 px-4 py-2 text-sm">
          <span className="font-medium text-brand-800">{selected.length} selected</span>
          <div className="flex items-center gap-2">{bulkActions(selected, clear)}</div>
          <button type="button" onClick={clear} className="ml-auto text-muted-foreground hover:text-foreground">Clear</button>
        </div>
      )}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {bulkActions && <TableHead className="w-10"><Check checked={allOnPage} onChange={togglePage} label="Select all on page" /></TableHead>}
              {cols.map((c) => <TableHead key={c.header} className={c.className}>{c.header}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {slice.map((r) => (
              <TableRow key={r._id} data-state={sel.has(r._id) ? "selected" : undefined} className={onRowClick ? "cursor-pointer" : undefined} onClick={() => onRowClick?.(r)}>
                {bulkActions && <TableCell><Check checked={sel.has(r._id)} onChange={() => toggle(r._id)} label="Select row" /></TableCell>}
                {cols.map((c) => <TableCell key={c.header} className={c.className}>{c.cell(r)}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="divide-y md:hidden">
        {slice.map((r) => (
          <div key={r._id} className={cn("space-y-1.5 p-4", onRowClick && "cursor-pointer active:bg-muted")} onClick={() => onRowClick?.(r)}>
            {cols.filter((c) => !c.hideOnCard && c.header).map((c, i) => (
              <div key={c.header} className={cn("flex items-start justify-between gap-3 text-sm", i === 0 && "text-base font-medium")}>
                {i > 0 && <span className="shrink-0 text-muted-foreground">{c.header}</span>}
                <span className={cn("min-w-0", i > 0 && "text-right")}>{c.cell(r)}</span>
              </div>
            ))}
            {cols.filter((c) => !c.header && !c.hideOnCard).map((c, i) => <div key={i} className="pt-1 [&_button]:min-h-11">{c.cell(r)}</div>)}
          </div>
        ))}
      </div>
      {rows.length > pageSize && (
        <div className="flex items-center justify-between border-t px-4 py-2.5 text-sm text-muted-foreground">
          <span className="tnum">{p * pageSize + 1}-{Math.min(rows.length, (p + 1) * pageSize)} of {rows.length}</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Previous page" disabled={p === 0} onClick={() => setPage(p - 1)}><ChevronLeft /></Button>
            <Button variant="outline" size="icon" aria-label="Next page" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}><ChevronRight /></Button>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ badges & stats */

const TONES: Record<string, string> = {
  green: "bg-success-soft text-success", red: "bg-danger-soft text-danger", amber: "bg-warning-soft text-warning",
  blue: "bg-info-soft text-info", slate: "bg-muted text-slate-700", indigo: "bg-brand-100 text-brand-800", brand: "bg-brand-100 text-brand-800",
};
const DOTS: Record<string, string> = {
  green: "bg-success", red: "bg-danger", amber: "bg-warning", blue: "bg-info", slate: "bg-slate-400", indigo: "bg-brand-600", brand: "bg-brand-600",
};
/** Status badge. Always pair color with text (never color alone). `dot` adds a leading status dot. */
export function Pill({ tone = "slate", dot, children }: { tone?: keyof typeof TONES; dot?: boolean; children: React.ReactNode }) {
  return (
    <Badge variant="secondary" className={cn("h-6 gap-1.5 border-0 px-2.5 font-medium", TONES[tone])}>
      {dot && <span className={cn("size-1.5 rounded-full", DOTS[tone])} />}{children}
    </Badge>
  );
}
export const StatusBadge = Pill;

/** KPI card. `tone` is a text color class for the value; `icon` shows a quiet glyph. */
export function Stat({ label, value, sub, tone, icon: Icon }: { label: string; value: React.ReactNode; sub?: string; tone?: string; icon?: LucideIcon }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon && <Icon className="size-4 text-brand-600/70" />}
      </div>
      <p className={cn("mt-1.5 font-display text-2xl font-semibold tabular-nums tracking-tight", tone)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
export const StatCard = Stat;
