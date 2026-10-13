"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PageHeader, Pill } from "@/components/common";
import { usePlatform } from "@/components/guard";
import { SEL, ago } from "@/components/platform";
import { StatusPill, Thread, TicketLayout, type TicketRow } from "@/components/tickets";
import { act } from "@/lib/run";

type Status = "" | "OPEN" | "ANSWERED" | "CLOSED";
type Priority = "" | "LOW" | "NORMAL" | "HIGH";

/** Platform staff a ticket can be assigned to (the full list is super-admin only; others can take it themselves). */
function useAssignees() {
  const me = usePlatform().member;
  const sup = me.role === "SUPER_ADMIN";
  const staff = useQuery(api.platformStaff.list, sup ? {} : "skip");
  return sup ? (staff ?? []).filter((m) => m.isActive).map((m) => ({ _id: m._id, name: m.fullName })) : [{ _id: me._id, name: me.fullName }];
}

export default function PlatformSupportPage() {
  const [status, setStatus] = useState<Status>("");
  const [priority, setPriority] = useState<Priority>("");
  const [who, setWho] = useState(""); // "", "mine" or a member id
  const assignees = useAssignees();
  const tickets = useQuery(api.platformSupport.list, {
    status: status || undefined, priority: priority || undefined,
    mine: who === "mine" || undefined, assignedTo: who && who !== "mine" ? (who as Id<"members">) : undefined,
  });
  const [selected, setSelected] = useState<string | null>(useSearchParams().get("t"));
  const [now] = useState(() => Date.now());
  const rows: TicketRow[] | undefined = tickets?.map((t) => ({
    ...t, unread: t.unreadByPlatform,
    sub: [t.businessName, t.waitingSince ? `waiting ${ago(t.waitingSince, now)}` : null, t.assignedToName ? `-> ${t.assignedToName}` : "unassigned"].filter(Boolean).join(" · "),
  }));
  return (
    <>
      <PageHeader title="Support inbox" desc="Tickets from every business." />
      <div className="mb-4 grid grid-cols-3 gap-2 sm:flex">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as Status)} className={SEL}>
          <option value="">All statuses</option><option value="OPEN">Open</option><option value="ANSWERED">Answered</option><option value="CLOSED">Closed</option>
        </select>
        <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={SEL}>
          <option value="">Any priority</option><option value="HIGH">High</option><option value="NORMAL">Normal</option><option value="LOW">Low</option>
        </select>
        <select aria-label="Assigned to" value={who} onChange={(e) => setWho(e.target.value)} className={SEL}>
          <option value="">Anyone</option><option value="mine">Assigned to me</option>
          {assignees.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
        </select>
      </div>
      <TicketLayout tickets={rows} selected={selected} onSelect={setSelected}>
        {selected && <PlatformThread key={selected} id={selected as Id<"tickets">} assignees={assignees} />}
      </TicketLayout>
    </>
  );
}

function PlatformThread({ id, assignees }: { id: Id<"tickets">; assignees: { _id: Id<"members">; name: string }[] }) {
  const data = useQuery(api.platformSupport.get, { ticketId: id });
  const markRead = useMutation(api.platformSupport.markRead);
  const reply = useMutation(api.platformSupport.reply);
  const setStatus = useMutation(api.platformSupport.setStatus);
  const setPriority = useMutation(api.platformSupport.setPriority);
  const assign = useMutation(api.platformSupport.assign);
  const unread = data?.ticket.unreadByPlatform;
  useEffect(() => { if (unread) markRead({ ticketId: id }).catch(() => {}); }, [unread, id, markRead]);
  if (!data) return <Thread title="Loading..." meta={null} messages={undefined} closed={false} onSend={async () => false} side="platform" />;
  const t = data.ticket;
  const sm = "h-10 rounded-lg border bg-card px-2 text-sm md:h-8";
  return (
    <Thread side="platform" title={t.subject} closed={t.status === "CLOSED"} messages={data.messages}
      meta={<>
        <span className="font-medium text-foreground">{data.businessName}</span><StatusPill status={t.status} /><Pill tone="slate">{t.category.replace("_", " ").toLowerCase()}</Pill>
        <select aria-label="Priority" value={t.priority} onChange={(e) => act(setPriority({ ticketId: id, priority: e.target.value as "LOW" | "NORMAL" | "HIGH" }), "Priority updated")} className={sm}>
          <option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option>
        </select>
        <select aria-label="Assigned to" value={t.assignedTo ?? ""} onChange={(e) => act(assign({ ticketId: id, memberId: (e.target.value || null) as Id<"members"> | null }), "Assignment updated")} className={sm}>
          <option value="">Unassigned</option>
          {t.assignedTo && !assignees.some((a) => a._id === t.assignedTo) && <option value={t.assignedTo}>Another admin</option>}
          {assignees.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
        </select>
      </>}
      actions={
        <select aria-label="Set status" value={t.status} onChange={(e) => act(setStatus({ ticketId: id, status: e.target.value as "OPEN" | "ANSWERED" | "CLOSED" }), "Status updated")} className={sm}>
          <option value="OPEN">Open</option><option value="ANSWERED">Answered</option><option value="CLOSED">Closed</option>
        </select>
      }
      onSend={(body) => act(reply({ ticketId: id, body }))} />
  );
}
