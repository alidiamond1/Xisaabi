"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PageHeader, Pill } from "@/components/common";
import { StatusPill, Thread, TicketLayout, type TicketRow } from "@/components/tickets";
import { act } from "@/lib/run";

type Status = "" | "OPEN" | "ANSWERED" | "CLOSED";

export default function PlatformSupportPage() {
  const [status, setStatus] = useState<Status>("");
  const tickets = useQuery(api.platformSupport.list, { status: status || undefined });
  const [selected, setSelected] = useState<string | null>(null);
  const rows: TicketRow[] | undefined = tickets?.map((t) => ({ ...t, unread: t.unreadByPlatform, sub: t.businessName }));
  return (
    <>
      <PageHeader title="Support inbox" desc="Tickets from every business."
        actions={
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as Status)} className="h-9 rounded-lg border bg-white px-2 text-sm">
            <option value="">All statuses</option><option value="OPEN">Open</option><option value="ANSWERED">Answered</option><option value="CLOSED">Closed</option>
          </select>
        } />
      <TicketLayout tickets={rows} selected={selected} onSelect={setSelected}>
        {selected && <PlatformThread key={selected} id={selected as Id<"tickets">} />}
      </TicketLayout>
    </>
  );
}

function PlatformThread({ id }: { id: Id<"tickets"> }) {
  const data = useQuery(api.platformSupport.get, { ticketId: id });
  const markRead = useMutation(api.platformSupport.markRead);
  const reply = useMutation(api.platformSupport.reply);
  const setStatus = useMutation(api.platformSupport.setStatus);
  const unread = data?.ticket.unreadByPlatform;
  useEffect(() => { if (unread) markRead({ ticketId: id }).catch(() => {}); }, [unread, id, markRead]);
  if (!data) return <Thread title="Loading..." meta={null} messages={undefined} closed={false} onSend={async () => false} side="platform" />;
  const t = data.ticket;
  return (
    <Thread side="platform" title={t.subject} closed={t.status === "CLOSED"} messages={data.messages}
      meta={<><span className="font-medium text-foreground">{data.businessName}</span><StatusPill status={t.status} /><Pill tone="slate">{t.category.replace("_", " ").toLowerCase()}</Pill><Pill tone={t.priority === "HIGH" ? "red" : "blue"}>{t.priority.toLowerCase()}</Pill></>}
      actions={
        <select aria-label="Set status" value={t.status} onChange={(e) => act(setStatus({ ticketId: id, status: e.target.value as "OPEN" | "ANSWERED" | "CLOSED" }), "Status updated")} className="h-8 rounded-lg border bg-white px-2 text-sm">
          <option value="OPEN">Open</option><option value="ANSWERED">Answered</option><option value="CLOSED">Closed</option>
        </select>
      }
      onSend={(body) => act(reply({ ticketId: id, body }))} />
  );
}
