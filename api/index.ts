/**
 * Auto-Beratung Premium — Express Backend (Vercel Serverless Compatible)
 *
 * Endpoints:
 *   POST /api/analyze-car      → Gemini + Google Search Grounding
 *   POST /api/create-checkout  → Stripe Checkout Session (49€)
 *   POST /api/stripe-webhook   → Stripe Webhook → E-Mail an Owner
 */

import express, { Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import Stripe from "stripe";
import nodemailer from "nodemailer";
import "dotenv/config";
import path from "path";
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

  // Exa-Grounding: aktuelle Web-Auszüge holen und in die Analyse einbetten
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

    setCache(normalizedQuery, carData);
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
  const { budget, brand, bodyType, transmission, drive, notes, email } = req.body as {
    budget?: string;
    brand?: string;
    bodyType?: string;
    transmission?: string;
    drive?: string;
    notes?: string;
    email?: string;
  };

  if (!email?.trim()) {
    res.status(400).json({ error: "E-Mail-Adresse ist erforderlich." });
    return;
  }

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  try {
    const session = await getStripe().checkout.sessions.create({
      payment_method_types: ["card", "paypal"],
      mode: "payment",
      customer_email: email.trim(),
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
        email: email.trim().slice(0, 500),
        budget: budget?.trim().slice(0, 100) ?? "",
        brand: brand?.trim().slice(0, 100) ?? "",
        bodyType: bodyType?.trim().slice(0, 100) ?? "",
        transmission: transmission?.trim().slice(0, 100) ?? "",
        drive: drive?.trim().slice(0, 100) ?? "",
        notes: notes?.trim().slice(0, 500) ?? "",
      },
      success_url: `${appUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/?payment=cancelled`,
    });

    res.json({ url: session.url });
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
