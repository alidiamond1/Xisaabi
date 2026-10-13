"use client";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SessionGuard } from "@/components/guard";

export default function AppsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <SessionGuard kind="business">
      {pathname === "/apps/pos" || pathname.startsWith("/apps/scan/") ? children : <AppShell side="business">{children}</AppShell>}
    </SessionGuard>
  );
}
