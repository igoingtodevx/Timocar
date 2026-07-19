import { createHash, randomBytes } from "node:crypto";
import { Pool } from "pg";
import type { AdminOrderStatus, AdminRole, StorefrontSettings } from "../shared/admin.js";

type PaidCheckoutSession = {
  id: string;
  metadata: Record<string, string> | null;
  customer_details: { email: string | null } | null;
  customer_email: string | null;
  amount_total: number | null;
  currency: string | null;
};

export type AdminOrder = {
  stripeSessionId: string;
  customerEmail: string;
  amountCents: number;
  currency: string;
  status: AdminOrderStatus;
  emailStatus: "pending" | "sent" | "failed";
  internalNote: string;
  criteria: Record<string, string>;
  paidAt: string;
  updatedAt: string;
};

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rowCount: number | null; rows: Record<string, unknown>[] }> };

let pool: Pool | undefined;

function db(): Queryable {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is missing");
  pool ??= new Pool({ connectionString, ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false } });
  return pool;
}

function rowToOrder(row: Record<string, unknown>): AdminOrder {
  return {
    stripeSessionId: String(row.stripe_session_id),
    customerEmail: String(row.customer_email),
    amountCents: Number(row.amount_cents),
    currency: String(row.currency),
    status: row.status as AdminOrderStatus,
    emailStatus: row.email_status === "sent" || row.email_status === "failed" ? row.email_status : "pending",
    internalNote: String(row.internal_note ?? ""),
    criteria: (row.criteria && typeof row.criteria === "object" ? row.criteria : {}) as Record<string, string>,
    paidAt: new Date(String(row.paid_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function getStorefrontSettings(): Promise<StorefrontSettings> {
  if (!databaseConfigured()) return { acceptingOrders: true };
  const result = await db().query("SELECT accepting_orders FROM storefront_settings WHERE singleton = TRUE");
  return { acceptingOrders: result.rows[0]?.accepting_orders !== false };
}

export async function setStorefrontSettings(settings: StorefrontSettings, updatedBy: string): Promise<StorefrontSettings> {
  const result = await db().query(
    `INSERT INTO storefront_settings (singleton, accepting_orders, updated_at, updated_by)
     VALUES (TRUE, $1, NOW(), $2)
     ON CONFLICT (singleton) DO UPDATE SET accepting_orders = EXCLUDED.accepting_orders, updated_at = NOW(), updated_by = EXCLUDED.updated_by
     RETURNING accepting_orders`,
    [settings.acceptingOrders, updatedBy],
  );
  return { acceptingOrders: result.rows[0]?.accepting_orders === true };
}

export async function recordPaidOrder(session: PaidCheckoutSession): Promise<void> {
  if (!databaseConfigured()) return;
  const metadata = session.metadata ?? {};
  const customerEmail = session.customer_details?.email ?? session.customer_email ?? metadata.email ?? "";
  if (!customerEmail) throw new Error("Paid checkout has no customer email");

  await db().query(
    `INSERT INTO orders (stripe_session_id, customer_email, amount_cents, currency, criteria, paid_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())
     ON CONFLICT (stripe_session_id) DO UPDATE SET customer_email = EXCLUDED.customer_email, amount_cents = EXCLUDED.amount_cents, currency = EXCLUDED.currency, criteria = EXCLUDED.criteria, updated_at = NOW()`,
    [session.id, customerEmail, session.amount_total ?? 0, session.currency ?? "eur", JSON.stringify(metadata)],
  );
}

export async function listOrders(limit = 100): Promise<AdminOrder[]> {
  const result = await db().query(
    `SELECT stripe_session_id, customer_email, amount_cents, currency, status, email_status, internal_note, criteria, paid_at, updated_at
     FROM orders ORDER BY paid_at DESC LIMIT $1`,
    [Math.max(1, Math.min(limit, 250))],
  );
  return result.rows.map(rowToOrder);
}

export async function updateOrder(stripeSessionId: string, update: { status: AdminOrderStatus; internalNote: string }, updatedBy: string): Promise<AdminOrder | null> {
  const result = await db().query(
    `UPDATE orders SET status = $2, internal_note = $3, updated_at = NOW(), updated_by = $4
     WHERE stripe_session_id = $1
     RETURNING stripe_session_id, customer_email, amount_cents, currency, status, email_status, internal_note, criteria, paid_at, updated_at`,
    [stripeSessionId, update.status, update.internalNote, updatedBy],
  );
  return result.rows[0] ? rowToOrder(result.rows[0]) : null;
}

export async function reserveStripeWebhookEvent(eventId: string, sessionId: string): Promise<"created" | "duplicate"> {
  const result = await db().query(
    "INSERT INTO stripe_webhook_events (event_id, stripe_session_id, status) VALUES ($1, $2, 'received') ON CONFLICT (event_id) DO NOTHING RETURNING event_id",
    [eventId, sessionId],
  );
  return result.rowCount === 1 ? "created" : "duplicate";
}

export async function updateStripeWebhookEvent(eventId: string, status: string): Promise<void> {
  await db().query("UPDATE stripe_webhook_events SET status = $2, updated_at = NOW() WHERE event_id = $1", [eventId, status]);
}

export async function setOrderEmailStatus(stripeSessionId: string, emailStatus: "sent" | "failed"): Promise<void> {
  if (!databaseConfigured()) return;
  await db().query("UPDATE orders SET email_status = $2, updated_at = NOW() WHERE stripe_session_id = $1", [stripeSessionId, emailStatus]);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createMagicLink(email: string, role: AdminRole): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  await db().query("DELETE FROM admin_magic_links WHERE expires_at < NOW() OR used_at IS NOT NULL");
  await db().query(
    "INSERT INTO admin_magic_links (token_hash, email, role, expires_at) VALUES ($1, $2, $3, $4)",
    [hashToken(token), email, role, expiresAt],
  );
  return { token, expiresAt };
}

export async function redeemMagicLink(token: string): Promise<{ sessionToken: string; email: string; role: AdminRole } | null> {
  const result = await db().query(
    `UPDATE admin_magic_links SET used_at = NOW()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
     RETURNING email, role`,
    [hashToken(token)],
  );
  const email = result.rows[0]?.email;
  const role = result.rows[0]?.role;
  if (typeof email !== "string" || (role !== "owner" && role !== "staff")) return null;

  const sessionToken = newToken();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60_000);
  await db().query("DELETE FROM admin_sessions WHERE expires_at < NOW()");
  await db().query(
    "INSERT INTO admin_sessions (token_hash, email, role, expires_at) VALUES ($1, $2, $3, $4)",
    [hashToken(sessionToken), email, role, expiresAt],
  );
  return { sessionToken, email, role };
}

export async function getAdminSession(sessionToken: string | undefined): Promise<{ email: string; role: AdminRole } | null> {
  if (!sessionToken) return null;
  const result = await db().query(
    "SELECT email, role FROM admin_sessions WHERE token_hash = $1 AND expires_at > NOW()",
    [hashToken(sessionToken)],
  );
  const email = result.rows[0]?.email;
  const role = result.rows[0]?.role;
  return typeof email === "string" && (role === "owner" || role === "staff") ? { email, role } : null;
}

export async function writeAuditLog(actorEmail: string, action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown> = {}): Promise<void> {
  await db().query(
    "INSERT INTO admin_audit_log (actor_email, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)",
    [actorEmail, action, entityType, entityId, JSON.stringify(metadata)],
  );
}

export async function deleteAdminSession(sessionToken: string | undefined): Promise<void> {
  if (!sessionToken) return;
  await db().query("DELETE FROM admin_sessions WHERE token_hash = $1", [hashToken(sessionToken)]);
}
