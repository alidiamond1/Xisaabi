"use client";
import { useView } from "@/components/app-shell";
import { CategoriesView } from "@/components/inventory/categories-view";
import { LowStockView } from "@/components/inventory/low-stock-view";
import { MovesView } from "@/components/inventory/moves-view";
import { SerialsView } from "@/components/inventory/serials-view";
import { ProductsView } from "@/components/inventory/products-view";
import { StocktakeView } from "@/components/inventory/stocktake-view";
import { ValuationView } from "@/components/inventory/valuation-view";

export default function InventoryPage() {
  const view = useView("inventory");
  switch (view) {
    case "categories": return <CategoriesView />;
    case "moves": return <MovesView />;
    case "stocktake": return <StocktakeView />;
    case "low": return <LowStockView />;
    case "valuation": return <ValuationView />;
    case "serials": return <SerialsView />;
    default: return <ProductsView />;
  }
}
