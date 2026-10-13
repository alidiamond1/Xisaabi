"use client";
import { use } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ListSkeleton, PageHeader, Panel } from "@/components/common";
import { ProductForm } from "@/components/inventory/product-form";

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const d = useQuery(api.products.get, { productId: id as Id<"products"> });
  return (
    <>
      <PageHeader title={d ? `Edit ${d.product.name}` : "Edit product"} back={{ href: `/apps/inventory/${id}`, label: "Back to product" }}
        desc="Stock can't be changed here. Use Adjust stock or Receive stock." />
      {d === undefined ? <Panel><ListSkeleton rows={8} /></Panel> : <ProductForm initial={d} />}
    </>
  );
}
