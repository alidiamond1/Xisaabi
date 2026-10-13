"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { Store } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { DataTable, EmptyState, PageHeader, Panel, Pill } from "@/components/common";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { businessStatus, fmtDate } from "@/lib/session";

type Status = "" | "ACTIVE" | "SUSPENDED" | "TRIAL" | "EXPIRED";


export default function BusinessesPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("");
  const rows = useQuery(api.platformTenants.list, { search: search || undefined, status: status || undefined });
  return (
    <>
      <PageHeader title="Businesses" desc="Every shop on the platform." />
      <Panel>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <Input placeholder="Search name, phone or city" className="h-9 w-full sm:w-72" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as Status)} className="h-9 rounded-lg border bg-white px-2 text-sm">
            <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="TRIAL">Trial</option><option value="EXPIRED">Expired</option><option value="SUSPENDED">Suspended</option>
          </select>
        </div>
        <DataTable
          rows={rows}
          onRowClick={(b) => router.push(`/platform/businesses/${b._id}`)}
          empty={<EmptyState icon={Store} title="No businesses found" />}
          cols={[
            {
              header: "Business", cell: (b) => (
                <span className="flex items-center gap-3">
                  <Avatar className="size-9 rounded-lg"><AvatarImage src={b.logoUrl ?? undefined} alt="" /><AvatarFallback className="rounded-lg"><Store className="size-4" /></AvatarFallback></Avatar>
                  <span><span className="block font-medium">{b.name}</span><span className="text-xs text-muted-foreground">{b.businessType} · {b.city}</span></span>
                </span>
              ),
            },
            { header: "Owner", cell: (b) => <span>{b.ownerName ?? "-"}<span className="block text-xs text-muted-foreground">@{b.ownerUsername}</span></span> },
            { header: "Plan", cell: (b) => b.planName },
            { header: "Status", cell: (b) => { const s = businessStatus(b); return <Pill tone={s.tone}>{s.label}</Pill>; } },
            { header: "Staff", className: "text-right", cell: (b) => b.staffCount },
            { header: "Ends", cell: (b) => fmtDate(b.subscriptionEndsAt) },
          ]}
        />
      </Panel>
    </>
  );
}
