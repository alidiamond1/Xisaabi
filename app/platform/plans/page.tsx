"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, Pencil, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Field, ListSkeleton, PageHeader, Panel, Pill, SubmitButton } from "@/components/common";
import { usePlatform } from "@/components/guard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MODULE_KEYS, type ModuleKey } from "@/convex/shared/modules";
import { formatCents, parseToCents } from "@/convex/shared/money";
import { MODULE_LABELS as BASE_LABELS } from "@/lib/apps";
import { act, run } from "@/lib/run";
import { cn } from "@/lib/utils";

// lib/apps.ts may not list every module yet (purchases)
const MODULE_LABELS: Record<string, string> = { purchases: "Purchases", ...BASE_LABELS };

type Plan = FunctionReturnType<typeof api.platformPlans.list>[number];

export default function PlansPage() {
  const sup = usePlatform().member.role === "SUPER_ADMIN";
  const plans = useQuery(api.platformPlans.list);
  const setActive = useMutation(api.platformPlans.setActive);
  const [edit, setEdit] = useState<Plan | "new" | null>(null);
  return (
    <>
      <PageHeader title="Plans and pricing" desc={sup ? "Edit what each plan includes and costs." : "Read-only. Only super admins can edit plans."}
        actions={sup ? <Button onClick={() => setEdit("new")}><Plus /> New plan</Button> : undefined} />
      {!plans ? <Panel><ListSkeleton /></Panel> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((p) => (
            <Panel key={p._id} className={cn("flex flex-col p-5", !p.isActive && "opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{p.name}</h3>
                <div className="flex gap-1">{p.isDefaultTrial && <Pill tone="indigo">Default trial</Pill>}{!p.isActive && <Pill tone="slate">Inactive</Pill>}</div>
              </div>
              <p className="text-sm text-muted-foreground">{p.description}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{formatCents(p.priceCents)}<span className="text-sm font-normal text-muted-foreground"> / mo</span></p>
              <p className="text-xs text-muted-foreground">{p.maxUsers || "Unlimited"} users · {p.maxProducts || "Unlimited"} products{p.trialDays > 0 && ` · ${p.trialDays}-day trial`}</p>
              <div className="mt-3 flex flex-wrap gap-1">{p.modules.map((m) => <Pill key={m} tone="slate">{MODULE_LABELS[m]}</Pill>)}</div>
              <ul className="mt-3 flex-1 space-y-1 text-sm">{p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 text-emerald-600" />{f}</li>)}</ul>
              {sup && (
                <div className="mt-4 flex items-center justify-between border-t pt-3">
                  <label className="flex items-center gap-2 text-sm"><Switch checked={p.isActive} onCheckedChange={(v) => run(setActive({ planId: p._id, isActive: v }), v ? "Plan activated" : "Plan deactivated")} />Active</label>
                  <Button size="sm" variant="outline" onClick={() => setEdit(p)}><Pencil /> Edit</Button>
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
          <DialogHeader><DialogTitle>{edit === "new" ? "New plan" : "Edit plan"}</DialogTitle></DialogHeader>
          {edit && <PlanForm key={edit === "new" ? "new" : edit._id} plan={edit === "new" ? null : edit} nextSort={(plans?.length ?? 0)} onClose={() => setEdit(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PlanForm({ plan, nextSort, onClose }: { plan: Plan | null; nextSort: number; onClose: () => void }) {
  const create = useMutation(api.platformPlans.create);
  const update = useMutation(api.platformPlans.update);
  const [f, setF] = useState({
    name: plan?.name ?? "", description: plan?.description ?? "", price: plan ? (plan.priceCents / 100).toString() : "0",
    trialDays: String(plan?.trialDays ?? 0), maxUsers: String(plan?.maxUsers ?? 0), maxProducts: String(plan?.maxProducts ?? 0),
    features: (plan?.features ?? []).join("\n"), sortOrder: String(plan?.sortOrder ?? nextSort),
  });
  const [modules, setModules] = useState<ModuleKey[]>(plan?.modules ?? [...MODULE_KEYS]);
  const [isDefaultTrial, setTrial] = useState(plan?.isDefaultTrial ?? false);
  const [isActive, setActive] = useState(plan?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const priceCents = parseToCents(f.price);
    const nums = [f.trialDays, f.maxUsers, f.maxProducts, f.sortOrder].map(Number);
    if (priceCents === null || nums.some((n) => !Number.isInteger(n) || n < 0)) return void act(Promise.reject({ data: "INVALID_INPUT" }));
    const body = {
      name: f.name.trim(), description: f.description.trim(), priceCents, trialDays: nums[0], maxUsers: nums[1], maxProducts: nums[2], sortOrder: nums[3],
      modules, features: f.features.split("\n").map((s) => s.trim()).filter(Boolean), isDefaultTrial, isActive,
    };
    setBusy(true);
    const ok = await act(plan ? update({ planId: plan._id, ...body }) : create(body), plan ? "Plan updated" : "Plan created");
    setBusy(false);
    if (ok) onClose();
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Name"><Input value={f.name} onChange={set("name")} required maxLength={100} /></Field>
      <Field label="Description"><Input value={f.description} onChange={set("description")} required maxLength={500} /></Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Price / month"><Input inputMode="decimal" value={f.price} onChange={set("price")} /></Field>
        <Field label="Trial days"><Input inputMode="numeric" value={f.trialDays} onChange={set("trialDays")} /></Field>
        <Field label="Sort order"><Input inputMode="numeric" value={f.sortOrder} onChange={set("sortOrder")} /></Field>
        <Field label="Max users" hint="0 = unlimited"><Input inputMode="numeric" value={f.maxUsers} onChange={set("maxUsers")} /></Field>
        <Field label="Max products" hint="0 = unlimited"><Input inputMode="numeric" value={f.maxProducts} onChange={set("maxProducts")} /></Field>
      </div>
      <Field label="Modules included">
        <div className="grid grid-cols-2 gap-2">
          {MODULE_KEYS.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={modules.includes(m)} onChange={(e) => setModules(e.target.checked ? [...modules, m] : modules.filter((x) => x !== m))} />{MODULE_LABELS[m]}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Marketing bullets" hint="One per line."><Textarea rows={4} value={f.features} onChange={set("features")} /></Field>
      <div className="flex gap-6 text-sm">
        <label className="flex items-center gap-2"><Switch checked={isDefaultTrial} onCheckedChange={setTrial} />Default trial plan for new signups</label>
        <label className="flex items-center gap-2"><Switch checked={isActive} onCheckedChange={setActive} />Active</label>
      </div>
      <DialogFooter><SubmitButton type="submit" busy={busy}>Save plan</SubmitButton></DialogFooter>
    </form>
  );
}
