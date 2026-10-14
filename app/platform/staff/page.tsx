"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { KeyRound, Plus, UserCog } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { DataTable, EmptyState, Field, PageHeader, Panel, Pill, SubmitButton } from "@/components/common";
import { usePlatform } from "@/components/guard";
import { PasswordDialog, SEL } from "@/components/platform";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { normalizeUsername } from "@/convex/shared/username";
import { fmtDate, fmtDateTime } from "@/lib/session";
import { act, run } from "@/lib/run";

export default function PlatformStaffPage() {
  const me = usePlatform();
  const router = useRouter();
  const sup = me.member.role === "SUPER_ADMIN";
  useEffect(() => { if (!sup) router.replace("/platform"); }, [sup, router]);
  const rows = useQuery(api.platformStaff.list, sup ? {} : "skip");
  const setActive = useMutation(api.platformStaff.setActive);
  const [adding, setAdding] = useState(false);
  const setRole = useMutation(api.platformStaff.setRole);
  const resetPw = useAction(api.platformStaff.resetPassword);
  const [reset, setReset] = useState<NonNullable<typeof rows>[number] | null>(null);
  if (!sup) return null;
  return (
    <>
      <PageHeader title="Platform staff" desc="People who can administer XisabSax." actions={<Button onClick={() => setAdding(true)}><Plus /> Add admin</Button>} />
      <Panel>
        <DataTable
          rows={rows}
          empty={<EmptyState icon={UserCog} title="No platform admins" />}
          cols={[
            { header: "Name", cell: (m) => <span><span className="font-medium">{m.fullName}</span><span className="block text-xs text-muted-foreground">@{m.username}</span></span> },
            {
              header: "Role", cell: (m) => m._id === me.member._id
                ? <Pill tone="indigo">{m.role.replace("_", " ")} (you)</Pill>
                : <select aria-label={`Role of ${m.fullName}`} value={m.role} onChange={(e) => run(setRole({ memberId: m._id, role: e.target.value as "SUPER_ADMIN" | "PLATFORM_ADMIN" }), "Role updated")} className={SEL}>
                  <option value="SUPER_ADMIN">Super admin</option><option value="PLATFORM_ADMIN">Platform admin</option>
                </select>,
            },
            { header: "Last login", cell: (m) => m.lastLoginAt ? fmtDateTime(m.lastLoginAt) : <span className="text-muted-foreground">never</span> },
            { header: "Active", cell: (m) => m._id === me.member._id ? <Pill tone="green">Active</Pill> : <Switch checked={m.isActive} aria-label={`${m.fullName} active`} onCheckedChange={(v) => run(setActive({ memberId: m._id, isActive: v }), v ? "Admin unlocked" : "Admin locked")} /> },
            { header: "Added", cell: (m) => fmtDate(m.createdAt) },
            { header: "", className: "w-36 text-right", cell: (m) => <Button size="sm" variant="outline" onClick={() => setReset(m)}><KeyRound /> Reset password</Button> },
          ]}
        />
      </Panel>
      <AddDialog open={adding} onClose={() => setAdding(false)} />
      <PasswordDialog open={!!reset} onClose={() => setReset(null)} title={`Reset password for ${reset?.fullName}`}
        submit={(pw) => act(resetPw({ memberId: reset!._id, newPassword: pw }), "Password reset")} />
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
