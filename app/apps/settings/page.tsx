"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ListSkeleton, PageHeader, Panel } from "@/components/common";
import { FeaturesSection } from "@/components/settings/features-section";
import {
  CreditSection, ExpenseCategoriesSection, InventorySection, PaymentsSection, ProfileSection, ReceiptSection, SalesRulesSection,
} from "@/components/settings/sections";
import { cn } from "@/lib/utils";

const TABS = [
  { view: "business", label: "Business" }, { view: "receipt", label: "Receipt" }, { view: "payments", label: "Payments" },
  { view: "sales", label: "Sales rules" }, { view: "credit", label: "Credit" }, { view: "expenses", label: "Expense categories" }, { view: "inventory", label: "Inventory" }, { view: "features", label: "Features" },
];

export default function SettingsPage() {
  const data = useQuery(api.settings.get);
  const param = useSearchParams().get("view");
  const view = TABS.find((t) => t.view === param)?.view ?? "business";
  return (
    <>
      <PageHeader title="Settings" desc="Set up how your shop looks and works." />
      <nav aria-label="Settings sections" className="mb-5 flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <Link key={t.view} href={`/apps/settings?view=${t.view}`} aria-current={view === t.view ? "page" : undefined}
            className={cn("-mb-px inline-flex h-11 shrink-0 items-center border-b-2 px-3.5 text-sm font-medium transition-colors",
              view === t.view ? "border-brand-600 text-brand-800" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </Link>
        ))}
      </nav>
      {!data ? <Panel className="max-w-2xl"><ListSkeleton rows={5} /></Panel> : (
        // remount per section so each form starts from the saved values
        <div key={view}>
          {view === "business" && <ProfileSection biz={data.business} logoUrl={data.logoUrl} />}
          {view === "receipt" && <ReceiptSection biz={data.business} />}
          {view === "payments" && <PaymentsSection biz={data.business} />}
          {view === "sales" && <SalesRulesSection biz={data.business} />}
          {view === "credit" && <CreditSection biz={data.business} />}
          {view === "expenses" && <ExpenseCategoriesSection biz={data.business} />}
          {view === "inventory" && <InventorySection biz={data.business} />}
          {view === "features" && <FeaturesSection biz={data.business} />}
        </div>
      )}
    </>
  );
}
