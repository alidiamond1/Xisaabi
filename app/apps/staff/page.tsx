"use client";
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { KeyRound, Lock, Pencil, Plus, ShieldCheck, Unlock, UserCog } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { ConfirmDialog, DataTable, EmptyState, Field, PageHeader, Panel, Pill, SubmitButton, type Col } from "@/components/common";
import { useBiz } from "@/components/guard";
import { Segmented } from "@/components/inventory/bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { normalizeUsername } from "@/convex/shared/username";
import { PERMISSION_LABELS, ROLE_DEFAULTS, type Permission, type Permissions } from "@/convex/shared/permissions";
import { act, run } from "@/lib/run";

type Member = FunctionReturnType<typeof api.staff.list>[number];
type Role = "MANAGER" | "CASHIER";
const TONE = { OWNER: "brand", MANAGER: "blue", CASHIER: "slate" } as const;
const PERMS = Object.keys(PERMISSION_LABELS) as Permission[];
const ROLE_NOTE: Record<Role, string> = { CASHIER: "Sells at the register and manages customers.", MANAGER: "Runs stock, sales, expenses, reports and staff." };
const iconBtn = "size-11 md:size-9";

export default function StaffPage() {
  const me = useBiz();
  const isOwner = me.member.role === "OWNER";
  const rows = useQuery(api.staff.list);
  const setActive = useMutation(api.staff.setActive);
  const [form, setForm] = useState<Member | "new" | null>(null);
  const [reset, setReset] = useState<Member | null>(null);
  const [lock, setLock] = useState<Member | null>(null);
  // Managers may only manage cashiers
  const manageable = (m: Member) => m.role !== "OWNER" && m._id !== me.member._id && (isOwner || m.role === "CASHIER");

  const cols: Col<Member>[] = [
    {
      header: "Name",
      cell: (m) => (
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">{m.fullName.slice(0, 2).toUpperCase()}</span>
          <div className="min-w-0">
            <p className="truncate font-medium">{m.fullName}{m._id === me.member._id && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}</p>
            <p className="truncate text-xs text-muted-foreground">@{m.username}{m.phone && ` · ${m.phone}`}</p>
          </div>
        </div>
      ),
    },
    { header: "Role", cell: (m) => <Pill tone={TONE[m.role as keyof typeof TONE]}>{m.role.charAt(0) + m.role.slice(1).toLowerCase()}</Pill> },
    {
      header: "Access",
      cell: (m) => m.role === "OWNER" ? <span className="text-muted-foreground">Everything</span> : <span className="tnum text-muted-foreground">{PERMS.filter((p) => m.permissions[p]).length} of {PERMS.length} permissions</span>,
    },
    { header: "Status", cell: (m) => <Pill tone={m.isActive ? "green" : "red"} dot>{m.isActive ? "Active" : "Locked"}</Pill> },
    {
      header: "", className: "w-40 text-right",
      cell: (m) => (
        <div className="flex justify-end gap-1">
          {manageable(m) && <Button size="icon" variant="ghost" className={iconBtn} aria-label={`Edit ${m.fullName}`} onClick={() => setForm(m)}><Pencil /></Button>}
          {(manageable(m) || (isOwner && m.role === "OWNER")) && <Button size="icon" variant="ghost" className={iconBtn} aria-label={`Reset password for ${m.fullName}`} onClick={() => setReset(m)}><KeyRound /></Button>}
          {manageable(m) && (m.isActive
            ? <Button size="icon" variant="ghost" className={`${iconBtn} text-danger`} aria-label={`Lock ${m.fullName}`} onClick={() => setLock(m)}><Lock /></Button>
            : <Button size="icon" variant="ghost" className={`${iconBtn} text-success`} aria-label={`Unlock ${m.fullName}`} onClick={() => run(setActive({ memberId: m._id, isActive: true }), "User unlocked")}><Unlock /></Button>)}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Staff" desc={isOwner ? "Managers and cashiers, and what each of them may do." : "Cashiers in your business."} actions={<Button onClick={() => setForm("new")}><Plus /> Add user</Button>} />
      <Panel>
        <DataTable rows={rows} cols={cols} onRowClick={(m) => manageable(m) && setForm(m)}
          empty={<EmptyState icon={UserCog} title="No staff yet" desc="Add a cashier so they can sell with their own login." action={<Button onClick={() => setForm("new")}><Plus /> Add user</Button>} />} />
      </Panel>
      <Sheet open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <SheetContent className="w-full sm:max-w-md">
          {form && <UserForm key={form === "new" ? "new" : form._id} m={form === "new" ? null : form} isOwner={isOwner} onClose={() => setForm(null)} />}
        </SheetContent>
      </Sheet>
      <ResetDialog member={reset} onClose={() => setReset(null)} />
      <ConfirmDialog open={!!lock} onOpenChange={(o) => !o && setLock(null)} title={`Lock ${lock?.fullName}?`} desc="They are signed out and cannot log in until you unlock them." confirmLabel="Lock user"
        onConfirm={async () => { if (lock) await run(setActive({ memberId: lock._id, isActive: false }), "User locked"); }} />
    </>
  );
}

function UserForm({ m, isOwner, onClose }: { m: Member | null; isOwner: boolean; onClose: () => void }) {
  const create = useAction(api.staff.create);
  const update = useMutation(api.staff.update);
  const [fullName, setFullName] = useState(m?.fullName ?? "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState(m?.phone ?? "");
  const [role, setRole] = useState<Role>((m?.role as Role) ?? "CASHIER");
  const [perms, setPerms] = useState<Permissions>(m?.permissions ?? ROLE_DEFAULTS.CASHIER);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const err = (bad: boolean, msg: string) => (tried && bad ? msg : undefined);

  const pickRole = (r: Role) => { setRole(r); setPerms(ROLE_DEFAULTS[r]); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    const u = m ? "" : normalizeUsername(username);
    if (!fullName.trim() || (!m && (!u || password.length < 8))) return;
    setBusy(true);
    const permissions = isOwner ? perms : undefined;
    const ok = m
      ? await act(update({ memberId: m._id, fullName: fullName.trim(), phone: phone.trim() || undefined, role, permissions }), "User saved")
      : await act(create({ fullName: fullName.trim(), username: u!, password, role, phone: phone.trim() || undefined, permissions }), "User created");
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <SheetHeader><SheetTitle>{m ? "Edit user" : "Add user"}</SheetTitle><SheetDescription>{m ? `@${m.username}` : "They log in with this username and password."}</SheetDescription></SheetHeader>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        <Field label="Full name" required error={err(!fullName.trim(), "Enter their name.")}><Input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={100} autoFocus={!m} /></Field>
        {!m && <Field label="Username" required hint="3-32 characters: letters, numbers, . _ -" error={err(!normalizeUsername(username), "Use 3-32 letters, numbers, . _ -")}>
          <Input autoCapitalize="none" autoCorrect="off" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>}
        {!m && <Field label="Password" required hint="At least 8 characters." error={err(password.length < 8, "Password must be at least 8 characters.")}>
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>}
        <Field label="Phone"><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={50} /></Field>
        <div role="group" aria-labelledby="role-h" className="space-y-1.5">
          <p id="role-h" className="text-sm font-medium">Role</p>
          <Segmented label="Role" value={role} onChange={pickRole} options={[{ value: "CASHIER", label: "Cashier" }, { value: "MANAGER", label: "Manager", disabled: !isOwner }]} />
          <p className="text-xs text-muted-foreground">{ROLE_NOTE[role]}</p>
        </div>
        {isOwner && (
          <fieldset className="space-y-1 rounded-xl border p-3">
            <legend className="flex items-center gap-1.5 px-1 text-sm font-medium"><ShieldCheck className="size-4 text-brand-600" />Permissions</legend>
            <p className="pb-1 text-xs text-muted-foreground">Starts from the {role.toLowerCase()} defaults. Change any switch.</p>
            {PERMS.map((p) => (
              <label key={p} className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
                <span>{PERMISSION_LABELS[p]}</span>
                <Switch checked={perms[p]} onCheckedChange={(v) => setPerms({ ...perms, [p]: v })} aria-label={PERMISSION_LABELS[p]} />
              </label>
            ))}
          </fieldset>
        )}
      </div>
      <SheetFooter className="border-t pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="lg" className="flex-1" onClick={onClose}>Cancel</Button>
          <SubmitButton type="submit" size="lg" className="flex-1" busy={busy}>{m ? "Save" : "Create user"}</SubmitButton>
        </div>
      </SheetFooter>
    </form>
  );
}

function ResetDialog({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const reset = useAction(api.staff.resetPassword);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={!!member} onOpenChange={(o) => { if (!o) { setPw(""); onClose(); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reset password</DialogTitle><DialogDescription>Choose a new password for {member?.fullName}. They are logged out everywhere.</DialogDescription></DialogHeader>
        <Field label="New password" hint="At least 8 characters."><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton busy={busy} disabled={pw.length < 8} onClick={async () => {
            if (!member) return;
            setBusy(true);
            const ok = await act(reset({ memberId: member._id, newPassword: pw }), "Password reset");
            setBusy(false);
            if (ok) { setPw(""); onClose(); }
          }}>Reset password</SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
