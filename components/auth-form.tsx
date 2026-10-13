"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Banner, Field, SubmitButton } from "@/components/common";
import { errorMessage } from "@/convex/shared/errors";
import { normalizeUsername } from "@/convex/shared/username";
import { useSession } from "@/lib/session";

export function AuthForm({ mode }: { mode: "signIn" | "signUp" }) {
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const me = useSession();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const signup = mode === "signUp";
  const closed = useQuery(api.platformSettings.get)?.signupsOpen === false;

  useEffect(() => {
    if (!isAuthenticated || !me) return;
    // back to the page that sent us here (e.g. the phone-scanner QR link); same-site /apps paths only
    const next = new URLSearchParams(window.location.search).get("next");
    const back = me.kind === "business" && next?.startsWith("/apps/") && !next.startsWith("//") ? next : null;
    router.replace(me.kind === "needs_onboarding" ? "/onboarding" : me.kind === "platform" ? "/platform" : back ?? "/apps");
  }, [isAuthenticated, me, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const u = normalizeUsername(username);
    if (!u) return toast.error(errorMessage({ data: "INVALID_USERNAME" }));
    if (signup && password.length < 8) return toast.error(errorMessage({ data: "PASSWORD_TOO_SHORT" }));
    setBusy(true);
    try {
      await signIn("password", { flow: mode, username: u, password });
    } catch (err) {
      // Auth errors often reach the client without ConvexError data; keep the message friendly.
      const known = (err as { data?: unknown })?.data;
      toast.error(known ? errorMessage(err) : signup ? "Could not create the account. That username may be taken." : "Wrong username or password.");
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2">
          <BrandMark />
          <span className="font-display text-xl font-semibold tracking-tight">Xisaabi</span>
        </Link>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border bg-card p-6 shadow-pop">
          {signup && closed && <Banner tone="warning">{errorMessage({ data: "SIGNUPS_CLOSED" })}</Banner>}
          <div>
            <h1 className="text-lg font-semibold">{signup ? "Start your free trial" : "Welcome back"}</h1>
            <p className="text-sm text-muted-foreground">
              {signup ? "Create your account, then set up your shop." : "Log in to manage your shop."}
            </p>
          </div>
          <Field label="Username" hint={signup ? "3 to 32 characters: letters, numbers, . _ -" : undefined}>
            <Input autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </Field>
          <Field label="Password" hint={signup ? "At least 8 characters." : undefined}>
            <Input
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <SubmitButton type="submit" busy={busy} className="w-full">
            {signup ? "Create account" : "Log in"}
          </SubmitButton>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {signup ? "Already have an account?" : "New to Xisaabi?"}{" "}
          <Button asChild variant="link" className="h-auto p-0">
            <Link href={signup ? "/login" : "/signup"}>{signup ? "Log in" : "Start free trial"}</Link>
          </Button>
        </p>
      </div>
    </div>
  );
}
