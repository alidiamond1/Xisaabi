"use client";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { ArrowDown, ArrowUp, Download, Store } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DataTable, EmptyState, PageHeader, Panel, Pill, SearchInput } from "@/components/common";
import { HealthPill, SEL, downloadCsv, useNow } from "@/components/platform";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PRESETS } from "@/convex/shared/presets";
import { formatCents } from "@/convex/shared/money";
import { businessStatus, fmtDate } from "@/lib/session";

type Status = "" | "ACTIVE" | "SUSPENDED" | "TRIAL" | "EXPIRED";
type Health = "" | "ACTIVE" | "QUIET" | "DORMANT" | "NEW";
type SortKey = "name" | "plan" | "status" | "ends" | "lastSale" | "gmv" | "staff" | "health";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" }, { key: "plan", label: "Plan" }, { key: "status", label: "Status" }, { key: "ends", label: "Ends" },
  { key: "lastSale", label: "Last sale" }, { key: "gmv", label: "Sales 30d" }, { key: "staff", label: "Staff" }, { key: "health", label: "Health" },
];
const HEALTH_RANK = { ACTIVE: 0, QUIET: 1, DORMANT: 2, NEW: 3 };

export default function BusinessesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const now = useNow();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("");
  const [planId, setPlanId] = useState("");
  const [type, setType] = useState("");
  const [city, setCity] = useState("");
  const [health, setHealth] = useState<Health>((params.get("health") as Health) ?? "");
  const [sort, setSort] = useState<SortKey>("name");
  const [asc, setAsc] = useState(true);
  const plans = useQuery(api.platformPlans.list);
  const raw = useQuery(api.platformTenants.list, {
    now, search: search || undefined, status: status || undefined, planId: (planId || undefined) as Id<"plans"> | undefined,
    type: type || undefined, health: health || undefined,
  });
  // city is filtered here so the city list stays complete while one is selected
  const cities = useMemo(() => [...new Set((raw ?? []).map((b) => b.city))].sort(), [raw]);
  const rows = useMemo(() => {
    if (!raw) return undefined;
    const val = (b: NonNullable<typeof raw>[number]): string | number => ({
      name: b.name.toLowerCase(), plan: b.planName.toLowerCase(), status: b.displayStatus, ends: b.subscriptionEndsAt,
      lastSale: b.stats?.lastSaleAt ?? 0, gmv: b.stats?.sales30dCents ?? 0, staff: b.staffCount, health: HEALTH_RANK[b.health],
    })[sort];
    return raw.filter((b) => !city || b.city === city).sort((x, y) => {
      const a = val(x), b = val(y);
      return (a < b ? -1 : a > b ? 1 : 0) * (asc ? 1 : -1);
    });
  }, [raw, city, sort, asc]);

  function exportCsv() {
    if (!rows) return;
    downloadCsv("businesses.csv", [
      ["Name", "Type", "City", "Phone", "Owner", "Plan", "Status", "Ends", "Last sale", "Sales 30d (cents)", "Staff", "Health"],
      ...rows.map((b) => [b.name, b.businessType, b.city, b.phone, b.ownerName, b.planName, b.displayStatus,
        new Date(b.subscriptionEndsAt).toISOString().slice(0, 10), b.stats?.lastSaleAt ? new Date(b.stats.lastSaleAt).toISOString().slice(0, 10) : "",
        b.stats?.sales30dCents ?? 0, b.staffCount, b.health]),
    ]);
  }

  return (
    <>
      <PageHeader title="Businesses" desc="Every shop on the platform."
        actions={<Button variant="outline" onClick={exportCsv} disabled={!rows?.length}><Download /> Export CSV</Button>} />
      <Panel>
        <div className="space-y-2 border-b p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, phone or city" className="sm:w-full" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as Status)} className={SEL}>
              <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="TRIAL">Trial</option><option value="EXPIRED">Expired</option><option value="SUSPENDED">Suspended</option>
            </select>
            <select aria-label="Plan" value={planId} onChange={(e) => setPlanId(e.target.value)} className={SEL}>
              <option value="">All plans</option>{plans?.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
            <select aria-label="Business type" value={type} onChange={(e) => setType(e.target.value)} className={SEL}>
              <option value="">All types</option>{PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <select aria-label="City" value={city} onChange={(e) => setCity(e.target.value)} className={SEL}>
              <option value="">All cities</option>{city && !cities.includes(city) && <option>{city}</option>}{cities.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select aria-label="Health" value={health} onChange={(e) => setHealth(e.target.value as Health)} className={SEL}>
              <option value="">Any health</option><option value="ACTIVE">Active</option><option value="QUIET">Quiet</option><option value="DORMANT">Dormant</option><option value="NEW">New</option>
            </select>
            <div className="flex gap-1">
              <select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={`${SEL} flex-1`}>
                {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
              </select>
              <Button variant="outline" size="icon" aria-label={asc ? "Ascending" : "Descending"} onClick={() => setAsc(!asc)}>{asc ? <ArrowUp /> : <ArrowDown />}</Button>
            </div>
          </div>
        </div>
        <DataTable
          rows={rows}
          onRowClick={(b) => router.push(`/platform/businesses/${b._id}`)}
          empty={<EmptyState icon={Store} title="No businesses found" desc="Try clearing a filter." />}
          cols={[
            {
              header: "Business", cell: (b) => (
                <span className="flex items-center gap-3">
                  <Avatar className="size-9 rounded-lg"><AvatarImage src={b.logoUrl ?? undefined} alt="" /><AvatarFallback className="rounded-lg"><Store className="size-4" /></AvatarFallback></Avatar>
                  <span className="min-w-0 text-left"><span className="block font-medium">{b.name}</span><span className="text-xs font-normal text-muted-foreground">{b.businessType} · {b.city}</span></span>
                </span>
              ),
            },
            { header: "Plan", cell: (b) => b.planName },
            { header: "Status", cell: (b) => { const s = businessStatus(b); return <Pill tone={s.tone}>{s.label}</Pill>; } },
            { header: "Ends", cell: (b) => fmtDate(b.subscriptionEndsAt) },
            { header: "Last sale", cell: (b) => b.stats?.lastSaleAt ? fmtDate(b.stats.lastSaleAt) : <span className="text-muted-foreground">never</span> },
            { header: "Sales 30d", className: "text-right", cell: (b) => <span className="tabular-nums">{formatCents(b.stats?.sales30dCents ?? 0)}</span> },
            { header: "Staff", className: "text-right", cell: (b) => b.staffCount },
            { header: "Health", cell: (b) => <HealthPill h={b.health} /> },
          ]}
        />
      </Panel>
    </>
  );
}
