"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CornerDownRight, FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ConfirmDialog, EmptyState, ListSkeleton, PageHeader, Panel } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { run } from "@/lib/run";

type Cat = { _id: Id<"categories">; name: string; parentId?: Id<"categories"> };

/** One text field + save/cancel, used for add and rename. */
function NameEditor({ initial = "", placeholder, cta, onSave, onCancel }: { initial?: string; placeholder: string; cta: string; onSave: (name: string) => Promise<boolean>; onCancel?: () => void }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!name.trim()) return;
    setBusy(true);
    const ok = await onSave(name.trim());
    setBusy(false);
    if (ok) setName("");
  }
  return (
    <div className="flex flex-1 items-center gap-2">
      <Input aria-label={placeholder} value={name} placeholder={placeholder} autoFocus={!!onCancel} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(); if (e.key === "Escape") onCancel?.(); }} />
      <Button size="lg" disabled={busy || !name.trim()} onClick={go}>{cta}</Button>
      {onCancel && <Button size="lg" variant="ghost" onClick={onCancel}>Cancel</Button>}
    </div>
  );
}

export function CategoriesView() {
  const cats = useQuery(api.categories.list);
  const create = useMutation(api.categories.create);
  const rename = useMutation(api.categories.rename);
  const remove = useMutation(api.categories.remove);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [del, setDel] = useState<Cat | null>(null);

  const tops = cats?.filter((c) => !c.parentId) ?? [];
  const kids = (id: string) => cats?.filter((c) => c.parentId === id) ?? [];

  const add = async (name: string, parentId?: Id<"categories">) => {
    const ok = !!(await run(create({ name, parentId }).then(() => true), "Category added"));
    if (ok) setAdding(null);
    return ok;
  };

  const line = (c: Cat, child?: boolean) => {
    if (editing === c._id) {
      return (
        <div className={`flex items-center gap-2 px-4 py-2 ${child ? "pl-12" : ""}`}>
          <NameEditor initial={c.name} placeholder="Category name" cta="Save" onCancel={() => setEditing(null)}
            onSave={async (name) => { const ok = !!(await run(rename({ categoryId: c._id, name }).then(() => true), "Renamed")); if (ok) setEditing(null); return ok; }} />
        </div>
      );
    }
    return (
      <div className={`flex min-h-14 items-center gap-2 px-4 py-2 ${child ? "pl-8 sm:pl-12" : ""}`}>
        {child && <CornerDownRight className="size-4 shrink-0 text-muted-foreground" />}
        <span className={`min-w-0 flex-1 truncate ${child ? "" : "font-medium"}`}>{c.name}</span>
        {!child && <Button variant="ghost" size="lg" className="px-2.5" onClick={() => setAdding(c._id)} aria-label={`Add sub-category to ${c.name}`}><Plus /><span className="hidden sm:inline">Sub-category</span></Button>}
        <Button variant="ghost" size="icon-lg" aria-label={`Rename ${c.name}`} onClick={() => setEditing(c._id)}><Pencil /></Button>
        <Button variant="ghost" size="icon-lg" className="text-danger" aria-label={`Delete ${c.name}`} onClick={() => setDel(c)}><Trash2 /></Button>
      </div>
    );
  };

  return (
    <>
      <PageHeader title="Categories" desc="Group products so they are easy to find at the till. Two levels at most." />
      <Panel>
        <div className="flex items-center gap-2 border-b p-3"><NameEditor placeholder="New category, e.g. Drinks" cta="Add" onSave={(n) => add(n)} /></div>
        {cats === undefined ? <ListSkeleton rows={4} /> : tops.length === 0 ? (
          <EmptyState icon={FolderTree} title="No categories yet" desc="Type a name above and press Add. You can nest sub-categories inside." />
        ) : (
          <ul className="divide-y">
            {tops.map((c) => (
              <li key={c._id}>
                {line(c)}
                {kids(c._id).map((k) => <div key={k._id} className="border-t border-dashed">{line(k, true)}</div>)}
                {adding === c._id && (
                  <div className="flex items-center gap-2 border-t border-dashed bg-muted/40 px-4 py-2 pl-8 sm:pl-12">
                    <NameEditor placeholder={`Sub-category of ${c.name}`} cta="Add" onCancel={() => setAdding(null)} onSave={(n) => add(n, c._id)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title={`Delete "${del?.name}"?`}
        desc="This cannot be undone. A category that still has products or sub-categories cannot be deleted: move them first."
        confirmLabel="Delete"
        onConfirm={async () => {
          try { await remove({ categoryId: del!._id }); toast.success("Category deleted"); }
          catch { toast.error("Can't delete: this category is used by products or has sub-categories. Move or delete those first."); }
        }} />
    </>
  );
}
