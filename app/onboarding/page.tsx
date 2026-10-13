"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Check } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { BrandMark } from "@/components/brand";
import { BusinessFields, EMPTY_PROFILE, type Profile } from "@/components/business-fields";
import { Banner, Field, SubmitButton } from "@/components/common";
import { FullLoader as FullLoaderInline } from "@/components/guard";
import { LogoUpload } from "@/components/logo-upload";
import { PresetGrid } from "@/components/preset-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_BUSINESS_TYPES, PRESETS } from "@/convex/shared/presets";
import { errorMessage } from "@/convex/shared/errors";
import { run } from "@/lib/run";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export default function OnboardingPage() {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useSession();
  const create = useMutation(api.onboarding.createBusiness);
  const closed = useQuery(api.platformSettings.get)?.signupsOpen === false;
  const [step, setStep] = useState(1);
  const [types, setTypes] = useState<string[]>([]);
  const [fullName, setFullName] = useState("");
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [logoId, setLogoId] = useState<Id<"_storage"> | undefined>();
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) router.replace("/login");
    else if (me?.kind === "business") router.replace("/apps");
    else if (me?.kind === "platform") router.replace("/platform");
  }, [isLoading, isAuthenticated, me, router]);

  if (isLoading || me?.kind !== "needs_onboarding") return <FullLoaderInline />;

  async function finish() {
    setBusy(true);
    const id = await run(
      create({ fullName: fullName.trim(), ...profile, name: profile.name.trim(), email: profile.email.trim() || undefined, logoId, businessTypes: types }),
      "Your shop is ready!",
    );
    if (id) router.replace("/apps");
    else setBusy(false);
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:py-10">
      <div className="mb-6 flex items-center gap-2">
        <BrandMark />
        <span className="text-lg font-semibold">Xisaabi</span>
      </div>
      {closed && <div className="mb-4"><Banner tone="warning">{errorMessage({ data: "SIGNUPS_CLOSED" })}</Banner></div>}
      <ol className="mb-4 flex items-center gap-3 text-sm">
        {["What you sell", "Shop profile", "Logo"].map((l, i) => (
          <li key={l} className="flex items-center gap-2">
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full text-xs font-semibold",
                step > i + 1 ? "bg-success text-white" : step === i + 1 ? "bg-brand-600 text-white" : "bg-muted text-muted-foreground",
              )}
            >
              {step > i + 1 ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={step === i + 1 ? "font-medium" : "hidden text-muted-foreground sm:inline"}>{l}</span>
            {i < 2 && <span className="mx-1 h-px w-4 bg-border sm:w-8" />}
          </li>
        ))}
      </ol>
      <div className="rounded-xl border bg-card p-5 sm:p-6">
        {step === 1 ? (
          <div className="space-y-5">
            <div>
              <h1 className="font-display text-lg font-semibold">What do you sell?</h1>
              <p className="text-sm text-muted-foreground">Pick up to {MAX_BUSINESS_TYPES}. We set up the right fields and categories for you. You can change this later in Settings.</p>
            </div>
            <PresetGrid value={types} onChange={setTypes} />
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">{types.length} of {MAX_BUSINESS_TYPES} chosen</span>
              <Button size="lg" onClick={() => {
                const first = PRESETS.find((p) => p.key === types[0]);
                if (first) setProfile((p) => ({ ...p, businessType: first.label }));
                setStep(2);
              }}>{types.length ? "Continue" : "Skip for now"}</Button>
            </div>
          </div>
        ) : step === 2 ? (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              setStep(3);
            }}
          >
            <div>
              <h1 className="text-lg font-semibold">Tell us about your shop</h1>
              <p className="text-sm text-muted-foreground">You can change all of this later in Settings.</p>
            </div>
            <Field label="Your full name">
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={100} />
            </Field>
            <BusinessFields value={profile} onChange={setProfile} />
            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button type="submit">Continue</Button>
            </div>
          </form>
        ) : (
          <div className="space-y-5">
            <div>
              <h1 className="text-lg font-semibold">Add your logo</h1>
              <p className="text-sm text-muted-foreground">Optional. Shown in the app and on printed receipts.</p>
            </div>
            <LogoUpload
              generateUrl={api.onboarding.generateUploadUrl}
              preview={preview}
              onUploaded={(id, url) => {
                setLogoId(id);
                setPreview(url);
              }}
            />
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
              <SubmitButton busy={busy} onClick={finish}>{logoId ? "Finish" : "Skip and finish"}</SubmitButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
