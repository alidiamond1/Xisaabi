"use client";
import { AppShell } from "@/components/app-shell";
import { SessionGuard } from "@/components/guard";

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionGuard kind="platform">
      <AppShell side="platform">{children}</AppShell>
    </SessionGuard>
  );
}
