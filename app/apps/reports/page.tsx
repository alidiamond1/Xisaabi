"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/common";
import { useBiz } from "@/components/guard";
import { RangeBar, useDateRange } from "@/components/reports/bits";
import { DebtsView, StockValueView } from "@/components/reports/debts-stock";
import { OverviewView } from "@/components/reports/overview";
import { PnlView } from "@/components/reports/pnl";
import { SalesByView } from "@/components/reports/sales-by";
import { cn } from "@/lib/utils";

const TABS = [
  { view: "overview", label: "Overview" }, { view: "pnl", label: "Profit & Loss" }, { view: "sales", label: "Sales by" },
  { view: "debts", label: "Debts" }, { view: "stock", label: "Stock value" },
];

export default function ReportsPage() {
  const me = useBiz();
  const r = useDateRange("month");
  const param = useSearchParams().get("view");
  const tabs = TABS.filter((t) => t.view !== "stock" || me.plan.modules.includes("inventory"));
  const view = tabs.find((t) => t.view === param)?.view ?? "overview";
  const dated = view === "overview" || view === "pnl" || view === "sales";

  return (
    <>
      <PageHeader title="Reports" desc="Profit, trends and who owes what." />
      <nav aria-label="Report sections" className="mb-4 flex gap-1 overflow-x-auto border-b">
        {tabs.map((t) => (
          <Link key={t.view} href={`/apps/reports?view=${t.view}`} aria-current={view === t.view ? "page" : undefined}
            className={cn("-mb-px inline-flex h-11 shrink-0 items-center border-b-2 px-3.5 text-sm font-medium transition-colors",
              view === t.view ? "border-brand-600 text-brand-800" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </Link>
        ))}
      </nav>
      {dated && <div className="mb-4 flex flex-wrap items-center gap-2"><RangeBar r={r} /></div>}
      {view === "overview" && <OverviewView r={r} />}
      {view === "pnl" && <PnlView r={r} />}
      {view === "sales" && <SalesByView r={r} />}
      {view === "debts" && <DebtsView />}
      {view === "stock" && <StockValueView />}
    </>
  );
}
