"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BrandMark } from "@/components/brand";
import { EMPTY_PROFILE } from "@/components/business-fields";
import { SIGNUP_EMAIL } from "@/components/auth-form";
import { Banner, Field, SubmitButton } from "@/components/common";
import { FullLoader as FullLoaderInline } from "@/components/guard";
import { PresetGrid } from "@/components/preset-picker";
import { Input } from "@/components/ui/input";
import { MAX_BUSINESS_TYPES, PRESETS } from "@/convex/shared/presets";
import { errorMessage } from "@/convex/shared/errors";
import { run } from "@/lib/run";
import { useSession } from "@/lib/session";

export default function OnboardingPage() {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useSession();
  const create = useMutation(api.onboarding.createBusiness);
  const closed = useQuery(api.platformSettings.get)?.signupsOpen === false;
  const [types, setTypes] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) router.replace("/login");
    else if (me?.kind === "business") router.replace("/apps");
    else if (me?.kind === "platform") router.replace("/platform");
  }, [isLoading, isAuthenticated, me, router]);

  if (isLoading || me?.kind !== "needs_onboarding") return <FullLoaderInline />;

  // One short step: shop name + what you sell. Phone, address, logo etc. are filled later in Settings.
  async function finish(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    let email: string | undefined;
    try { email = sessionStorage.getItem(SIGNUP_EMAIL) || undefined; } catch { /* private mode */ }
    const preset = PRESETS.find((p) => p.key === types[0]);
    const id = await run(
      create({ name: name.trim(), businessType: preset?.label ?? EMPTY_PROFILE.businessType, country: EMPTY_PROFILE.country, currency: EMPTY_PROFILE.currency, email, businessTypes: types }),
      "Your shop is ready!",
    );
    if (id) {
      try { sessionStorage.removeItem(SIGNUP_EMAIL); } catch { /* ignore */ }
      router.replace("/apps");
    } else setBusy(false);
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:py-10">
      <div className="mb-6 flex items-center gap-2">
        <BrandMark />
        <span className="text-lg font-semibold">XisabSax</span>
      </div>
      {closed && <div className="mb-4"><Banner tone="warning">{errorMessage({ data: "SIGNUPS_CLOSED" })}</Banner></div>}
      <form onSubmit={finish} className="space-y-5 rounded-xl border bg-card p-5 sm:p-6">
        <div>
          <h1 className="font-display text-lg font-semibold">Set up your shop</h1>
          <p className="text-sm text-muted-foreground">Just two things. Add your phone, address and logo later in Settings.</p>
        </div>
        <Field label="Shop name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} placeholder="e.g. Hodan Mini Market" />
        </Field>
        <div className="space-y-2">
          <p className="text-sm font-medium">What do you sell? <span className="font-normal text-muted-foreground">Pick up to {MAX_BUSINESS_TYPES}, or skip.</span></p>
          <PresetGrid value={types} onChange={setTypes} />
        </div>
        <div className="sticky bottom-0 -mx-5 flex items-center justify-between gap-3 border-t bg-card px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:border-0 sm:p-0">
          <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">{types.length} of {MAX_BUSINESS_TYPES} chosen</span>
          <SubmitButton type="submit" size="lg" busy={busy} disabled={!name.trim()}>Start selling</SubmitButton>
        </div>
      </form>
    </div>
  );
}
