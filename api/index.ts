/**
 * Auto-Beratung Premium — Express Backend (Vercel Serverless Compatible)
 *
 * Endpoints:
 *   POST /api/analyze-car        → Gemini + Google Search Grounding
 *   POST /api/create-checkout    → Stripe Checkout Session (49€)
 *                                  Mode: "hosted" (default) oder "embedded" (via VITE_CHECKOUT_MODE)
 *   POST /api/stripe-webhook     → Stripe Webhook → E-Mail an Owner
 *   POST /api/checkout-draft     → Temporären Form-Draft speichern (für Browser-Wechsel)
 *   GET  /api/checkout-draft/:t  → Draft einmalig laden
 */

import express, { Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import Stripe from "stripe";
import nodemailer from "nodemailer";
import "dotenv/config";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────
//  Env validation
// ─────────────────────────────────────────────
const REQUIRED_ENV = ["GEMINI_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "OWNER_EMAIL", "SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.warn(`⚠️  Missing env variable: ${key} — some features may not work`);
  }
}

// ─────────────────────────────────────────────
//  Return-URL resolution (with strict allowlist)
//
//  Priority:
//    1. process.env.APP_URL          (custom production domain override)
//    2. https://${VERCEL_URL}        (Vercel-provided, trusted by Vercel proxy)
//    3. Request-Origin (host header)  (only if it passes allowlist)
//
//  Allowlist (whitelist):
//    - *.vercel.app                  (Vercel preview/production)
//    - hosts listed in ALLOWED_HOSTS env (comma-separated; production domains)
//
//  We NEVER trust arbitrary request headers without allowlist match.
// ─────────────────────────────────────────────
const ALLOWED_VERCEL_PATTERN = /\.vercel\.app$/i;
const ALLOWED_HOSTS: ReadonlySet<string> = new Set(
  (process.env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

function isHostAllowed(host: string): boolean {
  const h = host.toLowerCase().split(":")[0]; // strip port
  if (!h) return false;
  if (ALLOWED_VERCEL_PATTERN.test(h)) return true;
  if (ALLOWED_HOSTS.has(h)) return true;
  return false;
}

function getAppOrigin(req: Request): string {
  // 1. Explicit override (only if it parses as a valid https URL)
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl) {
    try {
      const u = new URL(envUrl);
      if (u.protocol === "https:" || u.protocol === "http:") {
        return `${u.protocol}//${u.host}`;
      }
    } catch { /* fall through */ }
  }

  // 2. Vercel-provided URL (trusted — set by Vercel proxy on every request)
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  // 3. Request-Origin (only if host passes allowlist)
  const xfHost = (req.headers["x-forwarded-host"] as string) || "";
  const host = (req.headers["host"] as string) || "";
  const xfProto = (req.headers["x-forwarded-proto"] as string) || "https";
  const candidateHost = (xfHost || host).toLowerCase().split(":")[0];

  if (candidateHost && isHostAllowed(candidateHost)) {
    return `${xfProto}://${candidateHost}`;
  }

  // 4. Nothing allowed — empty string. Callers must handle this.
  return "";
}

// ─────────────────────────────────────────────
//  Clients
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
//  Checkout Drafts (for browser-switch recovery)
//
//  Wird benutzt, wenn ein User im TikTok In-App-Browser auf
//  "Im Browser öffnen" tippt und im echten Browser landet.
//  Statt Formularwerte in die URL zu schreiben (DSGVO/Sicherheit),
//  speichern wir sie serverseitig mit einem opaque token.
//
//  • TTL: 30 min (User sollte innerhalb dieser Zeit wechseln)
//  • Single-use optional über `consume: true`
//  • Rate-Limit pro IP: 5 Drafts / 10 min
//  • Daten werden NICHT ins Stripe-Metadata übertragen
//    (User muss sie im neuen Browser nochmal abschicken)
// ─────────────────────────────────────────────
interface CheckoutDraft {
  email: string;
  budget: string;
  brand: string;
  bodyType: string;
  transmission: string;
  drive: string;
  notes: string;
  source: string;
  createdAt: number;
  expiresAt: number;
}

const draftStore = new Map<string, CheckoutDraft>();
const DRAFT_TTL_MS = 30 * 60_000;
const DRAFT_RATE_LIMIT = 5;
const DRAFT_RATE_WINDOW_MS = 10 * 60_000;
const draftRateLimit = new Map<string, { count: number; resetAt: number }>();

function checkDraftRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = draftRateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    draftRateLimit.set(ip, { count: 1, resetAt: now + DRAFT_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= DRAFT_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

function cleanupDrafts() {
  const now = Date.now();
  for (const [token, draft] of draftStore.entries()) {
    if (now > draft.expiresAt) draftStore.delete(token);
  }
}

function generateOpaqueToken(): string {
  // 32 Bytes hex = 64 chars; kryptografisch zufällig, nicht erratbar
  return crypto.randomBytes(32).toString("hex");
}

const ALLOWED_SOURCES = new Set(["direct", "tiktok", "instagram", "youtube", "linktree", "other"]);

function sanitizeSource(input: unknown): string {
  const s = typeof input === "string" ? input.toLowerCase().slice(0, 50) : "direct";
  return ALLOWED_SOURCES.has(s) ? s : "direct";
}

function sanitizeMetaField(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}

// ─────────────────────────────────────────────
//  App Setup
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
  const specQuery = `${vehicle} technische Daten Leistung PS kW Verbrauch Wertverlust`;
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

// Stripe webhook needs raw body — must be BEFORE express.json()
app.post(
  "/api/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const sig = req.headers["stripe-signature"] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("❌ Stripe webhook signature failed:", msg);
      res.status(400).send(`Webhook Error: ${msg}`);
      return;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const meta = session.metadata ?? {};

      try {
        const mailer = getMailer();
        await mailer.sendMail({
          from: `"Auto-Beratung Premium" <${process.env.SMTP_USER}>`,
          to: process.env.OWNER_EMAIL,
          subject: `🚗 Neue Beratungsanfrage von ${meta.email ?? "Unbekannt"} — ${meta.budget ?? "?"}€ Budget`,
          html: buildOwnerEmail(meta, session),
        });
        console.log(`✅ Owner-E-Mail gesendet an ${process.env.OWNER_EMAIL}`);

        if (meta.email) {
          await mailer.sendMail({
            from: `"Auto-Beratung Premium" <${process.env.SMTP_USER}>`,
            to: meta.email,
            subject: "✅ Deine Beratungsanfrage ist eingegangen!",
            html: buildCustomerEmail(meta),
          });
        }
      } catch (mailErr) {
        console.error("❌ E-Mail-Versand fehlgeschlagen:", mailErr);
      }
    }

    res.json({ received: true });
  }
);

// All other routes parse JSON
app.use(express.json());

// ─────────────────────────────────────────────
//  POST /api/analyze-car
// ─────────────────────────────────────────────
app.post("/api/analyze-car", async (req: Request, res: Response) => {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
  const { query } = req.body as { query?: string };

  if (!query || query.trim().length === 0) {
    res.status(400).json({ error: "Bitte gib ein Automodell ein." });
    return;
  }

  const normalizedQuery = query.trim().toLowerCase().slice(0, 200);

  let exaContext = "";
  try {
    exaContext = await getExaContext(query.trim());
  } catch (exaErr) {
    console.warn("⚠️ Exa-Grounding fehlgeschlagen, fahre ohne Kontext fort:", exaErr instanceof Error ? exaErr.message : exaErr);
  }
  const groundedQuery = exaContext
    ? query.trim() + "\n\n=== AKTUELLE WEB-RECHERCHE (stütze alle Zahlen auf diese Quellen) ===\n" + exaContext
    : query.trim();


  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Zu viele Anfragen. Bitte warte kurz." });
    return;
  }

  const cached = getCached(normalizedQuery);
  if (cached) {
    res.json(cached);
    return;
  }

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

    let response;
    try {
      console.log("Attempting vehicle analysis using primary model: gemini-3.1-flash-lite");
      response = await genai.models.generateContent({
        model: "gemini-3.1-flash-lite",
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
    } catch (err) {
      console.warn("Primary model (gemini-3.1-flash-lite) failed. Falling back to gemini-3.5-flash. Error:", err instanceof Error ? err.message : err);
      response = await genai.models.generateContent({
        model: "gemini-3.5-flash",
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
    }

    const rawText = response.text ?? "";
    if (!rawText) {
      console.error("Gemini returned empty response");
      res.status(502).json({
        error: "Die KI konnte keine strukturierte Antwort erstellen. Bitte versuche es erneut.",
      });
      return;
    }

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

    setCache(normalizedQuery, carData);
    res.json(carData);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
    console.error("Gemini API error:", msg);
    res.status(500).json({ error: "KI-Dienst vorübergehend nicht verfügbar. Bitte versuche es später erneut." });
  }
});

// ─────────────────────────────────────────────
//  POST /api/checkout-draft
//
//  Speichert Formularwerte serverseitig mit TTL + opaque token.
//  Zweck: User wechselt von TikTok In-App-Browser in echten Browser,
//  kann dort mit dem Token die Werte wiederherstellen.
// ─────────────────────────────────────────────
app.post("/api/checkout-draft", (req: Request, res: Response) => {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";

  if (!checkDraftRateLimit(ip)) {
    res.status(429).json({ error: "Zu viele Draft-Anfragen. Bitte versuche es später erneut." });
    return;
  }

  const { email, budget, brand, bodyType, transmission, drive, notes, source } = req.body as Record<string, unknown>;

  // Email ist Pflicht, weil das die Kern-Identifikation ist
  if (typeof email !== "string" || !email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    res.status(400).json({ error: "Gültige E-Mail-Adresse erforderlich." });
    return;
  }

  cleanupDrafts();

  const token = generateOpaqueToken();
  const now = Date.now();
  const draft: CheckoutDraft = {
    email: sanitizeMetaField(email, 500),
    budget: sanitizeMetaField(budget, 100),
    brand: sanitizeMetaField(brand, 100),
    bodyType: sanitizeMetaField(bodyType, 100),
    transmission: sanitizeMetaField(transmission, 100),
    drive: sanitizeMetaField(drive, 100),
    notes: sanitizeMetaField(notes, 500),
    source: sanitizeSource(source),
    createdAt: now,
    expiresAt: now + DRAFT_TTL_MS,
  };
  draftStore.set(token, draft);

  res.json({ token, expiresAt: draft.expiresAt });
});

// ─────────────────────────────────────────────
//  GET /api/checkout-draft/:token
//
//  Lädt einen Draft einmalig. Single-use, damit Token nicht
//  im Browser-Verlauf oder in Server-Logs wiederverwendet werden kann.
// ─────────────────────────────────────────────
app.get("/api/checkout-draft/:token", (req: Request, res: Response) => {
  const token = String(req.params.token ?? "");
  if (!/^[a-f0-9]{64}$/.test(token)) {
    res.status(400).json({ error: "Ungültiger Token." });
    return;
  }

  cleanupDrafts();
  const draft = draftStore.get(token);
  if (!draft) {
    res.status(404).json({ error: "Draft nicht gefunden oder abgelaufen." });
    return;
  }

  // Single-use: nach Lesen löschen
  draftStore.delete(token);

  res.json({
    email: draft.email,
    budget: draft.budget,
    brand: draft.brand,
    bodyType: draft.bodyType,
    transmission: draft.transmission,
    drive: draft.drive,
    notes: draft.notes,
    source: draft.source,
  });
});

// ─────────────────────────────────────────────
//  POST /api/create-checkout
//
//  Mode wird per Env-Var CHECKOUT_MODE gesteuert (für Preview-Tests).
//  "hosted" (default) → Top-Level-Redirect (Original-Verhalten)
//  "embedded" → Stripe Embedded Checkout (TikTok-safe)
//
//  Bei "embedded" wird KEIN Top-Level-Redirect gemacht; der Client
//  bekommt client_secret und mounted das EmbeddedCheckout-iframe inline.
// ─────────────────────────────────────────────
app.post("/api/create-checkout", async (req: Request, res: Response) => {
  const { budget, brand, bodyType, transmission, drive, notes, email, source, draftToken } = req.body as {
    budget?: string;
    brand?: string;
    bodyType?: string;
    transmission?: string;
    drive?: string;
    notes?: string;
    email?: string;
    source?: string;
    draftToken?: string;
  };

  // Wenn draftToken mitgeschickt wird, lade die echten Werte daraus
  let effectiveEmail = email?.trim() ?? "";
  let effectiveBudget = budget;
  let effectiveBrand = brand;
  let effectiveBodyType = bodyType;
  let effectiveTransmission = transmission;
  let effectiveDrive = drive;
  let effectiveNotes = notes;
  let effectiveSource: string | undefined = source;

  if (draftToken && /^[a-f0-9]{64}$/.test(draftToken)) {
    const draft = draftStore.get(draftToken);
    if (draft) {
      // Single-use bei Draft-Load im Checkout
      draftStore.delete(draftToken);
      effectiveEmail = draft.email;
      effectiveBudget = draft.budget || budget;
      effectiveBrand = draft.brand || brand;
      effectiveBodyType = draft.bodyType || bodyType;
      effectiveTransmission = draft.transmission || transmission;
      effectiveDrive = draft.drive || drive;
      effectiveNotes = draft.notes || notes;
      effectiveSource = effectiveSource ?? draft.source;
    }
  }

  if (!effectiveEmail) {
    res.status(400).json({ error: "E-Mail-Adresse ist erforderlich." });
    return;
  }

  // App-Origin via allowlist (APP_URL → VERCEL_URL → request host)
  const appUrl = getAppOrigin(req);
  if (!appUrl) {
    console.error("❌ getAppOrigin returned empty — kein erlaubter Host. ALLOWED_HOSTS env prüfen.");
    res.status(500).json({ error: "Server-Konfigurationsfehler: App-Origin konnte nicht ermittelt werden." });
    return;
  }
  // CHECKOUT_MODE steuert Hosted vs. Embedded. Default: hosted.
  const checkoutMode = (process.env.CHECKOUT_MODE === "embedded" ? "embedded" : "hosted") as "hosted" | "embedded";
  const safeSource = sanitizeSource(effectiveSource);

  try {
    // Wir bauen die Session-Config abhängig vom Modus.
    // Wichtig: KEIN `any`-Cast; alle Felder sind in der Stripe-Lib getypt.
    const baseConfig = {
      mode: "payment" as const,
      customer_email: effectiveEmail.slice(0, 500),
      payment_method_types: ["card", "paypal"] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
      line_items: [
        {
          price_data: {
            currency: "eur",
            unit_amount: 4900,
            product_data: {
              name: "Auto-Beratung Premium",
              description: "Persönliche Auto-Beratung: 3 maßgeschneiderte Fahrzeugempfehlungen innerhalb von 48 Stunden.",
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        // Felder werden serverseitig begrenzt (max-Längen) bevor sie in Stripe landen
        email: sanitizeMetaField(effectiveEmail, 500),
        budget: sanitizeMetaField(effectiveBudget, 100),
        brand: sanitizeMetaField(effectiveBrand, 100),
        bodyType: sanitizeMetaField(effectiveBodyType, 100),
        transmission: sanitizeMetaField(effectiveTransmission, 100),
        drive: sanitizeMetaField(effectiveDrive, 100),
        notes: sanitizeMetaField(effectiveNotes, 500),
        source: safeSource,
      },
    };

    let session: Stripe.Checkout.Session;
    if (checkoutMode === "embedded") {
      session = await getStripe().checkout.sessions.create({
        ...baseConfig,
        ui_mode: "embedded_page" as Stripe.Checkout.SessionCreateParams.UiMode,
        return_url: `${appUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      });
    } else {
      session = await getStripe().checkout.sessions.create({
        ...baseConfig,
        success_url: `${appUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/?payment=cancelled`,
      });
    }

    if (checkoutMode === "embedded") {
      res.json({
        clientSecret: session.client_secret,
        sessionId: session.id,
      });
    } else {
      res.json({ url: session.url });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
    console.error("Stripe Checkout error:", msg);
    res.status(500).json({ error: "Zahlung konnte nicht initiiert werden. Bitte versuche es erneut." });
  }
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
    console.log(`\n🚀 Auto-Beratung Backend (Lokal) läuft auf Port ${PORT}`);
    console.log(`   → Gemini API: ${process.env.GEMINI_API_KEY ? "✅ Key vorhanden" : "❌ Key fehlt!"}`);
    console.log(`   → Stripe:     ${process.env.STRIPE_SECRET_KEY ? "✅ Key vorhanden" : "⚠️  Key fehlt (Checkout/Webhook deaktiviert)"}`);
    console.log(`   → Checkout-Mode: ${process.env.CHECKOUT_MODE === "embedded" ? "embedded" : "hosted (default)"}`);
  });
}

// ─────────────────────────────────────────────
//  E-Mail Templates
// ─────────────────────────────────────────────
function buildOwnerEmail(meta: Record<string, string>, session: Stripe.Checkout.Session): string {
  return `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f7; margin: 0; padding: 20px; }
  .card { background: white; border-radius: 16px; padding: 32px; max-width: 560px; margin: auto; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  h1 { color: #1a3a5c; font-size: 22px; margin: 0 0 4px; }
  .badge { display: inline-block; background: #ff6b35; color: white; border-radius: 8px; padding: 4px 12px; font-size: 13px; font-weight: 700; margin-bottom: 24px; }
  .row { display: flex; gap: 8px; margin-bottom: 10px; font-size: 15px; }
  .label { font-weight: 700; color: #1a3a5c; min-width: 130px; }
  .value { color: #334155; }
  .notes { background: #f8fafc; border-left: 4px solid #ff6b35; padding: 12px 16px; border-radius: 0 8px 8px 0; font-style: italic; color: #475569; }
  .footer { margin-top: 24px; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 16px; }
</style></head>
<body>
  <div class="card">
    <h1>🚗 Neue Beratungsanfrage eingegangen</h1>
    <div class="badge">Zahlung bestätigt — ${(session.amount_total ?? 4900) / 100} EUR</div>
    <div class="row"><span class="label">E-Mail:</span><span class="value">${meta.email ?? "—"}</span></div>
    <div class="row"><span class="label">Budget:</span><span class="value">${meta.budget ? meta.budget + " €" : "Nicht angegeben"}</span></div>
    <div class="row"><span class="label">Wunschmarke:</span><span class="value">${meta.brand || "Keine Präferenz"}</span></div>
    <div class="row"><span class="label">Karosserietyp:</span><span class="value">${meta.bodyType ?? "—"}</span></div>
    <div class="row"><span class="label">Getriebe:</span><span class="value">${meta.transmission ?? "—"}</span></div>
    <div class="row"><span class="label">Antrieb:</span><span class="value">${meta.drive ?? "—"}</span></div>
    ${meta.notes ? `<div class="row"><span class="label">Anmerkungen:</span></div><div class="notes">"${meta.notes}"</div>` : ""}
    <div class="footer">
      Stripe Session ID: ${session.id}<br>
      Source: ${meta.source ?? "unknown"}<br>
      Zeitpunkt: ${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}
    </div>
  </div>
</body>
</html>`;
}

function buildCustomerEmail(meta: Record<string, string>): string {
  return `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f7; margin: 0; padding: 20px; }
  .card { background: white; border-radius: 16px; padding: 32px; max-width: 520px; margin: auto; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  h1 { color: #1a3a5c; font-size: 20px; }
  p { color: #475569; font-size: 15px; line-height: 1.6; }
  .highlight { background: #fff7f4; border-radius: 12px; padding: 16px 20px; margin: 20px 0; }
  .highlight strong { color: #ff6b35; }
  .footer { margin-top: 24px; font-size: 12px; color: #94a3b8; }
</style></head>
<body>
  <div class="card">
    <h1>✅ Deine Anfrage ist eingegangen!</h1>
    <p>Vielen Dank für deine Buchung. Deine Beratungsanfrage wurde erfolgreich übermittelt und bezahlt.</p>
    <div class="highlight">
      <strong>Was passiert als nächstes?</strong><br>
      Wir analysieren deine Kriterien und senden dir innerhalb von <strong>48 Stunden</strong> 3 handgeprüfte Auto-Empfehlungen mit direkten Kauf-Links per E-Mail zu.
    </div>
    <p>Budget: <strong>${meta.budget ? meta.budget + " €" : "Nicht angegeben"}</strong><br>
    Karosserie: <strong>${meta.bodyType ?? "—"}</strong> | Getriebe: <strong>${meta.transmission ?? "—"}</strong></p>
    <div class="footer">Bei Fragen antworte einfach auf diese E-Mail.</div>
  </div>
</body>
</html>`;
}
