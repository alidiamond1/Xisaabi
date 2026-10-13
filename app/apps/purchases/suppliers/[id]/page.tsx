"use client";
import { use } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { SupplierDetail } from "@/components/purchases/supplier-detail";

export default function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <SupplierDetail id={id as Id<"suppliers">} />;
}
