"use client";
import { useMemo } from "react";
import { useBiz } from "@/components/guard";
import { businessFeatures, mergePresets, type AttributeDef, type Feature } from "@/convex/shared/presets";

/** Features switched on for this shop. v2 shops without the field get the v2 defaults from the backend. */
export function useFeatures(): Feature[] {
  const { business } = useBiz();
  return useMemo(() => businessFeatures(business), [business]);
}

/** Is one feature on? Hide its UI when false (stored data is kept). */
export function useFeature(f: Feature): boolean {
  return useFeatures().includes(f);
}

/** Extra product fields this shop defined (Settings > Features). */
export function useAttributeDefs(): AttributeDef[] {
  const { business } = useBiz();
  return business.attributeDefs ?? [];
}

/** Pack/unit names to suggest, from the shop's business types. */
export function useUnitSuggestions(): string[] {
  const { business } = useBiz();
  return useMemo(() => mergePresets(business.businessTypes ?? []).units, [business.businessTypes]);
}
