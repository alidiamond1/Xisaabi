"use client";
import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { FileUp, Download } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Banner, SubmitButton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/convex/shared/errors";
import { parseToCents } from "@/convex/shared/money";
import { downloadCsv, parseCsv } from "@/lib/csv";
import { parseSigned } from "@/components/customers/customer-form";

type Row = { fullName: string; phone: string; group?: "RETAIL" | "WHOLESALE" | "VIP"; openingBalanceCents?: number; creditLimitCents?: number };
type Parsed = { n: number; row?: Row; error?: string };

const HEAD: Record<string, "name" | "phone" | "group" | "opening" | "limit"> = {
  name: "name", fullname: "name", customer: "name", phone: "phone", mobile: "phone", tel: "phone", group: "group",
  opening: "opening", openingbalance: "opening", balance: "opening", owes: "opening", limit: "limit", creditlimit: "limit",
};

function parse(text: string): Parsed[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const idx: Partial<Record<"name" | "phone" | "group" | "opening" | "limit", number>> = {};
  rows[0].forEach((h, i) => { const k = HEAD[h.toLowerCase().replace(/[^a-z]/g, "")]; if (k && idx[k] === undefined) idx[k] = i; });
  const cell = (r: string[], k: keyof typeof idx) => (idx[k] === undefined ? "" : (r[idx[k]!] ?? "").trim());
  return rows.slice(1).map((r, i) => {
    const n = i + 1;
    const fullName = cell(r, "name");
    if (!fullName) return { n, error: "Name is empty" };
    const g = cell(r, "group").toUpperCase();
    if (g && !["RETAIL", "WHOLESALE", "VIP"].includes(g)) return { n, error: `Unknown group "${g}"` };
    const opening = cell(r, "opening") ? parseSigned(cell(r, "opening")) : 0;
    const limit = cell(r, "limit") ? parseToCents(cell(r, "limit")) : 0;
    if (opening === null || limit === null) return { n, error: "Amount is not a number" };
    return { n, row: { fullName, phone: cell(r, "phone"), group: (g || undefined) as Row["group"], openingBalanceCents: opening, creditLimitCents: limit } };
  });
}

/** Paste or upload a CSV, check it, then import (owner/manager). */
export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const importCsv = useMutation(api.customers.importCsv);
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: { row: number; reason: string }[] }>();
  const parsed = parse(text);
  const good = parsed.filter((p) => p.row).map((p) => p.row!);
  const bad = parsed.filter((p) => p.error);
  const close = () => { setText(""); setResult(undefined); onClose(); };

  async function go() {
    setBusy(true);
    try {
      const r = await importCsv({ rows: good.slice(0, 500) });
      setResult(r);
      if (r.created) toast.success(`${r.created} customer${r.created === 1 ? "" : "s"} added`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import customers</DialogTitle>
          <DialogDescription>Columns: name, phone, group (optional), opening balance (optional), credit limit (optional). Up to 500 rows.</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3">
            <Banner tone="success">{result.created} added, {result.skipped.length} skipped.</Banner>
            {result.skipped.length > 0 && (
              <ul className="max-h-48 divide-y overflow-y-auto rounded-xl border text-sm">
                {result.skipped.map((s) => <li key={s.row} className="flex justify-between gap-3 px-3 py-2"><span>Row {s.row}</span><span className="text-danger">{s.reason}</span></li>)}
              </ul>
            )}
            <DialogFooter><Button size="lg" onClick={close}>Done</Button></DialogFooter>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="lg" onClick={() => file.current?.click()}><FileUp /> Choose CSV file</Button>
              <Button variant="ghost" size="lg" onClick={() => downloadCsv("customers-template.csv", [["name", "phone", "group", "opening balance", "credit limit"], ["Ahmed Ali", "615123456", "RETAIL", "0", "50"]])}><Download /> Template</Button>
              <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV file"
                onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = ""; }} />
            </div>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder={"name,phone,group\nAhmed Ali,615123456,RETAIL"} aria-label="CSV text" className="font-mono text-xs" />
            {parsed.length > 0 && (
              <div className="space-y-2 text-sm">
                <p><span className="font-semibold text-success">{good.length} ready</span>{bad.length > 0 && <span className="font-semibold text-danger"> · {bad.length} with problems</span>}{good.length > 500 && " · only the first 500 will be imported"}</p>
                <ul className="max-h-40 divide-y overflow-y-auto rounded-xl border">
                  {bad.map((p) => <li key={p.n} className="flex justify-between gap-3 bg-danger-soft px-3 py-2 text-danger"><span>Row {p.n}</span><span>{p.error}</span></li>)}
                  {parsed.filter((p) => p.row).slice(0, 8).map((p) => <li key={p.n} className="flex justify-between gap-3 px-3 py-2"><span className="font-medium">{p.row!.fullName}</span><span className="text-muted-foreground">{p.row!.phone || "no phone"}</span></li>)}
                </ul>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" size="lg" onClick={close}>Cancel</Button>
              <SubmitButton size="lg" busy={busy} disabled={good.length === 0} onClick={go}>Import {good.length || ""}</SubmitButton>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
