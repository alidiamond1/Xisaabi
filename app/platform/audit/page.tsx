"use client";
import { useQuery } from "convex/react";
import { FileClock } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { DataTable, EmptyState, PageHeader, Panel, Pill } from "@/components/common";
import { fmtDateTime } from "@/lib/session";

export default function AuditPage() {
  const rows = useQuery(api.platformAudit.list, {});
  return (
    <>
      <PageHeader title="Audit log" desc="The latest 200 actions across the platform." />
      <Panel>
        <DataTable
          rows={rows}
          empty={<EmptyState icon={FileClock} title="No activity yet" />}
          cols={[
            { header: "When", cell: (r) => fmtDateTime(r.createdAt) },
            { header: "Who", cell: (r) => r.actorName },
            { header: "Action", cell: (r) => <Pill tone="indigo">{r.action}</Pill> },
            { header: "Details", cell: (r) => r.details ?? <span className="text-muted-foreground">-</span> },
          ]}
        />
      </Panel>
    </>
  );
}
