"use client";
import { useView } from "@/components/app-shell";
import { HistoryView } from "@/components/purchases/history-view";
import { ReceiveView } from "@/components/purchases/receive-view";
import { SuppliersView } from "@/components/purchases/suppliers-view";

export default function PurchasesPage() {
  const view = useView("purchases");
  if (view === "history") return <HistoryView />;
  if (view === "suppliers") return <SuppliersView />;
  return <ReceiveView />;
}
