"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useView } from "@/components/app-shell";
import { ConfirmDialog, Field, PageHeader, Pill, SubmitButton } from "@/components/common";
import { StatusPill, Thread, TicketLayout, type TicketRow } from "@/components/tickets";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { act, run } from "@/lib/run";

type Category = "BILLING" | "TECHNICAL" | "FEATURE_REQUEST" | "OTHER";
type Priority = "LOW" | "NORMAL" | "HIGH";

export default function SupportPage() {
  const view = useView("support");
  const tickets = useQuery(api.support.list);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const contact = useQuery(api.platformSettings.get);
  const rows: TicketRow[] | undefined = tickets
    ?.filter((t) => (view === "open" ? t.status !== "CLOSED" : view === "closed" ? t.status === "CLOSED" : true))
    .map((t) => ({ ...t, unread: t.unreadByBusiness, sub: t.category.replace("_", " ").toLowerCase() }));

  return (
    <>
      <PageHeader title="Support" desc="Ask our team for help. We reply here." actions={<Button onClick={() => setCreating(true)}><Plus /> New ticket</Button>} />
      {(contact?.supportPhone || contact?.supportWhatsApp) && (
        <p className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          Need help now?
          {contact.supportPhone && <a href={`tel:${contact.supportPhone}`} className="inline-flex min-h-11 items-center font-medium text-brand-700 sm:min-h-0">Call {contact.supportPhone}</a>}
          {contact.supportWhatsApp && <a href={`https://wa.me/${contact.supportWhatsApp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center font-medium text-brand-700 sm:min-h-0">WhatsApp {contact.supportWhatsApp}</a>}
        </p>
      )}
      <TicketLayout tickets={rows} selected={selected} onSelect={setSelected}>
        {selected && <BusinessThread key={selected} id={selected as Id<"tickets">} />}
      </TicketLayout>
      <NewTicket open={creating} onClose={() => setCreating(false)} onCreated={(id) => setSelected(id)} />
    </>
  );
}

function BusinessThread({ id }: { id: Id<"tickets"> }) {
  const data = useQuery(api.support.get, { ticketId: id });
  const markRead = useMutation(api.support.markRead);
  const reply = useMutation(api.support.reply);
  const close = useMutation(api.support.close);
  const [closing, setClosing] = useState(false);
  const unread = data?.ticket.unreadByBusiness;
  useEffect(() => { if (unread) markRead({ ticketId: id }).catch(() => {}); }, [unread, id, markRead]);
  if (!data) return <Thread title="Loading..." meta={null} messages={undefined} closed={false} onSend={async () => false} side="business" />;
  const t = data.ticket;
  return (
    <>
      <Thread side="business" title={t.subject} closed={t.status === "CLOSED"} messages={data.messages}
        meta={<><StatusPill status={t.status} /><Pill tone="slate">{t.category.replace("_", " ").toLowerCase()}</Pill></>}
        actions={t.status !== "CLOSED" ? <Button size="sm" variant="outline" onClick={() => setClosing(true)}>Close ticket</Button> : undefined}
        onSend={(body) => act(reply({ ticketId: id, body }))} />
      <ConfirmDialog open={closing} onOpenChange={setClosing} destructive={false} title="Close this ticket?" desc="You can reopen it any time by replying." confirmLabel="Close ticket"
        onConfirm={async () => { await run(close({ ticketId: id }), "Ticket closed"); }} />
    </>
  );
}

function NewTicket({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const create = useMutation(api.support.create);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<Category>("TECHNICAL");
  const [priority, setPriority] = useState<Priority>("NORMAL");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const id = await run(create({ subject: subject.trim(), category, priority, body: body.trim() }), "Ticket sent");
    setBusy(false);
    if (id) { setSubject(""); setBody(""); onCreated(id); onClose(); }
  }
  const sel = "h-11 w-full rounded-lg border bg-white px-2 text-base md:h-9 md:text-sm";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New support ticket</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={200} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select className={sel} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                <option value="TECHNICAL">Technical</option><option value="BILLING">Billing</option><option value="FEATURE_REQUEST">Feature request</option><option value="OTHER">Other</option>
              </select>
            </Field>
            <Field label="Priority">
              <select className={sel} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                <option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option>
              </select>
            </Field>
          </div>
          <Field label="Message"><Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} required maxLength={5000} /></Field>
          <DialogFooter><SubmitButton type="submit" busy={busy}>Send ticket</SubmitButton></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
