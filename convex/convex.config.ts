import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import { v } from "convex/values";

const app = defineApp({ env: {
  SNAP_SECRET_KEY: v.optional(v.string()),
  SNAP_WEBHOOK_SECRET: v.optional(v.string()),
  SNAP_MERCHANT_ID: v.optional(v.string()),
  SNAP_ENVIRONMENT: v.optional(v.string()),
  SNAP_ENABLE_LIVE: v.optional(v.string()),
  SNAP_API_BASE_URL: v.optional(v.string()),
  SNAP_CHECKOUT_ORIGINS: v.optional(v.string()),
  SNAP_APP_ORIGIN: v.optional(v.string()),
  SNAP_SANDBOX_BUSINESS_IDS: v.optional(v.string()),
} });
app.use(rateLimiter);
export default app;
