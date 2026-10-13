"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConvex, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Download, FileUp, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useView } from "@/components/app-shell";
import { CustomerSheet } from "@/components/customers/customer-form";
import { ImportDialog } from "@/components/customers/import-dialog";
import { DataTable, EmptyState, FilterChips, Money, PageHeader, Panel, Pill, SearchInput, Toolbar } from "@/components/common";
import { useBiz } from "@/components/guard";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/convex/shared/errors";
import { formatCents } from "@/convex/shared/money";
import { downloadCsv } from "@/lib/csv";

type Customer = FunctionReturnType<typeof api.customers.list>[number];
type Filter = "ALL" | "DEBT" | "OVER_LIMIT" | "OVERDUE" | "BLOCKED";
type Group = "ALL" | "RETAIL" | "WHOLESALE" | "VIP";
const GROUP_LABEL = { RETAIL: "Retail", WHOLESALE: "Wholesale", VIP: "VIP" } as const;

export default function CustomersPage() {
  const me = useBiz();
  const cur = me.business.currency;
  const router = useRouter();
  const convex = useConvex();
  const view = useView("customers");
  const canManage = me.member.role !== "CASHIER";
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<Group>("ALL");
  const [filter, setFilter] = useState<Filter>(view === "debt" ? "DEBT" : "ALL");
  const [prevView, setPrevView] = useState(view);
  if (prevView !== view) { setPrevView(view); setFilter(view === "debt" ? "DEBT" : "ALL"); } // sub-menu tab drives the filter
  const [form, setForm] = useState<"new" | null>(null);
  const [importing, setImporting] = useState(false);

  const rows = useQuery(api.customers.list, {
    search: search.trim() || undefined,
    group: group === "ALL" ? undefined : group,
    filter: filter === "ALL" ? undefined : filter,
  });
  const filtered = search || group !== "ALL" || filter !== "ALL";
  const owedTotal = rows?.reduce((n, c) => n + Math.max(c.balanceCents, 0), 0) ?? 0;

  async function exportCsv() {
    try {
      const data = await convex.query(api.customers.exportCsv, {});
      downloadCsv("customers.csv", [
        ["Name", "Phone", "WhatsApp", "Type", "Company", "Group", "Address", "District", "Credit limit", "Balance"],
        ...data.map((c) => [c.fullName, c.phone, c.whatsapp, c.type, c.companyName, c.group, c.address, c.district, c.creditLimitCents / 100, c.balanceCents / 100]),
      ]);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader title="Customers" desc={rows && owedTotal > 0 ? `Customers owe you ${formatCents(owedTotal, cur)} in total.` : "People you sell to, and who owes what."}
        actions={<Button size="lg" onClick={() => setForm("new")}><Plus /> New customer</Button>} />
      <Panel>
        <Toolbar actions={canManage && (
          <>
            <Button variant="outline" onClick={() => setImporting(true)}><FileUp /><span className="hidden sm:inline">Import</span></Button>
            <Button variant="outline" onClick={exportCsv}><Download /><span className="hidden sm:inline">Export</span></Button>
          </>
        )}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name or phone" />
          <FilterChips<Group> value={group} onChange={setGroup} options={[{ value: "ALL", label: "All groups" }, { value: "RETAIL", label: "Retail" }, { value: "WHOLESALE", label: "Wholesale" }, { value: "VIP", label: "VIP" }]} />
        </Toolbar>
        <div className="border-b bg-muted/20 p-3">
          <FilterChips<Filter> value={filter} onChange={setFilter} options={[
            { value: "ALL", label: "Everyone" }, { value: "DEBT", label: "Has debt" }, { value: "OVER_LIMIT", label: "Over limit" },
            { value: "OVERDUE", label: "Overdue" }, { value: "BLOCKED", label: "Blocked" },
          ]} />
        </div>
        <DataTable<Customer>
          rows={rows}
          onRowClick={(c) => router.push(`/apps/customers/${c._id}`)}
          empty={filtered
            ? <EmptyState icon={Users} title="No customers match" desc="Try another search or filter." action={<Button variant="outline" onClick={() => { setSearch(""); setGroup("ALL"); setFilter("ALL"); }}>Clear filters</Button>} />
            : <EmptyState icon={Users} title="No customers yet" desc="Add customers to sell on credit and track what they owe." action={<Button onClick={() => setForm("new")}><Plus /> New customer</Button>} />}
          cols={[
            { header: "Customer", cell: (c) => <div className="min-w-0"><p className="font-medium">{c.fullName}</p>{c.companyName && <p className="text-xs text-muted-foreground">{c.companyName}</p>}</div> },
            { header: "Phone", cell: (c) => <span className="text-muted-foreground">{c.phone || "-"}</span> },
            { header: "Group", cell: (c) => <div className="flex flex-wrap justify-end gap-1 md:justify-start"><Pill tone={c.group === "WHOLESALE" ? "blue" : c.group === "VIP" ? "brand" : "slate"}>{GROUP_LABEL[c.group]}</Pill>{c.creditBlocked && <Pill tone="red">Blocked</Pill>}</div> },
            {
              header: "Balance", className: "text-right",
              cell: (c) => c.balanceCents > 0 ? <Money tone="out" className="font-semibold">owes {formatCents(c.balanceCents, cur)}</Money>
                : c.balanceCents < 0 ? <Money tone="in" className="font-semibold">credit {formatCents(-c.balanceCents, cur)}</Money>
                : <span className="text-muted-foreground">-</span>,
            },
            { header: "Last payment", className: "text-right", cell: (c) => c.daysSinceLastPayment === null ? <span className="text-muted-foreground">Never</span> : c.daysSinceLastPayment === 0 ? "Today" : <span className={c.balanceCents > 0 && c.daysSinceLastPayment > 30 ? "font-medium text-warning" : "text-muted-foreground"}>{c.daysSinceLastPayment} day{c.daysSinceLastPayment === 1 ? "" : "s"} ago</span> },
          ]}
        />
      </Panel>
      <CustomerSheet value={form} onClose={() => setForm(null)} onSaved={(id) => router.push(`/apps/customers/${id}`)} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </>
  );
}
