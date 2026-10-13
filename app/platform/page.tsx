"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { usePlatform } from "@/components/guard";
import { PLATFORM_APPS } from "@/lib/apps";
import { cn } from "@/lib/utils";

export default function PlatformLauncher() {
  const me = usePlatform();
  const [now] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
  const stats = useQuery(api.platformStats.overview, { now });
  const apps = PLATFORM_APPS.filter((a) => !a.superOnly || me.member.role === "SUPER_ADMIN");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Hello, {me.member.fullName.split(" ")[0]}</h1>
        <p className="text-sm text-muted-foreground">
          {me.member.role === "SUPER_ADMIN" ? "Super admin" : "Platform admin"}
          {stats && ` · ${stats.counts.total} businesses · ${stats.openTickets} open tickets`}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {apps.map((a) => (
          <Link key={a.key} href={a.href} className="group flex flex-col items-center rounded-xl border bg-white p-5 text-center transition hover:border-indigo-300 hover:shadow-sm">
            <span className={cn("grid size-16 place-items-center rounded-2xl transition group-hover:scale-105", a.tile)}><a.icon className="size-8" /></span>
            <span className="mt-3 text-sm font-semibold">{a.name}</span>
            <span className="text-xs text-muted-foreground">{a.desc}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
