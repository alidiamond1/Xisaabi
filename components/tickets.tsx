"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, LifeBuoy, Send } from "lucide-react";
import { EmptyState, ListSkeleton, Pill, SubmitButton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fmtDateTime } from "@/lib/session";
import { cn } from "@/lib/utils";

export type TicketRow = {
  _id: string; subject: string; status: "OPEN" | "ANSWERED" | "CLOSED"; priority: "LOW" | "NORMAL" | "HIGH";
  category: string; unread: boolean; lastMessageAt: number; sub?: string;
};
export type Msg = { _id: string; authorName: string; fromPlatform: boolean; body: string; createdAt: number };

const STATUS_TONE = { OPEN: "amber", ANSWERED: "green", CLOSED: "slate" } as const;
const PRIORITY_TONE = { LOW: "slate", NORMAL: "blue", HIGH: "red" } as const;

export function StatusPill({ status }: { status: TicketRow["status"] }) {
  return <Pill tone={STATUS_TONE[status]}>{status.charAt(0) + status.slice(1).toLowerCase()}</Pill>;
}

/** Two-pane inbox: list left, thread right (stacked on phones). */
export function TicketLayout({ tickets, selected, onSelect, children }: {
  tickets: TicketRow[] | undefined; selected: string | null; onSelect: (id: string | null) => void; children: React.ReactNode;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <div className={cn("rounded-xl border bg-white", selected && "hidden lg:block")}>
        {tickets === undefined ? <ListSkeleton /> : tickets.length === 0 ? (
          <EmptyState icon={LifeBuoy} title="No tickets" desc="Nothing to show here yet." />
        ) : (
          <ul className="max-h-[70dvh] divide-y overflow-y-auto">
            {tickets.map((t) => (
              <li key={t._id}>
                <button onClick={() => onSelect(t._id)} className={cn("w-full space-y-1 p-3 text-left hover:bg-muted", selected === t._id && "bg-indigo-50")}>
                  <div className="flex items-center gap-2">
                    {t.unread && <span className="size-2 shrink-0 rounded-full bg-indigo-600" />}
                    <span className={cn("truncate text-sm", t.unread ? "font-semibold" : "font-medium")}>{t.subject}</span>
                  </div>
                  {t.sub && <p className="truncate text-xs text-muted-foreground">{t.sub}</p>}
                  <div className="flex items-center gap-1.5">
                    <StatusPill status={t.status} />
                    <Pill tone={PRIORITY_TONE[t.priority]}>{t.priority.toLowerCase()}</Pill>
                    <span className="ml-auto text-xs text-muted-foreground">{fmtDateTime(t.lastMessageAt)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={cn("min-w-0", !selected && "hidden lg:block")}>
        {selected ? (
          <>
            <Button variant="ghost" size="sm" className="mb-2 lg:hidden" onClick={() => onSelect(null)}><ArrowLeft /> Back</Button>
            {children}
          </>
        ) : (
          <div className="rounded-xl border bg-white"><EmptyState icon={LifeBuoy} title="Select a ticket" desc="Pick a conversation from the list." /></div>
        )}
      </div>
    </div>
  );
}

export function Thread({ title, meta, actions, messages, closed, onSend, side }: {
  title: string; meta: React.ReactNode; actions?: React.ReactNode; messages: Msg[] | undefined; closed: boolean;
  onSend: (body: string) => Promise<boolean>; side: "business" | "platform";
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages?.length]);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    if (await onSend(body.trim())) setBody("");
    setBusy(false);
  }
  return (
    <div className="flex flex-col rounded-xl border bg-white">
      <div className="flex items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0"><h2 className="truncate font-semibold">{title}</h2><div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">{meta}</div></div>
        <div className="flex shrink-0 gap-2">{actions}</div>
      </div>
      <div className="max-h-[50dvh] min-h-48 space-y-3 overflow-y-auto bg-slate-50 p-4">
        {messages === undefined ? <ListSkeleton rows={3} /> : messages.map((m) => {
          const mine = m.fromPlatform === (side === "platform");
          return (
            <div key={m._id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm", mine ? "bg-indigo-600 text-white" : "border bg-white")}>
                <p className={cn("mb-0.5 text-xs", mine ? "text-indigo-200" : "text-muted-foreground")}>{m.authorName}{m.fromPlatform && side === "business" && " (Dukaan support)"} · {fmtDateTime(m.createdAt)}</p>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {closed ? (
        <p className="border-t p-3 text-center text-sm text-muted-foreground">This ticket is closed. Replying will reopen it.</p>
      ) : null}
      <form onSubmit={send} className="flex items-end gap-2 border-t p-3">
        <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a reply..." maxLength={5000} className="min-h-0 flex-1" />
        <SubmitButton type="submit" busy={busy} disabled={!body.trim()}><Send /><span className="hidden sm:inline">Send</span></SubmitButton>
      </form>
    </div>
  );
}
