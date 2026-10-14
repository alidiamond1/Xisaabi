// Rate limits for the barcode features and platform buttons (@convex-dev/rate-limiter component).
import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

export const limiter = new RateLimiter(components.rateLimiter, {
  scanPush: { kind: "token bucket", rate: 120, period: MINUTE, capacity: 120 }, // key: session id
  lookupMinute: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 10 }, // key: business id
  lookupDay: { kind: "fixed window", rate: 1000, period: 24 * 60 * MINUTE }, // key: business id
  statsRefresh: { kind: "fixed window", rate: 1, period: MINUTE }, // platform "Refresh now", global
  paymentRecord: { kind: "fixed window", rate: 1, period: MINUTE / 2 }, // key: identical payment — stops double-click double credit
  uploadOnboarding: { kind: "fixed window", rate: 5, period: 60 * MINUTE }, // key: user id
  uploadUrl: { kind: "fixed window", rate: 30, period: 60 * MINUTE }, // key: member id (products + settings)
  supportCreate: { kind: "fixed window", rate: 10, period: 60 * MINUTE }, // key: member id
  supportReply: { kind: "fixed window", rate: 60, period: 60 * MINUTE }, // key: member id
  offGlobal: { kind: "token bucket", rate: 12, period: MINUTE, capacity: 12 }, // shared Open Food Facts budget
});
