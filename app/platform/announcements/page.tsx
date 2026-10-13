"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ConfirmDialog, EmptyState, Field, ListSkeleton, PageHeader, Panel, Pill, SubmitButton } from "@/components/common";
import { SEL, useNow } from "@/components/platform";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PRESETS } from "@/convex/shared/presets";
import { act, run } from "@/lib/run";
import { fmtDateTime, isoDay } from "@/lib/session";

type Ann = FunctionReturnType<typeof api.platformAnnouncements.list>[number];
type Level = Ann["level"];
const LEVEL_TONE = { INFO: "blue", WARNING: "amber", SUCCESS: "green" } as const;

/** epoch ms -> value for <input type="datetime-local"> */
const toLocal = (ms: number) => `${isoDay(ms)}T${new Date(ms).toTimeString().slice(0, 5)}`;

export default function AnnouncementsPage() {
  const now = useNow();
  const rows = useQuery(api.platformAnnouncements.list);
  const plans = useQuery(api.platformPlans.list);
  const update = useMutation(api.platformAnnouncements.update);
  const remove = useMutation(api.platformAnnouncements.remove);
  const [edit, setEdit] = useState<Ann | "new" | null>(null);
  const [del, setDel] = useState<Ann | null>(null);
  const planName = (id: string) => plans?.find((p) => p._id === id)?.name ?? "?";
  const state = (a: Ann) => !a.isActive ? ["Inactive", "slate"] as const : a.startsAt > now ? ["Scheduled", "blue"] as const : a.endsAt !== undefined && a.endsAt < now ? ["Ended", "slate"] as const : ["Live", "green"] as const;

  return (
    <>
      <PageHeader title="Announcements" desc="Banners shown to business owners and managers." actions={<Button onClick={() => setEdit("new")}><Plus /> New announcement</Button>} />
      {!rows || !plans ? <Panel><ListSkeleton /></Panel> : rows.length === 0 ? (
        <Panel><EmptyState icon={Megaphone} title="No announcements" desc="Tell businesses about maintenance, new features or offers." /></Panel>
      ) : (
        <div className="space-y-3">
          {rows.map((a) => {
            const [label, tone] = state(a);
            const aud = [...a.audience.planIds.map(planName), ...a.audience.businessTypes];
            return (
              <Panel key={a._id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{a.title}</h3><Pill tone={LEVEL_TONE[a.level]}>{a.level.toLowerCase()}</Pill><Pill tone={tone} dot>{label}</Pill></div>
                <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{a.body}</p>
                <p className="text-xs text-muted-foreground">
                  {fmtDateTime(a.startsAt)}{a.endsAt !== undefined && ` to ${fmtDateTime(a.endsAt)}`} · For: {aud.length ? aud.join(", ") : "everyone"}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <label className="mr-auto flex min-h-11 items-center gap-2 text-sm">
                    <Switch checked={a.isActive} onCheckedChange={(v) => run(update({ announcementId: a._id, title: a.title, body: a.body, level: a.level, audience: a.audience, startsAt: a.startsAt, endsAt: a.endsAt, isActive: v }), v ? "Activated" : "Deactivated")} />
                    Active
                  </label>
                  <Button variant="outline" size="sm" onClick={() => setEdit(a)}><Pencil /> Edit</Button>
                  <Button variant="ghost" size="sm" className="text-danger" onClick={() => setDel(a)}><Trash2 /> Delete</Button>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
      {edit && plans && <EditDialog key={edit === "new" ? "new" : edit._id} ann={edit === "new" ? null : edit} plans={plans} onClose={() => setEdit(null)} />}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Delete announcement?" desc={`"${del?.title}" disappears for everyone.`} confirmLabel="Delete"
        onConfirm={async () => { if (del) await run(remove({ announcementId: del._id }), "Announcement deleted"); }} />
    </>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={onChange} className="size-4 accent-[var(--color-brand-600)]" />{children}
    </label>
  );
}

function EditDialog({ ann, plans, onClose }: { ann: Ann | null; plans: { _id: Id<"plans">; name: string }[]; onClose: () => void }) {
  const create = useMutation(api.platformAnnouncements.create);
  const update = useMutation(api.platformAnnouncements.update);
  const [title, setTitle] = useState(ann?.title ?? "");
  const [body, setBody] = useState(ann?.body ?? "");
  const [level, setLevel] = useState<Level>(ann?.level ?? "INFO");
  const [planIds, setPlanIds] = useState<Id<"plans">[]>(ann?.audience.planIds ?? []);
  const [types, setTypes] = useState<string[]>(ann?.audience.businessTypes ?? []);
  const [starts, setStarts] = useState(toLocal(ann?.startsAt ?? Date.now()));
  const [ends, setEnds] = useState(ann?.endsAt !== undefined ? toLocal(ann.endsAt) : "");
  const [isActive, setIsActive] = useState(ann?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const toggle = <T,>(xs: T[], set: (x: T[]) => void, x: T) => set(xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  const startsAt = new Date(starts).getTime();
  const endsAt = ends ? new Date(ends).getTime() : undefined;
  const bad = !title.trim() || !body.trim() || Number.isNaN(startsAt) || (endsAt !== undefined && endsAt <= startsAt);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const data = { title: title.trim(), body: body.trim(), level, audience: { planIds, businessTypes: types }, startsAt, endsAt, isActive };
    const ok = await act(ann ? update({ announcementId: ann._id, ...data }) : create(data), ann ? "Announcement saved" : "Announcement created");
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader><DialogTitle>{ann ? "Edit announcement" : "New announcement"}</DialogTitle></DialogHeader>
          <Field label="Title" required><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required /></Field>
          <Field label="Message" required><Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} required /></Field>
          <Field label="Level">
            <select className={`${SEL} w-full`} value={level} onChange={(e) => setLevel(e.target.value as Level)}>
              <option value="INFO">Info</option><option value="WARNING">Warning</option><option value="SUCCESS">Success</option>
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts" required><Input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} required className="h-11 text-base md:h-9 md:text-sm" /></Field>
            <Field label="Ends (optional)"><Input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} className="h-11 text-base md:h-9 md:text-sm" /></Field>
          </div>
          <fieldset>
            <legend className="text-sm font-medium">Plans <span className="font-normal text-muted-foreground">(none = all)</span></legend>
            <div className="grid sm:grid-cols-2">{plans.map((p) => <Check key={p._id} checked={planIds.includes(p._id)} onChange={() => toggle(planIds, setPlanIds, p._id)}>{p.name}</Check>)}</div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-medium">Business types <span className="font-normal text-muted-foreground">(none = all)</span></legend>
            <div className="grid sm:grid-cols-2">{PRESETS.map((p) => <Check key={p.key} checked={types.includes(p.key)} onChange={() => toggle(types, setTypes, p.key)}>{p.label}</Check>)}</div>
          </fieldset>
          <label className="flex min-h-11 items-center gap-2 text-sm"><Switch checked={isActive} onCheckedChange={setIsActive} />Active</label>
          {endsAt !== undefined && endsAt <= startsAt && <p role="alert" className="text-xs text-danger">The end must be after the start.</p>}
          <DialogFooter><SubmitButton type="submit" busy={busy} disabled={bad}>{ann ? "Save" : "Create"}</SubmitButton></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
