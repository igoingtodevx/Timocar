/**
 * AutoWunsch.com — Express Backend (Vercel Serverless Compatible)
 *
 * Endpoints:
 *   POST /api/analyze-car      → Gemini + Google Search Grounding
 *   POST /api/create-checkout  → Stripe Checkout Session (49€)
 *   POST /api/stripe-webhook   → Stripe Webhook → E-Mail an Owner
 */

import express from "express";
import type { Request, Response } from "express";
import { waitUntil } from "@vercel/functions";
import { BlobPreconditionFailedError, get as getBlob, head as headBlob, put as putBlob } from "@vercel/blob";
import { GoogleGenAI } from "@google/genai";
import Stripe from "stripe";
import nodemailer from "nodemailer";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import {
  CONSENT_VERSION,
  DELIVERY_WINDOW,
  PRODUCT_NAME,
  PRODUCT_PRICE_CENTS,
  type OrderFormData,
  validateOrderForm,
  hasOrderFormErrors,
} from "../shared/order.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────
//  Env validation
// ─────────────────────────────────────────────
const REQUIRED_ENV = ["GEMINI_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "OWNER_EMAIL", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "APP_URL"];
for (const key of REQUIRED_ENV) {
  const isMissing = key === "APP_URL"
    ? !process.env.APP_URL && !process.env.VERCEL_URL
    : !process.env[key];
  if (isMissing) {
    console.warn(`⚠️  Missing env variable: ${key} — some features may not work`);
  }
}

// ─────────────────────────────────────────────
//  Clients
//  Lazy init: Stripe / Nodemailer erst bei Bedarf instanziieren, damit
//  das Modul nicht beim Import crasht, wenn ein Env-Var fehlt (sonst wirft
//  Vercel Serverless "FUNCTION_INVOCATION_FAILED" und kein Endpoint antwortet).
// ─────────────────────────────────────────────
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is missing. Add it in Vercel → Project → Settings → Environment Variables.");
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function getMailer() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error("SMTP_HOST / SMTP_USER / SMTP_PASS are missing. Add them in Vercel env vars.");
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// ─────────────────────────────────────────────
//  In-memory rate limiter & cache
// ─────────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60_000;
const MAX_ANALYSIS_QUERY_LENGTH = 120;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

const SERVICE_DESCRIPTION = "3 handgeprüfte Fahrzeuglinks von Verkaufsplattformen innerhalb von 48 Stunden.";
const CHECKOUT_CANCEL_PATH = "/?payment=cancelled";
const CHECKOUT_SUCCESS_PATH = "/?payment=success&session_id={CHECKOUT_SESSION_ID}";
const WITHDRAWAL_ERROR = "Widerruf konnte nicht verarbeitet werden.";
const METADATA_VALUE_LIMIT = 500;
const ORDER_TEXT_LIMITS: Record<keyof OrderFormData, number> = {
  budget: 32,
  brand: 120,
  model: 120,
  maxMileage: 32,
  bodyType: 60,
  transmission: 60,
  drive: 60,
  accidentFree: 20,
  color: 40,
  notes: 500,
  email: 254,
  acceptTerms: 5,
  startBeforeWithdrawal: 5,
  acknowledgeWithdrawalLoss: 5,
};

type Metadata = Record<string, string>;
type WithdrawalInput = {
  name?: unknown;
  email?: unknown;
  reference?: unknown;
  ref?: unknown;
  orderRef?: unknown;
  declaration?: unknown;
};

type NormalizedWithdrawal = {
  name: string;
  email: string;
  reference: string;
  declaration: string;
};

function getClientIp(req: Request): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
}

export function normalizeVehicleAnalysisInput(query: unknown): { value: string; cacheKey: string; error?: never } | { error: string } {
  if (typeof query !== "string") return { error: "Bitte gib ein gültiges Automodell ein." };
  const value = query.trim().replace(/\s+/g, " ");
  if (!value) return { error: "Bitte gib ein Automodell ein." };
  if (value.length > MAX_ANALYSIS_QUERY_LENGTH) return { error: `Bitte beschränke die Anfrage auf ${MAX_ANALYSIS_QUERY_LENGTH} Zeichen.` };
  return { value, cacheKey: value.toLowerCase() };
}

function trimString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function normalizeBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "on" || value === "1";
}

export function normalizeOrderFormData(input: Partial<OrderFormData> | Record<string, unknown>): OrderFormData {
  return {
    budget: trimString(input.budget, ORDER_TEXT_LIMITS.budget),
    brand: trimString(input.brand, ORDER_TEXT_LIMITS.brand),
    model: trimString(input.model, ORDER_TEXT_LIMITS.model),
    maxMileage: trimString(input.maxMileage, ORDER_TEXT_LIMITS.maxMileage),
    bodyType: trimString(input.bodyType, ORDER_TEXT_LIMITS.bodyType),
    transmission: trimString(input.transmission, ORDER_TEXT_LIMITS.transmission),
    drive: trimString(input.drive, ORDER_TEXT_LIMITS.drive),
    accidentFree: trimString(input.accidentFree, ORDER_TEXT_LIMITS.accidentFree),
    color: trimString(input.color, ORDER_TEXT_LIMITS.color),
    notes: trimString(input.notes, ORDER_TEXT_LIMITS.notes),
    email: trimString(input.email, ORDER_TEXT_LIMITS.email).toLowerCase(),
    acceptTerms: normalizeBoolean(input.acceptTerms),
    startBeforeWithdrawal: normalizeBoolean(input.startBeforeWithdrawal),
    acknowledgeWithdrawalLoss: normalizeBoolean(input.acknowledgeWithdrawalLoss),
  };
}

export function validateAndNormalizeOrder(input: Partial<OrderFormData> | Record<string, unknown>) {
  const data = normalizeOrderFormData(input);
  const errors = validateOrderForm(data);
  return { data, errors, valid: !hasOrderFormErrors(errors) };
}

function metadataValue(value: string | number | boolean): string {
  return String(value).slice(0, METADATA_VALUE_LIMIT);
}

export function buildOrderMetadata(order: OrderFormData, orderedAtIso: string): Metadata {
  return {
    service: PRODUCT_NAME,
    service_details: SERVICE_DESCRIPTION,
    price_eur: "49",
    delivery_window: DELIVERY_WINDOW,
    email: metadataValue(order.email),
    budget: metadataValue(order.budget),
    brand: metadataValue(order.brand),
    model: metadataValue(order.model),
    maxMileage: metadataValue(order.maxMileage),
    bodyType: metadataValue(order.bodyType),
    transmission: metadataValue(order.transmission),
    drive: metadataValue(order.drive),
    accidentFree: metadataValue(order.accidentFree),
    color: metadataValue(order.color),
    notes: metadataValue(order.notes),
    acceptTerms: metadataValue(order.acceptTerms),
    startBeforeWithdrawal: metadataValue(order.startBeforeWithdrawal),
    acknowledgeWithdrawalLoss: metadataValue(order.acknowledgeWithdrawalLoss),
    consent_version: CONSENT_VERSION,
    ordered_at: orderedAtIso,
  };
}

function appUrl(): string {
  const configuredUrl = process.env.APP_URL?.trim();
  if (configuredUrl) return configuredUrl.replace(/\/+$/, "");

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;

  return "http://localhost:3000";
}

function safeLogError(context: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : "Unknown error";
  console.error(`${context}: ${msg}`);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCents(amount: number | null | undefined, currency = "eur"): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: currency.toUpperCase() }).format((amount ?? PRODUCT_PRICE_CENTS) / 100);
}

export function isPaidCompleteSession(session: Pick<Stripe.Checkout.Session, "payment_status" | "status">): boolean {
  return session.payment_status === "paid" && session.status === "complete";
}

export function buildSafeCheckoutSessionResponse(session: Stripe.Checkout.Session) {
  const meta = session.metadata ?? {};
  return {
    reference: session.id,
    amount: session.amount_total ?? PRODUCT_PRICE_CENTS,
    currency: session.currency ?? "eur",
    status: session.status,
    paymentStatus: session.payment_status,
    product: meta.service ?? PRODUCT_NAME,
  };
}

export function normalizeWithdrawalInput(input: WithdrawalInput): { data?: NormalizedWithdrawal; error?: string } {
  const name = trimString(input.name, 120);
  const email = trimString(input.email, 254).toLowerCase();
  const reference = trimString(input.reference ?? input.ref ?? input.orderRef, 120);
  const declaration = trimString(input.declaration, 500);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const referenceOk = /^cs_(test|live)_[A-Za-z0-9]+$/.test(reference);

  if (!name || !emailOk || !referenceOk || !declaration) {
    return { error: WITHDRAWAL_ERROR };
  }

  return { data: { name, email, reference, declaration } };
}

function isStripeSessionReference(reference: string): boolean {
  return /^cs_(test|live)_[A-Za-z0-9]+$/.test(reference);
}

function mailFrom(): string {
  return `"${PRODUCT_NAME}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`;
}

const carCache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60_000; // 30 min

function getCached(key: string): unknown | null {
  const entry = carCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    carCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: unknown) {
  carCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─────────────────────────────────────────────
//  App Setup
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  Exa Grounding (kostenloses Web-Search-Grounding)
//  Zwei gezielte Queries: Technik-Specs + bekannte Mängel/Schwachstellen.
//  Mängel sind das wichtigste Feature → eigene, fokussierte Recherche.
// ─────────────────────────────────────────────
async function exaSearch(query: string, n: number): Promise<string[]> {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY fehlt");
  const exaRes = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify({
      query,
      type: "neural",
      numResults: n,
      contents: { text: true, highlight: false },
    }),
  });
  if (!exaRes.ok) {
    throw new Error(`Exa HTTP ${exaRes.status}: ${await exaRes.text().catch(() => "")}`);
  }
  const json = (await exaRes.json()) as {
    results?: Array<{ title?: string; url?: string; text?: string }>;
  };
  return (json.results ?? []).map((r) => {
    const text = (r.text ?? "").replace(/\s+/g, " ").trim().slice(0, 1200);
    return `[${r.title ?? "ohne Titel"}]\n${text}\nQuelle: ${r.url ?? "unbekannt"}`;
  });
}

async function getExaContext(vehicle: string): Promise<string> {
  const key = process.env.EXA_API_KEY;
  if (!key) {
    console.warn("⚠️ EXA_API_KEY fehlt — kein Grounding möglich");
    return "";
  }
  // Specs-Recherche (Leistung, Verbrauch, Wertverlust)
  const specQuery = `${vehicle} technische Daten Leistung PS kW Verbrauch Wertverlust`;
  // Mängel-Recherche (eigenständig, damit die echten Schwachstellen rankommen)
  const flawQuery = `${vehicle} bekannte Mängel Schwachstellen typische Probleme Ausfälle Forum Rückruf`;

  const [specs, flaws] = await Promise.allSettled([
    exaSearch(specQuery, 4),
    exaSearch(flawQuery, 6),
  ]).then((results) =>
    results.map((r) => (r.status === "fulfilled" ? r.value : []))
  );

  if (specs.length === 0 && flaws.length === 0) {
    throw new Error("Exa lieferte keine Ergebnisse");
  }

  const parts: string[] = [];
  if (specs.length) {
    parts.push("=== TECHNISCHE SPECS (Quellen) ===\n" + specs.join("\n\n"));
  }
  if (flaws.length) {
    parts.push("=== BEKANNTE MÄNGEL & SCHWACHSTELLEN (Quellen) ===\n" + flaws.join("\n\n"));
  }
  return parts.join("\n\n").slice(0, 9000);
}

const app = express();

export type StripeOutboxStatus =
  | "received"
  | "owner_pending"
  | "owner_notified"
  | "owner_failed"
  | "customer_pending"
  | "customer_notified"
  | "customer_failed"
  | "customer_skipped"
  | "verification_failed";

export type StripeWebhookOutbox = {
  reserve(eventId: string, sessionId: string): Promise<"created" | "duplicate">;
  updateStatus(eventId: string, status: StripeOutboxStatus): Promise<void>;
};

type StripeOutboxRecord = {
  eventId: string;
  sessionId: string;
  status: StripeOutboxStatus;
  receivedAt: string;
  updatedAt: string;
};

function outboxPath(eventId: string): string {
  // Stripe event IDs are signed input. Restrict the pathname nevertheless so it
  // cannot turn into a path traversal or accidentally disclose data via a URL.
  return `stripe-outbox/${eventId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
}

function serializeOutboxRecord(record: StripeOutboxRecord): string {
  return JSON.stringify(record);
}

class BlobStripeWebhookOutbox implements StripeWebhookOutbox {
  async reserve(eventId: string, sessionId: string): Promise<"created" | "duplicate"> {
    const pathname = outboxPath(eventId);
    const now = new Date().toISOString();
    const record: StripeOutboxRecord = {
      eventId,
      sessionId,
      status: "received",
      receivedAt: now,
      updatedAt: now,
    };

    try {
      await putBlob(pathname, serializeOutboxRecord(record), {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/json",
      });
      return "created";
    } catch (error) {
      // Blob rejects overwrites by default. A successful head after that error
      // means this exact Stripe event was durably reserved by another delivery.
      try {
        await headBlob(pathname);
        return "duplicate";
      } catch {
        throw error;
      }
    }
  }

  async updateStatus(eventId: string, status: StripeOutboxStatus): Promise<void> {
    const pathname = outboxPath(eventId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await getBlob(pathname, { access: "private", useCache: false });
      if (!current || !current.stream) {
        throw new Error(`Stripe outbox record is missing for ${eventId}`);
      }
      const record = JSON.parse(await new Response(current.stream).text()) as StripeOutboxRecord;
      const next: StripeOutboxRecord = { ...record, status, updatedAt: new Date().toISOString() };
      try {
        await putBlob(pathname, serializeOutboxRecord(next), {
          access: "private",
          allowOverwrite: true,
          contentType: "application/json",
          ifMatch: current.blob.etag,
        });
        return;
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError && attempt < 2) continue;
        throw error;
      }
    }
  }
}

let webhookOutbox: StripeWebhookOutbox = new BlobStripeWebhookOutbox();

// Test-only seam: production always uses the private Vercel Blob store.
export function setWebhookOutboxForTests(outbox?: StripeWebhookOutbox): void {
  webhookOutbox = outbox ?? new BlobStripeWebhookOutbox();
}

async function persistStatus(outbox: StripeWebhookOutbox, eventId: string, status: StripeOutboxStatus): Promise<void> {
  await outbox.updateStatus(eventId, status);
}

type CheckoutPostProcessor = (event: Stripe.Event, outbox: StripeWebhookOutbox) => Promise<void>;

async function processCompletedCheckout(event: Stripe.Event, outbox: StripeWebhookOutbox): Promise<void> {
  let session = event.data.object as Stripe.Checkout.Session;
  try {
    await persistStatus(outbox, event.id, "owner_pending");
    session = await getStripe().checkout.sessions.retrieve(session.id);
    if (!isPaidCompleteSession(session)) {
      await persistStatus(outbox, event.id, "verification_failed");
      return;
    }

    const meta = session.metadata ?? {};
    const mailer = getMailer();
    await mailer.sendMail({
      from: mailFrom(),
      to: process.env.OWNER_EMAIL,
      subject: `Neue bezahlte AutoWunsch-Bestellung ${session.id}`,
      html: buildOwnerEmail(meta, session),
    });
    await persistStatus(outbox, event.id, "owner_notified");
  } catch (error) {
    try {
      await persistStatus(outbox, event.id, "owner_failed");
    } catch (statusError) {
      safeLogError("Stripe outbox could not persist owner failure", statusError);
    }
    throw error;
  }

  const meta = session.metadata ?? {};
  const mailer = getMailer();
  const customerEmail = session.customer_details?.email ?? session.customer_email ?? meta.email;

  if (!customerEmail) {
    await persistStatus(outbox, event.id, "customer_skipped");
    return;
  }

  try {
    await persistStatus(outbox, event.id, "customer_pending");
    await mailer.sendMail({
      from: mailFrom(),
      to: customerEmail,
      subject: `Auftragsbestätigung ${PRODUCT_NAME}`,
      html: buildCustomerContractEmail(meta, session, customerEmail),
    });
    await persistStatus(outbox, event.id, "customer_notified");
  } catch (error) {
    try {
      await persistStatus(outbox, event.id, "customer_failed");
    } catch (statusError) {
      safeLogError("Stripe outbox could not persist customer failure", statusError);
    }
    throw error;
  }
}

let checkoutPostProcessor: CheckoutPostProcessor = processCompletedCheckout;

// Test-only seam: HTTP production code always schedules processCompletedCheckout.
export function setCheckoutPostProcessorForTests(processor?: CheckoutPostProcessor): void {
  checkoutPostProcessor = processor ?? processCompletedCheckout;
}

// Stripe webhook needs raw body — must be BEFORE express.json()
app.post(
  "/api/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const sig = req.headers["stripe-signature"] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!sig || !webhookSecret) {
      res.status(400).send("Webhook configuration error");
      return;
    }

    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("Stripe webhook signature failed:", msg);
      res.status(400).send(`Webhook Error: ${msg}`);
      return;
    }

    if (event.type !== "checkout.session.completed") {
      res.status(200).json({ received: true });
      return;
    }

    const sessionId = (event.data.object as { id?: unknown }).id;
    if (typeof sessionId !== "string" || !isStripeSessionReference(sessionId)) {
      safeLogError("Stripe webhook has no usable Checkout Session ID", new Error(event.id));
      res.status(503).json({ error: "Webhook event could not be reserved" });
      return;
    }

    try {
      const outbox = webhookOutbox;
      const processor = checkoutPostProcessor;
      const reservation = await outbox.reserve(event.id, sessionId);
      if (reservation === "created") {
        waitUntil(processor(event, outbox).catch((error) => {
          safeLogError("Webhook post-checkout processing failed", error);
        }));
      }
    } catch (error) {
      safeLogError("Stripe webhook durable reservation failed", error);
      res.status(503).json({ error: "Webhook event could not be reserved" });
      return;
    }

    res.status(200).json({ received: true });
  }
);

// All other routes parse JSON
app.use(express.json({ limit: "20kb" }));

// ─────────────────────────────────────────────
//  POST /api/analyze-car
// ─────────────────────────────────────────────
app.post("/api/analyze-car", async (req: Request, res: Response) => {
  const { query } = req.body as { query?: string };
  const input = normalizeVehicleAnalysisInput(query);
  if ("error" in input) {
    res.status(400).json({ error: input.error });
    return;
  }

  if (process.env.AI_ANALYSIS_ENABLED === "false") {
    res.status(503).json({ error: "Der KI-Fahrzeugcheck ist derzeit nicht verfügbar." });
    return;
  }

  if (!checkRateLimit(`analysis:${getClientIp(req)}`)) {
    res.status(429).json({ error: "Zu viele Anfragen. Bitte warte kurz." });
    return;
  }

  const cached = getCached(input.cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  // Exa-Grounding: aktuelle Web-Auszüge holen und in die Analyse einbetten
  let exaContext = "";
  try {
    exaContext = await getExaContext(input.value);
  } catch (exaErr) {
    console.warn("⚠️ Exa-Grounding fehlgeschlagen, fahre ohne Kontext fort:", exaErr instanceof Error ? exaErr.message : exaErr);
  }
  const groundedQuery = exaContext
    ? input.value + "\n\n=== AKTUELLE WEB-RECHERCHE (stütze alle Zahlen auf diese Quellen) ===\n" + exaContext
    : input.value;

  try {
    const systemInstruction = `Du bist ein erfahrener deutschsprachiger KFZ-Experte und Fahrzeug-Analyst.
Deine Aufgabe: Analysiere das angefragte Automodell anhand aktueller, verlässlicher Informationen aus dem Internet.
Antworte AUSSCHLIESSLICH auf Deutsch, AUSSCHLIESSLICH als valides JSON-Objekt — kein Markdown, kein Erläuterungstext davor oder danach.

Das JSON-Format muss EXAKT diesem Schema entsprechen:
{
  "name": "Vollständiger Fahrzeugname mit Baureihe in Klammern, z.B. BMW M3 Competition (G80)",
  "leistung": "XXX PS / XXX kW (Motorbezeichnung, z.B. S58 3.0L R6 Biturbo)",
  "verbrauch": "X,X L/100km (Kraftstoffart) oder X,X kWh/100km für E-Autos",
  "wertverlust": "Einschätzung: z.B. Gering (~25% in 3 Jahren) oder Hoch (~45% in 3 Jahren)",
  "maengel": "Kommaseparierte Liste der bekanntesten Probleme und Schwachstellen in Deutschland (max. 3-4 Punkte)",
  "details": "2-3 Sätze Gesamtbewertung: Stärken, typische Unterhaltskosten, Käuferempfehlung auf Deutsch"
}

Wichtig:
- Im Prompt wird dir ein Abschnitt mit aktuellen Quellenauszügen (Exa-Suche) mitgegeben, unterteilt in "TECHNISCHE SPECS" und "BEKANNTE MÄNGEL & SCHWACHSTELLEN".\n- Stütze die Felder Leistung/Verbrauch/Wertverlust AUSSCHLIESSLICH auf den SPECS-Abschnitt.\n- Das Feld "maengel" MUSS aus dem MÄNGEL-Abschnitt stammen: nenne die konkreten, dort genannten Schwachstellen (z.B. Turbolager, gerissene Kopfschrauben, Kupplung, Ölverbrauch). Erfinde KEINE Mängel, die nicht in den Quellen stehen, und LASSE die wichtigsten genannten nicht weg.\n- Bei widersprüchlichen Angaben nenne die Spanne. Erfinde niemals Daten ohne Quelle.
- Alle Zahlenangaben in metrischen Einheiten (PS, km/h, Liter, kg) — NICHT imperial.
- Falls du das Modell nicht eindeutig identifizieren kannst, gib im Feld "name" an, was du verstanden hast, und erkläre in "details", dass du keine gesicherten Daten gefunden hast.
- Gib niemals rein erfundene Daten als Fakten aus. Lieber "Keine gesicherten Daten verfügbar" schreiben.`;

    const response = await genai.models.generateContent({
      model: process.env.GEMINI_ANALYSIS_MODEL?.trim() || "gemini-3.1-flash-lite",
      contents: [
        {
          role: "user",
          parts: [{ text: `Analysiere dieses Fahrzeug für einen deutschen Käufer: "${groundedQuery}"\n\nAntworte AUSSCHLIESSLICH als valides JSON-Objekt in EXAKT diesem Schema, ohne Markdown, ohne Erläuterungstext davor oder danach:\n{"name":"...","leistung":"...","verbrauch":"...","wertverlust":"...","maengel":"...","details":"..."}` }],
        },
      ],
      config: {
        systemInstruction,
        temperature: 0.2,
      },
    });

    const rawText = response.text ?? "";
    if (!rawText) {
      console.error("Gemini returned empty response");
      res.status(502).json({
        error: "Die KI konnte keine strukturierte Antwort erstellen. Bitte versuche es erneut.",
      });
      return;
    }

    // Robust: erstes {...}-Block extrahieren (greedy auf äußere Klammern)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("Gemini returned non-JSON:", rawText.slice(0, 300));
      res.status(502).json({
        error: "Die KI konnte keine strukturierte Antwort erstellen. Bitte versuche es erneut.",
      });
      return;
    }

    let carData: Record<string, unknown>;
    try {
      carData = JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error("JSON parse failed:", jsonMatch[0].slice(0, 300));
      res.status(502).json({ error: "Fehler beim Verarbeiten der KI-Antwort." });
      return;
    }

    const required = ["name", "leistung", "verbrauch", "wertverlust", "maengel", "details"];
    for (const field of required) {
      if (!carData[field]) {
        carData[field] = "Keine Daten verfügbar";
      }
    }

    setCache(input.cacheKey, carData);
    res.json(carData);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
    console.error("Gemini API error:", msg);
    res.status(500).json({ error: "KI-Dienst vorübergehend nicht verfügbar. Bitte versuche es später erneut." });
  }
});

// ─────────────────────────────────────────────
//  POST /api/create-checkout
// ─────────────────────────────────────────────
app.post("/api/create-checkout", async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  if (!checkRateLimit(`checkout:${ip}`)) {
    res.status(429).json({ error: "Zu viele Anfragen. Bitte warte kurz." });
    return;
  }

  const { data: order, errors, valid } = validateAndNormalizeOrder(req.body as Record<string, unknown>);
  if (!valid) {
    res.status(400).json({
      error: "Bitte pruefe deine Angaben.",
      errors,
    });
    return;
  }

  const orderedAt = new Date().toISOString();
  const metadata = buildOrderMetadata(order, orderedAt);

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      customer_email: order.email,
      locale: "de",
      line_items: [
        {
          price_data: {
            currency: "eur",
            unit_amount: PRODUCT_PRICE_CENTS,
            product_data: {
              name: PRODUCT_NAME,
              description: "AutoWunsch.com / Autoempfehlung Premium: 3 handgepruefte Fahrzeuglinks von Verkaufsplattformen innerhalb von 48 Stunden.",
            },
          },
          quantity: 1,
        },
      ],
      metadata,
      payment_intent_data: {
        metadata,
      },
      success_url: `${appUrl()}${CHECKOUT_SUCCESS_PATH}`,
      cancel_url: `${appUrl()}${CHECKOUT_CANCEL_PATH}`,
    });

    res.json({ url: session.url });
  } catch (err: unknown) {
    safeLogError("Stripe Checkout error", err);
    res.status(500).json({ error: "Zahlung konnte nicht initiiert werden. Bitte versuche es erneut." });
  }
});

// ─────────────────────────────────────────────
//  GET /api/checkout-session
// ─────────────────────────────────────────────
app.get("/api/checkout-session", async (req: Request, res: Response) => {
  const sessionId = typeof req.query.session_id === "string" ? req.query.session_id.trim() : "";
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    res.status(400).json({ error: "Ungueltige Checkout-Referenz." });
    return;
  }

  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    if (!isPaidCompleteSession(session)) {
      res.status(404).json({ error: "Checkout nicht bestaetigt." });
      return;
    }

    res.json(buildSafeCheckoutSessionResponse(session));
  } catch (err) {
    safeLogError("Checkout session retrieval failed", err);
    res.status(404).json({ error: "Checkout nicht bestaetigt." });
  }
});

// ─────────────────────────────────────────────
//  POST /api/withdrawal
// ─────────────────────────────────────────────
app.post("/api/withdrawal", async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  if (!checkRateLimit(`withdrawal:${ip}`)) {
    res.status(429).json({ error: "Zu viele Anfragen. Bitte warte kurz." });
    return;
  }

  const normalized = normalizeWithdrawalInput(req.body as WithdrawalInput);
  if (!normalized.data) {
    res.status(400).json({ error: WITHDRAWAL_ERROR });
    return;
  }

  const withdrawal = normalized.data;
  let verifiedEmail = withdrawal.email;
  let contractReference = withdrawal.reference;

  try {
    if (isStripeSessionReference(withdrawal.reference)) {
      const session = await getStripe().checkout.sessions.retrieve(withdrawal.reference);
      if (!isPaidCompleteSession(session)) {
        res.status(400).json({ error: WITHDRAWAL_ERROR });
        return;
      }
      const sessionEmail = (session.customer_details?.email ?? session.customer_email ?? session.metadata?.email ?? "").toLowerCase();
      if (!sessionEmail || sessionEmail !== withdrawal.email) {
        res.status(400).json({ error: WITHDRAWAL_ERROR });
        return;
      }
      verifiedEmail = sessionEmail;
      contractReference = session.id;
    }

    const timestamp = new Date().toISOString();
    const receiptReference = buildWithdrawalReceiptReference(timestamp);
    const mailer = getMailer();
    const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
    if (!ownerEmail) throw new Error("OWNER_EMAIL is missing");

    const ownerResult = await mailer.sendMail({
      from: mailFrom(),
      to: ownerEmail,
      subject: `Widerruf eingegangen ${receiptReference}`,
      html: buildWithdrawalOwnerEmail(withdrawal, contractReference, receiptReference, timestamp),
    });
    const acceptedOwnerEmails = (ownerResult.accepted ?? [])
      .map((mail) => (typeof mail === "string" ? mail : mail.address))
      .map((mail) => mail.toLowerCase());
    if (!acceptedOwnerEmails.includes(ownerEmail)) {
      res.status(502).json({ error: WITHDRAWAL_ERROR });
      return;
    }

    const consumerResult = await mailer.sendMail({
      from: mailFrom(),
      to: verifiedEmail,
      subject: `Eingangsbestaetigung Widerruf ${receiptReference}`,
      html: buildWithdrawalConsumerEmail(withdrawal, contractReference, receiptReference, timestamp),
    });

    const acceptedEmails = (consumerResult.accepted ?? [])
      .map((mail) => (typeof mail === "string" ? mail : mail.address))
      .map((mail) => mail.toLowerCase());
    if (!acceptedEmails.includes(verifiedEmail)) {
      res.status(502).json({ error: WITHDRAWAL_ERROR });
      return;
    }

    res.json({
      success: true,
      receiptReference,
      receivedAt: timestamp,
    });
  } catch (err) {
    safeLogError("Withdrawal processing failed", err);
    res.status(400).json({ error: WITHDRAWAL_ERROR });
  }
});

// ─────────────────────────────────────────────
//  GET /api/health
// ─────────────────────────────────────────────
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    gemini: Boolean(process.env.GEMINI_API_KEY),
    exa: Boolean(process.env.EXA_API_KEY),
    stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    stripeWebhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    smtp: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    ownerEmail: Boolean(process.env.OWNER_EMAIL),
    operatorContact: Boolean(process.env.OPERATOR_NAME && process.env.OPERATOR_ADDRESS && process.env.OPERATOR_EMAIL),
    appUrl: Boolean(process.env.APP_URL || process.env.VERCEL_URL),
  });
});

// Serve frontend (production local fallback)
const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));

// Export default for Vercel Serverless Function
export default app;

// Start Local Server (if not running on Vercel)
if (!process.env.VERCEL) {
  const PORT = Number(process.env.PORT ?? 3001);
  app.listen(PORT, () => {
    console.log(`\nAutoWunsch.com Backend läuft lokal auf Port ${PORT}`);
    console.log(`   → Gemini API: ${process.env.GEMINI_API_KEY ? "✅ Key vorhanden" : "❌ Key fehlt!"}`);
    console.log(`   → Stripe:     ${process.env.STRIPE_SECRET_KEY ? "✅ Key vorhanden" : "⚠️  Key fehlt (Checkout/Webhook deaktiviert)"}`);
  });
}

// ─────────────────────────────────────────────
//  E-Mail Templates
// ─────────────────────────────────────────────
export function buildWithdrawalReceiptReference(timestampIso: string): string {
  const compact = timestampIso.replace(/\D/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `WD-${compact}-${random}`;
}

function operatorContactHtml(): string {
  const name = process.env.OPERATOR_NAME ?? "Enricha Einzelunternehmen, Timo Bieker";
  const address = process.env.OPERATOR_ADDRESS ?? "Adresse siehe Impressum";
  const email = process.env.OPERATOR_EMAIL ?? process.env.OWNER_EMAIL ?? process.env.SMTP_USER ?? "";
  return `${escapeHtml(name)}<br>${escapeHtml(address)}<br>E-Mail: ${escapeHtml(email)}`;
}

function emailShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f5f7; margin: 0; padding: 20px; color: #1f2937; }
  .card { background: white; border-radius: 12px; padding: 28px; max-width: 680px; margin: auto; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  h1 { color: #111827; font-size: 22px; margin: 0 0 18px; }
  h2 { color: #111827; font-size: 16px; margin: 24px 0 8px; }
  p, li { color: #374151; font-size: 14px; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th, td { text-align: left; vertical-align: top; border-bottom: 1px solid #e5e7eb; padding: 8px 0; font-size: 14px; }
  th { width: 190px; color: #111827; }
  .box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; margin: 14px 0; }
  .muted { color: #6b7280; font-size: 12px; }
</style></head>
<body><div class="card"><h1>${escapeHtml(title)}</h1>${body}</div></body></html>`;
}

function buildOwnerEmail(meta: Record<string, string>, session: Stripe.Checkout.Session): string {
  return emailShell(
    "Neue bezahlte Beratungsanfrage",
    `<p>Zahlung wurde von Stripe als bezahlt und abgeschlossen gemeldet.</p>
    <table>
      <tr><th>Referenz</th><td>${escapeHtml(session.id)}</td></tr>
      <tr><th>Betrag</th><td>${escapeHtml(formatCents(session.amount_total, session.currency ?? "eur"))}</td></tr>
      <tr><th>E-Mail</th><td>${escapeHtml(session.customer_details?.email ?? session.customer_email ?? meta.email ?? "")}</td></tr>
      <tr><th>Service</th><td>${escapeHtml(meta.service ?? PRODUCT_NAME)}</td></tr>
      <tr><th>Budget</th><td>${escapeHtml(meta.budget)}</td></tr>
      <tr><th>Marke</th><td>${escapeHtml(meta.brand)}</td></tr>
      <tr><th>Modell</th><td>${escapeHtml(meta.model)}</td></tr>
      <tr><th>Max. Kilometer</th><td>${escapeHtml(meta.maxMileage)}</td></tr>
      <tr><th>Karosserie</th><td>${escapeHtml(meta.bodyType)}</td></tr>
      <tr><th>Getriebe</th><td>${escapeHtml(meta.transmission)}</td></tr>
      <tr><th>Antrieb</th><td>${escapeHtml(meta.drive)}</td></tr>
      <tr><th>Unfallfrei</th><td>${escapeHtml(meta.accidentFree)}</td></tr>
      <tr><th>Farbe</th><td>${escapeHtml(meta.color)}</td></tr>
      <tr><th>Notizen</th><td>${escapeHtml(meta.notes)}</td></tr>
      <tr><th>AGB/Info</th><td>${escapeHtml(meta.acceptTerms)}</td></tr>
      <tr><th>Start vor Widerrufsfrist</th><td>${escapeHtml(meta.startBeforeWithdrawal)}</td></tr>
      <tr><th>Kenntnis Rechtsverlust</th><td>${escapeHtml(meta.acknowledgeWithdrawalLoss)}</td></tr>
      <tr><th>Consent-Version</th><td>${escapeHtml(meta.consent_version)}</td></tr>
      <tr><th>Bestellzeit</th><td>${escapeHtml(meta.ordered_at)}</td></tr>
    </table>`,
  );
}

function buildCustomerContractEmail(meta: Record<string, string>, session: Stripe.Checkout.Session, customerEmail: string): string {
  return emailShell(
    `Auftragsbestätigung ${PRODUCT_NAME}`,
    `<p>Vielen Dank für deine Bestellung. Der Vertrag ist nach erfolgreicher Zahlung zustande gekommen.</p>
    <div class="box">
      <strong>Leistung:</strong> ${escapeHtml(meta.service ?? PRODUCT_NAME)}<br>
      ${escapeHtml(SERVICE_DESCRIPTION)}<br>
      <strong>Preis:</strong> ${escapeHtml(formatCents(session.amount_total, session.currency ?? "eur"))}
    </div>
    <h2>Vertragsdaten</h2>
    <table>
      <tr><th>Vertragsreferenz</th><td>${escapeHtml(session.id)}</td></tr>
      <tr><th>E-Mail</th><td>${escapeHtml(customerEmail)}</td></tr>
      <tr><th>Bestellzeit</th><td>${escapeHtml(meta.ordered_at)}</td></tr>
      <tr><th>Consent-Version</th><td>${escapeHtml(meta.consent_version ?? CONSENT_VERSION)}</td></tr>
    </table>
    <h2>Deine Kriterien</h2>
    <table>
      <tr><th>Budget</th><td>${escapeHtml(meta.budget)}</td></tr>
      <tr><th>Marke</th><td>${escapeHtml(meta.brand)}</td></tr>
      <tr><th>Modell</th><td>${escapeHtml(meta.model)}</td></tr>
      <tr><th>Max. Kilometer</th><td>${escapeHtml(meta.maxMileage)}</td></tr>
      <tr><th>Karosserie</th><td>${escapeHtml(meta.bodyType)}</td></tr>
      <tr><th>Getriebe</th><td>${escapeHtml(meta.transmission)}</td></tr>
      <tr><th>Antrieb</th><td>${escapeHtml(meta.drive)}</td></tr>
      <tr><th>Unfallfrei</th><td>${escapeHtml(meta.accidentFree)}</td></tr>
      <tr><th>Farbe</th><td>${escapeHtml(meta.color)}</td></tr>
      <tr><th>Weitere Wünsche</th><td>${escapeHtml(meta.notes)}</td></tr>
    </table>
    <h2>Einwilligungen</h2>
    <ul>
      <li>Pflichtinformationen/AGB bestätigt: ${escapeHtml(meta.acceptTerms)}</li>
      <li>Ausdrücklicher Start der Dienstleistung vor Ablauf der Widerrufsfrist: ${escapeHtml(meta.startBeforeWithdrawal)}</li>
      <li>Kenntnis vom möglichen Erlöschen des Widerrufsrechts nach vollständiger Leistung: ${escapeHtml(meta.acknowledgeWithdrawalLoss)}</li>
    </ul>
    <h2>Widerruf und Kontakt</h2>
    <p>Du kannst den Widerruf mit einer eindeutigen Erklärung per E-Mail oder über das bereitgestellte Widerrufsformular erklären. Es erfolgt kein automatischer Refund; der Widerruf wird nach rechtlicher Prüfung bearbeitet.</p>
    <p>${operatorContactHtml()}</p>`,
  );
}

function buildWithdrawalConsumerEmail(withdrawal: NormalizedWithdrawal, contractReference: string, receiptReference: string, timestamp: string): string {
  return emailShell(
    "Eingang deines Widerrufs",
    `<p>Wir bestätigen den Eingang deiner Widerrufserklärung.</p>
    <div class="box">
      <strong>Erklärung:</strong> ${escapeHtml(withdrawal.declaration)}<br>
      <strong>Vertragsreferenz:</strong> ${escapeHtml(contractReference)}<br>
      <strong>Datum/Uhrzeit:</strong> ${escapeHtml(timestamp)}<br>
      <strong>Belegnummer:</strong> ${escapeHtml(receiptReference)}
    </div>
    <p>Diese Bestätigung dokumentiert den Eingang. Sie ist keine automatische Rückerstattung.</p>
    <p>${operatorContactHtml()}</p>`,
  );
}

function buildWithdrawalOwnerEmail(withdrawal: NormalizedWithdrawal, contractReference: string, receiptReference: string, timestamp: string): string {
  return emailShell(
    "Widerruf eingegangen",
    `<table>
      <tr><th>Name</th><td>${escapeHtml(withdrawal.name)}</td></tr>
      <tr><th>E-Mail</th><td>${escapeHtml(withdrawal.email)}</td></tr>
      <tr><th>Vertragsreferenz</th><td>${escapeHtml(contractReference)}</td></tr>
      <tr><th>Belegnummer</th><td>${escapeHtml(receiptReference)}</td></tr>
      <tr><th>Datum/Uhrzeit</th><td>${escapeHtml(timestamp)}</td></tr>
      <tr><th>Erklärung</th><td>${escapeHtml(withdrawal.declaration)}</td></tr>
    </table>
    <p>Keine automatische Rueckerstattung wurde ausgeloest.</p>`,
  );
}
