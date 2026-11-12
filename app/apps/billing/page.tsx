"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Banner, ListSkeleton, Panel } from "@/components/common";
import { BillingView } from "@/components/billing/billing-view";
import { CheckoutStatus } from "@/components/billing/checkout-status";
import { errorMessage } from "@/convex/shared/errors";

const FALLBACK_PAYMENT_INFO = process.env.NEXT_PUBLIC_PAYMENT_INSTRUCTIONS ?? "Pay via EVC Plus or Zaad to the number our team sends you, then we activate your plan.";


function BillingContent() {
  const b = useQuery(api.billing.current);
  const plans = useQuery(api.billing.plans);
  const request = useMutation(api.billing.requestPlan);
  const startCheckout = useAction(api.billing.startCheckout);
  const verifyCheckout = useAction(api.billing.verifyCheckout);
  const paymentInfo = useQuery(api.platformSettings.get)?.paymentInstructions || FALLBACK_PAYMENT_INFO;
  const params = useSearchParams();
  const checkoutId = params.get("checkout");
  const paymentId = params.get("payment_id");
  const cancelled = params.get("result") === "cancel";
  const checkout = useQuery(api.billing.checkout, checkoutId ? { checkoutId } : "skip");
  const [checking, setChecking] = useState(false);
  const [verificationError, setVerificationError] = useState("");
  const [activated, setActivated] = useState(false);

  const checkPayment = useCallback(async () => {
    if (!checkoutId || !paymentId) return;
    setChecking(true);
    setVerificationError("");
    try {
      await verifyCheckout({ checkoutId, paymentId });
    } catch (e) {
      setVerificationError(errorMessage(e));
    } finally {
      setChecking(false);
    }
  }, [checkoutId, paymentId, verifyCheckout]);

  useEffect(() => {
    if (!checkoutId || !paymentId) return;
    let active = true;
    setChecking(true);
    setVerificationError("");
    verifyCheckout({ checkoutId, paymentId }).catch((e) => {
      if (active) setVerificationError(errorMessage(e));
    }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [checkoutId, paymentId, verifyCheckout]);

  return <BillingView billing={b} plans={plans} paymentInfo={paymentInfo}
    checkoutNotice={<>
      {activated && <Banner tone="success">Your free plan has been activated.</Banner>}
      {checkoutId && <CheckoutStatus checkout={checkout} checking={checking} cancelled={cancelled} error={verificationError} onVerify={paymentId ? () => void checkPayment() : undefined} />}
    </>}
    onCheckout={async (plan, period) => {
      const result = await startCheckout({ planId: plan._id, period });
      if (result.activated) setActivated(true);
      else if (result.url) window.location.assign(result.url);
      else throw new Error("Checkout is not available. Please try again or contact Support.");
    }}
    onRequest={async (plan, period) => { await request({ planId: plan._id, period }); }} />;
}

export default function BillingPage() {
  return <Suspense fallback={<Panel><ListSkeleton /></Panel>}><BillingContent /></Suspense>;
}
