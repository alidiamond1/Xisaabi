// Rate limits for the barcode features (@convex-dev/rate-limiter component).
import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

export const limiter = new RateLimiter(components.rateLimiter, {
  scanPush: { kind: "token bucket", rate: 120, period: MINUTE, capacity: 120 }, // key: session id
  lookupMinute: { kind: "token bucket", rate: 60, period: MINUTE, capacity: 60 }, // key: business id
  lookupDay: { kind: "fixed window", rate: 1000, period: 24 * 60 * MINUTE }, // key: business id
  offGlobal: { kind: "token bucket", rate: 12, period: MINUTE, capacity: 12 }, // shared Open Food Facts budget
});
