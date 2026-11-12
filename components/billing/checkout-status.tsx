"use client";
import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Banner } from "@/components/common";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/convex/shared/money";

export function CheckoutStatus({ checkout, checking, cancelled, error, onVerify }: {
  checkout: FunctionReturnType<typeof api.billing.checkout> | undefined;
  checking: boolean; cancelled: boolean; error: string; onVerify?: () => void;
}) {
  if (checkout === undefined) return <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden className="size-4 animate-spin" />Loading payment status…</div>;
  if (checkout === null) return <Banner tone="danger">This checkout could not be found. Choose a plan below, or contact Support if money was deducted.</Banner>;
  if (checkout.status === "PAID") return <Banner tone="success">{checkout.environment === "sandbox" ? "Test payment verified." : "Payment verified."} Your {checkout.planName} plan has been updated.</Banner>;
  if (checkout.status === "EXPIRED") return <Banner tone="warning">This checkout expired. Choose a plan below to start a new payment. If money was deducted, contact Support before paying again.</Banner>;
  return <div className="space-y-2">
    <Banner tone={error ? "danger" : "info"}>{error || (checking ? "Checking your payment with SNAP…" : cancelled ? "You left checkout without a confirmed payment. Your subscription has not been changed by this return." : "Your payment is pending. Your subscription updates only after SNAP confirms payment.")}<span className="mt-1 block break-words">{checkout.planName} · {checkout.period === "yearly" ? "Yearly" : "Monthly"} · {formatCents(checkout.amountCents)}{checkout.environment === "sandbox" && " · Sandbox test"}</span></Banner>
    <div className="flex flex-wrap gap-2">{onVerify && <Button type="button" variant="outline" size="lg" disabled={checking} onClick={onVerify}>{checking && <Loader2 aria-hidden className="size-4 animate-spin" />}Check payment again</Button>}<Button asChild variant="ghost" size="lg"><Link href="/apps/billing" replace>Close payment notice</Link></Button></div>
  </div>;
}
