"use client";
import { use } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { ProductDetail } from "@/components/inventory/product-detail";

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ProductDetail id={id as Id<"products">} />;
}
