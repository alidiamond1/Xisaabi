// Error codes thrown as ConvexError(code). The UI maps them to messages.
export const ERROR_MESSAGES = {
  UNAUTHENTICATED: "Please log in again.",
  FORBIDDEN: "You don't have access to this.",
  NOT_FOUND: "Not found.",
  ACCOUNT_LOCKED: "Your account is locked. Contact your manager.",
  BUSINESS_SUSPENDED: "This business is suspended. Contact support.",
  SUBSCRIPTION_EXPIRED: "Your subscription has expired. Please renew in Billing.",
  INVALID_USERNAME: "Username must be 3–32 characters: letters, numbers, . _ -",
  USERNAME_TAKEN: "That username is already taken.",
  PASSWORD_TOO_SHORT: "Password must be at least 8 characters.",
  ALREADY_ONBOARDED: "This account already has a business.",
  PLAN_LIMIT_USERS: "Your plan's user limit is reached. Upgrade in Billing.",
  PLAN_LIMIT_PRODUCTS: "Your plan's product limit is reached. Upgrade in Billing.",
  BARCODE_EXISTS: "Another product already uses this barcode.",
  PRODUCT_EXPIRED: "This product is expired and cannot be sold.",
  INSUFFICIENT_STOCK: "Not enough stock.",
  CUSTOMER_REQUIRED: "Choose a customer for a credit sale.",
  CREDIT_LIMIT_EXCEEDED: "This sale exceeds the customer's credit limit.",
  PAYMENT_EXCEEDS_BALANCE: "Payment is more than the customer owes.",
  ALREADY_REFUNDED: "This sale is already refunded.",
  INVALID_INPUT: "Some fields are invalid.",
  EXPIRY_REQUIRED: "This product tracks expiry: enter an expiry date.",
  NO_PERMISSION: "You don't have permission for this. Ask the owner.",
  DISCOUNT_TOO_HIGH: "That discount is above your allowed limit.",
  CREDIT_BLOCKED: "Credit is blocked for this customer.",
  SHIFT_REQUIRED: "Open a cash shift first.",
  SHIFT_ALREADY_OPEN: "You already have an open shift.",
  PAYMENT_MISMATCH: "Payments don't add up to the total.",
  REFUND_TOO_MUCH: "Refund is more than what was sold.",
  REASON_REQUIRED: "Please enter a reason.",
  SKU_EXISTS: "Another product already uses this SKU.",
  CATEGORY_IN_USE: "This category has products or sub-categories. Move them first.",
  INVALID_SERIAL: "That IMEI / serial number is not valid.",
  SERIAL_EXISTS: "That IMEI / serial number is already registered.",
  SERIAL_REQUIRED: "Enter one IMEI / serial number for each unit.",
  SERIAL_NOT_AVAILABLE: "That IMEI / serial number is not in stock.",
  UNIT_BARCODE_EXISTS: "Another product or unit already uses this barcode.",
  UNKNOWN_BUSINESS_TYPE: "Unknown business type.",
  SCAN_SESSION_INVALID: "This scanner link has ended. Pair your phone again.",
  SIGNUPS_CLOSED: "New signups are closed right now. Please try again later.",
  LAST_SUPER_ADMIN: "There must be at least one active super admin.",
  RATE_LIMITED: "Too many requests. Please slow down and try again shortly.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

/** Turn any thrown error into a user-facing message. */
export function errorMessage(err: unknown): string {
  const data = (err as { data?: unknown })?.data;
  if (typeof data === "string" && data in ERROR_MESSAGES) {
    return ERROR_MESSAGES[data as ErrorCode];
  }
  return "Something went wrong. Please try again.";
}
