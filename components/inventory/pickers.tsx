"use client";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Field, SubmitButton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { run } from "@/lib/run";
import { NativeSelect } from "./bits";

/** Category options with 2 levels shown as "Parent / Child". */
export function categoryOptions(cats: { _id: string; name: string; parentId?: string }[] | undefined) {
  if (!cats) return [];
  const byId = new Map(cats.map((c) => [c._id, c]));
  return cats
    .map((c) => ({ value: c._id, label: c.parentId && byId.get(c.parentId) ? `${byId.get(c.parentId)!.name} / ${c.name}` : c.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Category select with inline "New" dialog. */
export function CategoryPicker({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const cats = useQuery(api.categories.list);
  const create = useMutation(api.categories.create);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const opts = useMemo(() => categoryOptions(cats), [cats]);
  const tops = (cats ?? []).filter((c) => !c.parentId).map((c) => ({ value: c._id, label: c.name }));

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    const newId = await run(create({ name, parentId: parent ? (parent as Id<"categories">) : undefined }), "Category added");
    setBusy(false);
    if (newId) { onChange(newId); setOpen(false); setName(""); setParent(""); }
  }

  return (
    <>
      <div className="flex gap-2">
        <NativeSelect id={id} value={value} onChange={onChange} placeholder={cats ? "No category" : "Loading..."} options={opts} />
        <Button type="button" variant="outline" size="lg" className="shrink-0" onClick={() => setOpen(true)} aria-label="New category"><Plus />New</Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New category</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Drinks" autoFocus /></Field>
            <Field label="Inside" hint="Optional. Categories can have one level of sub-categories.">
              <NativeSelect value={parent} onChange={setParent} placeholder="Top level" options={tops} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton busy={busy} disabled={!name.trim()} onClick={save}>Add category</SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
