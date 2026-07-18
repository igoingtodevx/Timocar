export const ADMIN_ORDER_STATUSES = ["new", "in_progress", "awaiting_customer", "completed", "cancelled"] as const;

export type AdminOrderStatus = (typeof ADMIN_ORDER_STATUSES)[number];

export type StorefrontSettings = {
  acceptingOrders: boolean;
};

export type AdminOrderUpdate = {
  status: AdminOrderStatus;
  internalNote: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INTERNAL_NOTE_LIMIT = 2_000;

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

export function normalizeStorefrontSettings(
  input: Record<string, unknown>,
  fallback: StorefrontSettings = { acceptingOrders: true },
): StorefrontSettings | { error: string } {
  if (!("acceptingOrders" in input)) return fallback;
  if (typeof input.acceptingOrders !== "boolean") return { error: "Ungültige Shop-Einstellung." };
  return { acceptingOrders: input.acceptingOrders };
}

export function canStartCheckout(settings: StorefrontSettings): boolean {
  return settings.acceptingOrders;
}

export type AdminRole = "owner" | "staff";

function configuredEmails(value: unknown): Set<string> {
  if (typeof value !== "string") return new Set();
  return new Set(value.split(",").map((item) => normalizeText(item, 254).toLowerCase()).filter((item) => EMAIL_PATTERN.test(item)));
}

export function resolveAdminRole(emailInput: unknown, ownerEmailsInput: unknown, staffEmailsInput: unknown): AdminRole | null {
  const email = normalizeText(emailInput, 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) return null;
  if (configuredEmails(ownerEmailsInput).has(email)) return "owner";
  if (configuredEmails(staffEmailsInput).has(email)) return "staff";
  return null;
}

export function isAllowedAdminEmail(emailInput: unknown, allowedEmailsInput: unknown): boolean {
  const email = normalizeText(emailInput, 254).toLowerCase();
  return EMAIL_PATTERN.test(email) && configuredEmails(allowedEmailsInput).has(email);
}

export function normalizeAdminOrderUpdate(input: Record<string, unknown>): AdminOrderUpdate | { error: string } {
  const status = normalizeText(input.status, 40);
  if (!ADMIN_ORDER_STATUSES.includes(status as AdminOrderStatus)) {
    return { error: "Ungültiger Bestellstatus." };
  }

  if (typeof input.internalNote === "string" && input.internalNote.trim().length > INTERNAL_NOTE_LIMIT) {
    return { error: "Interne Notiz ist zu lang." };
  }

  return {
    status: status as AdminOrderStatus,
    internalNote: normalizeText(input.internalNote, INTERNAL_NOTE_LIMIT),
  };
}
