"use client";
import { createContext, useContext, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useSession, type BusinessSession, type PlatformSession } from "@/lib/session";
import { clearOnLogout } from "@/lib/outbox";
import { APP_ROLES, canOpenApp, type AppKey } from "@/convex/shared/modules";

const BizCtx = createContext<BusinessSession | null>(null);
const PlatCtx = createContext<PlatformSession | null>(null);

export function useBiz() {
  const v = useContext(BizCtx);
  if (!v) throw new Error("useBiz outside business guard");
  return v;
}
export function usePlatform() {
  const v = useContext(PlatCtx);
  if (!v) throw new Error("usePlatform outside platform guard");
  return v;
}

export function FullLoader() {
  return (
    <div className="grid min-h-screen place-items-center text-muted-foreground">
      <Loader2 className="size-6 animate-spin" />
    </div>
  );
}

const LOCK_OK: string[] = ["billing", "support", "settings"];

function LockedScreen({ me, owner }: { me: BusinessSession; owner: boolean }) {
  const { signOut } = useAuthActions();
  const router = useRouter();
  const suspended = me.lockReason === "BUSINESS_SUSPENDED" || me.business.status === "SUSPENDED";
  if (me.lockReason === "ACCOUNT_LOCKED") {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="max-w-md rounded-xl border bg-white p-8 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-red-100 text-red-600"><Lock className="size-6" /></div>
          <h1 className="text-xl font-semibold">Account locked</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your account at {me.business.name} is locked. Please contact your manager.</p>
          <Button className="mt-6" variant="ghost" onClick={() => signOut().then(clearOnLogout).then(() => router.replace("/login"))}>Log out</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="max-w-md rounded-xl border bg-white p-8 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-red-100 text-red-600"><Lock className="size-6" /></div>
        <h1 className="text-xl font-semibold">{suspended ? "Business suspended" : "Subscription expired"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {suspended
            ? `${me.business.name} has been suspended${me.business.suspendedReason ? `: ${me.business.suspendedReason}` : "."}`
            : `The subscription for ${me.business.name} has expired.`}
          {owner ? " Open Billing to renew or Support to contact us." : " Please contact the business owner."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {owner && <Button asChild><Link href="/apps/billing">Billing</Link></Button>}
          {owner && <Button asChild variant="outline"><Link href="/apps/support">Support</Link></Button>}
          <Button variant="ghost" onClick={() => signOut().then(clearOnLogout).then(() => router.replace("/login"))}>Log out</Button>
        </div>
      </div>
    </div>
  );
}

/** One guard for /apps* and /platform*. */
export function SessionGuard({ kind, children }: { kind: "business" | "platform"; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useSession();

  let redirect: string | null = null;
  if (!isLoading) {
    if (!isAuthenticated) redirect = `/login?next=${encodeURIComponent(pathname)}`;
    else if (me) {
      if (me.kind === "needs_onboarding") redirect = "/onboarding";
      else if (me.kind === "platform" && kind === "business") redirect = "/platform";
      else if (me.kind === "business" && kind === "platform") redirect = "/apps";
    }
  }
  useEffect(() => { if (redirect) router.replace(redirect); }, [redirect, router]);

  // Per-app access (business side)
  const seg = kind === "business" ? (pathname.split("/")[2] as AppKey | undefined) : undefined;
  const denied = me?.kind === "business" && seg !== undefined && seg in APP_ROLES && !canOpenApp(me.member.role as never, me.plan.modules, seg);
  useEffect(() => { if (denied) router.replace("/apps"); }, [denied, router]);

  if (isLoading || me === undefined || redirect || denied || me === null) return <FullLoader />;
  if (me.kind !== kind) return <FullLoader />;

  if (me.kind === "platform") return <PlatCtx.Provider value={me}>{children}</PlatCtx.Provider>;
  if (me.kind === "business") {
    const owner = me.member.role === "OWNER";
    const allowedWhenLocked = owner && seg !== undefined && LOCK_OK.includes(seg);
    if (me.lockReason && !allowedWhenLocked && !(owner && pathname === "/apps")) {
      return <LockedScreen me={me} owner={owner} />;
    }
    return <BizCtx.Provider value={me}>{children}</BizCtx.Provider>;
  }
  return <FullLoader />;
}
