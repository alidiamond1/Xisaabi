"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { Lock, LogIn } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { EmptyState, ListSkeleton, PageHeader, Panel, Pill } from "@/components/common";
import { ActivityFeed, useNow } from "@/components/platform";
import { fmtDateTime } from "@/lib/session";

export default function SecurityPage() {
  const now = useNow();
  const logins = useQuery(api.platformSecurity.recentLogins, { limit: 50 });
  const locks = useQuery(api.platformSecurity.lockouts, { now });
  return (
    <>
      <PageHeader title="Security" desc="Sign-ins, lockouts and platform admin changes." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="lg:col-span-2">
          <div className="border-b p-4 font-semibold">Locked out right now</div>
          {!locks ? <ListSkeleton rows={2} /> : locks.length === 0 ? <EmptyState icon={Lock} title="No lockouts" desc="Too many wrong passwords lock a login for a while." /> : (
            <ul className="divide-y">
              {locks.map((l) => (
                <li key={l.identifier} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                  <span className="min-w-0"><span className="block font-medium">@{l.identifier}{l.fullName && ` · ${l.fullName}`}</span><span className="text-xs text-muted-foreground">Last attempt {fmtDateTime(l.lastAttemptAt)}</span></span>
                  <span className="flex items-center gap-2">{l.role && <Pill tone="slate">{l.role}</Pill>}<Pill tone="amber">Unlocks about {fmtDateTime(l.unlocksAt)}</Pill></span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel>
          <div className="border-b p-4 font-semibold">Recent logins</div>
          {!logins ? <ListSkeleton /> : logins.length === 0 ? <EmptyState icon={LogIn} title="No logins yet" /> : (
            <ul className="max-h-[32rem] divide-y overflow-y-auto">
              {logins.map((l) => (
                <li key={l.sessionId} className="p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{l.fullName ?? "Unknown"}{l.username && <span className="font-normal text-muted-foreground"> @{l.username}</span>}</span>
                    {l.role && <Pill tone={l.businessId ? "slate" : "indigo"}>{l.role.replace("_", " ")}</Pill>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {fmtDateTime(l.at)}
                    {l.businessId && <> · <Link href={`/platform/businesses/${l.businessId}`} className="text-brand-700 hover:underline">{l.businessName}</Link></>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel>
          <div className="border-b p-4 font-semibold">Platform admin actions</div>
          <div className="max-h-[32rem] overflow-y-auto"><ActivityFeed filters={{ module: "platformStaff" }} showBusiness={false} /></div>
        </Panel>
      </div>
    </>
  );
}
