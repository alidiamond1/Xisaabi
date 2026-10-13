"use client";
import { PageHeader } from "@/components/common";
import { ProductForm } from "@/components/inventory/product-form";

export default function NewProductPage() {
  return (
    <>
      <PageHeader title="New product" desc="Fill in what you know. You can change everything later." back={{ href: "/apps/inventory", label: "Products" }} />
      <ProductForm />
    </>
  );
}
