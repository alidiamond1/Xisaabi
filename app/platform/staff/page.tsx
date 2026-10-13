"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { Lock, Plus, Unlock, UserCog } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { ConfirmDialog, DataTable, EmptyState, Field, PageHeader, Panel, Pill, SubmitButton } from "@/components/common";
import { usePlatform } from "@/components/guard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { normalizeUsername } from "@/convex/shared/username";
import { fmtDate } from "@/lib/session";
import { act, run } from "@/lib/run";

export default function PlatformStaffPage() {
  const me = usePlatform();
  const router = useRouter();
  const sup = me.member.role === "SUPER_ADMIN";
  useEffect(() => { if (!sup) router.replace("/platform"); }, [sup, router]);
  const rows = useQuery(api.platformStaff.list, sup ? {} : "skip");
  const setActive = useMutation(api.platformStaff.setActive);
  const [adding, setAdding] = useState(false);
  const [lock, setLock] = useState<NonNullable<typeof rows>[number] | null>(null);
  if (!sup) return null;
  return (
    <>
      <PageHeader title="Platform staff" desc="People who can administer Xisaabi." actions={<Button onClick={() => setAdding(true)}><Plus /> Add admin</Button>} />
      <Panel>
        <DataTable
          rows={rows}
          empty={<EmptyState icon={UserCog} title="No platform admins" />}
          cols={[
            { header: "Name", cell: (m) => <span><span className="font-medium">{m.fullName}</span><span className="block text-xs text-muted-foreground">@{m.username}</span></span> },
            { header: "Role", cell: (m) => <Pill tone={m.role === "SUPER_ADMIN" ? "indigo" : "blue"}>{m.role.replace("_", " ")}</Pill> },
            { header: "Status", cell: (m) => <Pill tone={m.isActive ? "green" : "red"}>{m.isActive ? "Active" : "Locked"}</Pill> },
            { header: "Added", cell: (m) => fmtDate(m.createdAt) },
            {
              header: "", className: "w-16 text-right", cell: (m) => m._id === me.member._id || m.role === "SUPER_ADMIN" ? null : m.isActive
                ? <Button size="icon" variant="ghost" className="size-8 text-red-600" title="Lock" onClick={() => setLock(m)}><Lock /></Button>
                : <Button size="icon" variant="ghost" className="size-8 text-emerald-600" title="Unlock" onClick={() => run(setActive({ memberId: m._id, isActive: true }), "Admin unlocked")}><Unlock /></Button>,
            },
          ]}
        />
      </Panel>
      <AddDialog open={adding} onClose={() => setAdding(false)} />
      <ConfirmDialog open={!!lock} onOpenChange={(o) => !o && setLock(null)} title={`Lock ${lock?.fullName}?`} desc="They will lose platform access until unlocked." confirmLabel="Lock admin"
        onConfirm={async () => { if (lock) await run(setActive({ memberId: lock._id, isActive: false }), "Admin locked"); }} />
    </>
  );
}

function AddDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useAction(api.platformStaff.create);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const u = normalizeUsername(username);
    if (!u) return void act(Promise.reject({ data: "INVALID_USERNAME" }));
    setBusy(true);
    const ok = await act(create({ fullName: fullName.trim(), username: u, password }), "Platform admin created");
    setBusy(false);
    if (ok) { setFullName(""); setUsername(""); setPassword(""); onClose(); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add platform admin</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Full name"><Input value={fullName} onChange={(e) => setFullName(e.target.value)} required /></Field>
          <Field label="Username"><Input autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required /></Field>
          <Field label="Password" hint="At least 8 characters."><Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></Field>
          <DialogFooter><SubmitButton type="submit" busy={busy}>Create admin</SubmitButton></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
