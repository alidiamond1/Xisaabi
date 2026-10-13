"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PageHeader, Panel } from "@/components/common";
import { ActivityFeed, SEL, useNow, type ActivityRow } from "@/components/platform";
import { Input } from "@/components/ui/input";
import { dayEnd, dayStart } from "@/lib/session";

export default function ActivityPage() {
  const now = useNow();
  const [businessId, setBusinessId] = useState("");
  const [module, setModule] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [actors, setActors] = useState<Map<string, string>>(new Map());
  const modules = useQuery(api.platformActivity.modules);
  const businesses = useQuery(api.platformTenants.list, { now });

  // actor choices are collected from the rows seen so far (there is no list of every business user)
  const collect = (rows: ActivityRow[]) => setActors((prev) => {
    const missing = rows.filter((r) => !prev.has(r.actorMemberId));
    if (!missing.length) return prev;
    const n = new Map(prev);
    missing.forEach((r) => n.set(r.actorMemberId, r.actorName));
    return n;
  });

  return (
    <>
      <PageHeader title="Activity" desc="Every change on the platform, live." />
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
        <select aria-label="Business" value={businessId} onChange={(e) => setBusinessId(e.target.value)} className={`${SEL} col-span-2 lg:col-span-1`}>
          <option value="">All businesses</option>{businesses?.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
        </select>
        <select aria-label="Module" value={module} onChange={(e) => setModule(e.target.value)} className={SEL}>
          <option value="">All modules</option>{modules?.map((m) => <option key={m}>{m}</option>)}
        </select>
        <select aria-label="Who" value={actor} onChange={(e) => setActor(e.target.value)} className={SEL}>
          <option value="">Anyone</option>{[...actors].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <Input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 text-base md:h-9 md:text-sm" />
        <Input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 text-base md:h-9 md:text-sm" />
      </div>
      <Panel>
        <ActivityFeed onRows={collect}
          filters={{
            businessId: (businessId || undefined) as Id<"businesses"> | undefined, module: module || undefined,
            actorMemberId: (actor || undefined) as Id<"members"> | undefined, from: from ? dayStart(from) : undefined, to: to ? dayEnd(to) : undefined,
          }} />
      </Panel>
    </>
  );
}
