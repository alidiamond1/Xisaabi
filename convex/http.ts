import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { env, httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { identifier, object, readPayment, snapConfig, verifySnapSignature } from "./lib/snap";

const http = httpRouter();
auth.addHttpRoutes(http);

http.route({path: "/webhooks/snap", method: "POST", handler: httpAction(async (ctx, req) => {
  const config = snapConfig(env);
  if (!config) return new Response("Payments unavailable", {status: 503});
  if (Number(req.headers.get("content-length")) > 256_000) return new Response("Body too large", {status: 413});
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.length > 256_000) return new Response("Body too large", {status: 413});
  if (!await verifySnapSignature(raw, req.headers.get("X-SNAP-Signature") ?? "", config.webhookSecret)) return new Response("Invalid signature", {status: 400});
  let event: unknown;
  try { event = JSON.parse(new TextDecoder().decode(raw)); } catch { return new Response("Invalid event", {status: 400}); }
  if (!object(event) || !identifier(event.id) || !identifier(event.type) || !Number.isSafeInteger(event.created) || (config.merchantId !== "" && event.merchant_id !== config.merchantId) || event.environment !== config.environment ||
      (req.headers.has("X-SNAP-Event-Id") && req.headers.get("X-SNAP-Event-Id") !== event.id) ||
      (req.headers.has("X-SNAP-Event-Type") && req.headers.get("X-SNAP-Event-Type") !== event.type)) return new Response("Invalid event", {status: 400});
  if (event.type !== "payment.succeeded") return new Response(null, {status: 204});
  const payment = readPayment(event.data);
  if (!payment || payment.status !== "succeeded") return new Response("Invalid payment", {status: 400});
  const checkoutId = payment.metadata.xisabsax_checkout_id;
  if (!checkoutId) return new Response(null, {status: 204}); // Other products may share this merchant account.
  try {
    await ctx.runAction(internal.billing.processSnapPayment, {checkoutId, paymentId: payment.id, eventId: event.id});
    return new Response(null, {status: 204});
  } catch { return new Response("Payment verification unavailable", {status: 503}); }
})});

export default http;
