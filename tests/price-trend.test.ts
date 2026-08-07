/**
 * AutoWunsch — Preisentwicklung (V1): Unit- & API-Tests.
 *
 * Test-Runner: node:test + assert/strict (npm test).
 * API-Tests starten die Express-App auf einem Ephemer-Port und ersetzen den
 * externen Fetch über setPriceTrendFetchForTests (analog setWebhookOutboxForTests).
 */

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCatalog,
  normalizeText,
} from "../scripts/fetch-pkw-models.ts";
import {
  PKW_MODELS,
  findModel,
  searchModels,
  modelsByMake,
  listMakes,
} from "../shared/pkw-models.ts";
import {
  normalizeCohortResponse,
  forecastCohort,
  theilSenLogSlope,
  addMonthsToTimestamp,
  monthStart,
  type PricePoint,
} from "../shared/price-trend.ts";

// ── Test-Umgebung (Muster aus tests/order.test.ts) ─────────────────────────
process.env.VERCEL = "1";
process.env.GEMINI_API_KEY = "test";
process.env.STRIPE_SECRET_KEY = "sk_test_123";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
process.env.OWNER_EMAIL = "owner@example.com";
process.env.SMTP_HOST = "smtp.example.com";
process.env.SMTP_USER = "smtp-user";
process.env.SMTP_PASS = "smtp-pass";
process.env.APP_URL = "https://example.com";
process.env.PRICE_TREND_ENABLED = "true";
delete process.env.PRICE_TREND_TIMEOUT_MS;
delete process.env.PRICE_TREND_RATE_LIMIT;
delete process.env.PRICE_TREND_RATE_WINDOW_MS;
delete process.env.PRICE_TREND_CACHE_TTL_MS;
delete process.env.PRICE_TREND_FORECAST_CAP;

const MODEL_ID = 948; // VW Golf (im generierten Katalog verifiziert)
const MODEL_NAME = "Golf";
const MODEL_MAKE = "VW";
const OTHER_MODEL_ID = 2774; // Abarth 124 Spider

// ── Helper ──────────────────────────────────────────────────────────────────

/** Unix-Sekunden für Monatsbeginn UTC (Jahr, Monat 0-basiert). */
function monthTs(year: number, month: number): number {
  return Date.UTC(year, month, 1) / 1000;
}

function makePoint(timestamp: number, price: number, modelYear = 2019, weight = "0.00001"): PricePoint {
  return { modelId: MODEL_ID, modelName: MODEL_NAME, modelYear, timestamp, price, weight: Number(weight) };
}

/** Kohorten-Response mit n monatlichen Punkten, Preis = base * growth^t. */
function cohortRaw(modelYear: number, base: number, growth: number, count: number, startYear = 2019, startMonth = 0) {
  const entities = [];
  for (let k = 0; k < count; k++) {
    entities.push({
      price: Math.round(base * Math.pow(growth, k)),
      timestamp: monthTs(startYear + Math.floor((startMonth + k) / 12), (startMonth + k) % 12),
      weight: "0.00001005795080282126",
    });
  }
  return {
    id: MODEL_ID,
    name: MODEL_NAME,
    model_years: [{ year: modelYear, chart_entities: entities }],
  };
}

function pointSeries(modelYear: number, base: number, growth: number, count: number, startYear = 2019): PricePoint[] {
  const points: PricePoint[] = [];
  for (let k = 0; k < count; k++) {
    points.push(makePoint(monthTs(startYear + Math.floor(k / 12), k % 12), base * Math.pow(growth, k), modelYear));
  }
  return points;
}

function approx(actual: number, expected: number, tolerance = 0.01): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ≈ ${expected} ±${tolerance}`);
}

let serverOrigin = "";
let capturedUrls: string[] = [];
let mockResponse: () => Promise<Response> | Response;
let server: import("node:http").Server | undefined;

before(async () => {
  const { default: app } = await import("../api/index.ts");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server!.address();
  assert.ok(address && typeof address === "object");
  serverOrigin = `http://127.0.0.1:${address.port}`;
});

after(() => {
  server?.close();
});

beforeEach(async () => {
  const { resetPriceTrendStateForTests, setPriceTrendFetchForTests } = await import("../api/index.ts");
  resetPriceTrendStateForTests();
  capturedUrls = [];
  mockResponse = () => new Response("{}", { status: 200 });
  setPriceTrendFetchForTests((url) => {
    capturedUrls.push(url);
    return Promise.resolve(mockResponse());
  });
});

async function get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${serverOrigin}${path}`);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  KATALOG (Tests 1–5)
// ═══════════════════════════════════════════════════════════════════════════

test("1. Generator normalisiert Marken und Modelle korrekt", () => {
  const raw = [
    { id: 76, name: "Volkswagen", models: [{ id: 948, name: "Golf" }, { id: 949, name: "  Polo  " }, { id: -1, name: "Kaputt" }, { id: 950, name: "" }] },
    { id: 104, name: "Abarth", models: [{ id: 2774, name: "124 Spider" }] },
    { name: "Ohne ID", models: [] },
    { id: 999, name: "Doppel", models: [{ id: 948, name: "Golf Klon" }] },
    "müll",
  ];
  const models = normalizeCatalog(raw);
  // Sortierung nach Marke (de) → Abarth vor Volkswagen; Duplikat-ID 948 wird verworfen.
  assert.equal(models.length, 3);
  assert.deepEqual(models.map((m) => m.make), ["Abarth", "Volkswagen", "Volkswagen"]);
  assert.equal(models[1].id, 948);
  assert.equal(models[1].make, "Volkswagen");
  assert.equal(models[1].name, "Golf");
  assert.equal(models[1].seriesName, "Golf");
  assert.equal(models[2].name, "Polo"); // getrimmt
});

test("2. findModel findet bekannte ID", () => {
  const model = findModel(MODEL_ID);
  assert.ok(model);
  assert.equal(model.id, MODEL_ID);
  assert.equal(model.name, MODEL_NAME);
});

test("3. findModel liefert undefined bei unbekannter ID", () => {
  assert.equal(findModel(99999999), undefined);
  assert.equal(findModel(-5), undefined);
  assert.equal(findModel(1.5), undefined);
});

test("4. searchModels ist case-insensitive", () => {
  const lower = searchModels("golf");
  const upper = searchModels("GOLF");
  assert.ok(lower.some((m) => m.id === MODEL_ID));
  assert.deepEqual(lower.map((m) => m.id), upper.map((m) => m.id));
  // Umlaut-/Diakritik-Normalisierung: „gölf“ findet Golf nicht, aber „124 spider“ schon.
  assert.ok(searchModels("124 spider").some((m) => m.id === 2774));
  assert.equal(searchModels("").length, 0);
});

test("5. modelsByMake liefert nur Modelle der gewählten Marke", () => {
  const vw = modelsByMake("VW");
  assert.ok(vw.length > 0);
  assert.ok(vw.every((m) => m.make === "VW"));
  assert.ok(vw.some((m) => m.id === MODEL_ID));
  const vwLower = modelsByMake("vw");
  assert.deepEqual(vwLower.map((m) => m.id), vw.map((m) => m.id));
  assert.equal(modelsByMake("GibtEsNicht").length, 0);
  assert.ok(listMakes().includes("VW"));
  assert.ok(new Set(listMakes()).size === listMakes().length, "Markenliste eindeutig");
});

// ═══════════════════════════════════════════════════════════════════════════
//  NORMALISIERUNG (Tests 6–12)
// ═══════════════════════════════════════════════════════════════════════════

test("6. genau eine angefragte Kohorte wird übernommen", () => {
  const raw = {
    id: MODEL_ID,
    name: MODEL_NAME,
    model_years: [
      { year: 2019, chart_entities: [{ price: 13956, timestamp: monthTs(2019, 0), weight: "0.00001" }] },
      { year: 2020, chart_entities: [{ price: 29239, timestamp: monthTs(2020, 0), weight: "0.00002" }] },
    ],
  };
  const points = normalizeCohortResponse(raw, MODEL_ID, MODEL_NAME, 2019);
  assert.equal(points.length, 1);
  assert.equal(points[0].price, 13956);
  assert.equal(points[0].modelYear, 2019);
});

test("7. fremde Kohorten werden nicht vermischt", () => {
  const raw = {
    id: MODEL_ID,
    name: MODEL_NAME,
    model_years: [
      { year: 2019, chart_entities: [{ price: 13956, timestamp: monthTs(2019, 0), weight: "0.00001" }] },
      { year: 2020, chart_entities: [{ price: 29239, timestamp: monthTs(2020, 0), weight: "0.00002" }] },
    ],
  };
  const points = normalizeCohortResponse(raw, MODEL_ID, MODEL_NAME, 2020);
  assert.equal(points.length, 1);
  assert.ok(points.every((p) => p.modelYear === 2020));
  assert.equal(points[0].price, 29239);
});

test("8. Deduplizierung nutzt modelId + modelYear + timestamp", () => {
  const raw = {
    id: MODEL_ID,
    name: MODEL_NAME,
    model_years: [
      {
        year: 2019,
        chart_entities: [
          { price: 100, timestamp: monthTs(2019, 0), weight: "0.1" },
          { price: 200, timestamp: monthTs(2019, 0), weight: "0.2" }, // Duplikat: gleicher Schlüssel
          { price: 300, timestamp: monthTs(2019, 1), weight: "0.3" },
        ],
      },
    ],
  };
  const points = normalizeCohortResponse(raw, MODEL_ID, MODEL_NAME, 2019);
  assert.equal(points.length, 2);
  // Deterministisch: der ERSTE Wert gewinnt.
  assert.equal(points.find((p) => p.timestamp === monthTs(2019, 0))?.price, 100);
});

test("9. gleiche Timestamps unterschiedlicher Kohorten bleiben logisch getrennt", () => {
  const shared = monthTs(2020, 5);
  const raw = {
    id: MODEL_ID,
    name: MODEL_NAME,
    model_years: [
      { year: 2019, chart_entities: [{ price: 18551, timestamp: shared, weight: "0.00001" }] },
      { year: 2020, chart_entities: [{ price: 20171, timestamp: shared, weight: "0.00002" }] },
    ],
  };
  const c2019 = normalizeCohortResponse(raw, MODEL_ID, MODEL_NAME, 2019);
  const c2020 = normalizeCohortResponse(raw, MODEL_ID, MODEL_NAME, 2020);
  assert.equal(c2019.length, 1);
  assert.equal(c2020.length, 1);
  assert.equal(c2019[0].price, 18551);
  assert.equal(c2020[0].price, 20171);
  assert.notEqual(c2019[0].price, c2020[0].price);
});

test("10. weight-String wird defensiv geparst", () => {
  const raw = {
    id: MODEL_ID,
    name: MODEL_NAME,
    model_years: [
      {
        year: 2019,
        chart_entities: [
          { price: 100, timestamp: monthTs(2019, 0), weight: "0.00001005795080282126" },
          { price: 101, timestamp: monthTs(2019, 1), weight: "kein-zahl" },
          { price: 102, timestamp: monthTs(2019, 2), weight: 0.5 },
          { price: 103, timestamp: monthTs(2019, 3), weight: "-3" },
        ],
      },
    ],
  };
  const points = normalizeCohortResponse(raw, MODEL_ID, MODEL_NAME, 2019);
  assert.equal(points.length, 4);
  assert.equal(points[0].weight, 0.00001005795080282126);
  assert.equal(points[1].weight, 0); // ungültiger String → 0
  assert.equal(points[2].weight, 0.5); // numerisch erlaubt
  assert.equal(points[3].weight, 0); // negativ → 0
});

test("11. ungültige Preise und Timestamps werden verworfen", () => {
  const raw = {
    id: MODEL_ID,
    name: MODEL_NAME,
    model_years: [
      {
        year: 2019,
        chart_entities: [
          { price: 0, timestamp: monthTs(2019, 0), weight: "0.1" },
          { price: -5, timestamp: monthTs(2019, 1), weight: "0.1" },
          { price: "13956", timestamp: monthTs(2019, 2), weight: "0.1" },
          { price: Number.NaN, timestamp: monthTs(2019, 3), weight: "0.1" },
          { price: Number.POSITIVE_INFINITY, timestamp: monthTs(2019, 4), weight: "0.1" },
          { price: 100, timestamp: 0, weight: "0.1" },
          { price: 101, timestamp: -1, weight: "0.1" },
          { price: 102, timestamp: Number.NaN, weight: "0.1" },
          { price: 103, timestamp: monthTs(2019, 5), weight: "0.1" },
        ],
      },
    ],
  };
  const points = normalizeCohortResponse(raw, MODEL_ID, MODEL_NAME, 2019);
  assert.equal(points.length, 1);
  assert.equal(points[0].price, 103);
});

test("12. Punkte werden chronologisch sortiert", () => {
  const raw = {
    id: MODEL_ID,
    name: MODEL_NAME,
    model_years: [
      {
        year: 2019,
        chart_entities: [
          { price: 300, timestamp: monthTs(2019, 2), weight: "0.1" },
          { price: 100, timestamp: monthTs(2019, 0), weight: "0.1" },
          { price: 200, timestamp: monthTs(2019, 1), weight: "0.1" },
        ],
      },
    ],
  };
  const points = normalizeCohortResponse(raw, MODEL_ID, MODEL_NAME, 2019);
  assert.deepEqual(points.map((p) => p.price), [100, 200, 300]);
});

// ═══════════════════════════════════════════════════════════════════════════
//  PROGNOSE (Tests 13–26)
// ═══════════════════════════════════════════════════════════════════════════

test("13. gleicher Input liefert identisches Ergebnis", () => {
  const points = pointSeries(2019, 14000, 1.005, 24);
  const a = forecastCohort(points);
  const b = forecastCohort(points);
  assert.deepEqual(a, b);
});

test("14. weniger als 18 Punkte ergibt forecast=[]", () => {
  const result = forecastCohort(pointSeries(2019, 14000, 1.005, 17));
  assert.deepEqual(result, { forecast: [], reason: "insufficient_data" });
});

test("15. 18 oder mehr gültige Punkte ermöglichen Prognose", () => {
  const result = forecastCohort(pointSeries(2019, 14000, 1.005, 18));
  assert.equal(result.reason, "ok");
  assert.ok(result.forecast.length > 0);
});

test("16. Prognose enthält exakt 60 Monatswerte", () => {
  const result = forecastCohort(pointSeries(2019, 14000, 1.005, 30));
  assert.equal(result.reason, "ok");
  assert.equal(result.forecast.length, 60);
});

test("17. Prognose beginnt im Monat nach dem letzten historischen Punkt", () => {
  const points = pointSeries(2019, 14000, 1.005, 30);
  const result = forecastCohort(points);
  const lastTs = points[points.length - 1].timestamp;
  assert.equal(result.forecast[0].timestamp, addMonthsToTimestamp(lastTs, 1));
  // Jeder Forecast-Timestamp ist Monatsbeginn UTC.
  for (const point of result.forecast) {
    assert.equal(point.timestamp, monthStart(point.timestamp));
  }
});

test("18. fehlende Monate verwenden tatsächliche Monatsdifferenzen statt Array-Indizes", () => {
  // Monate 0, 1, 3 (Februar fehlt). Preise folgen exakt ln p = 0.01·t.
  const points = [
    makePoint(monthTs(2019, 0), Math.exp(0)),
    makePoint(monthTs(2019, 1), Math.exp(0.01)),
    makePoint(monthTs(2019, 3), Math.exp(0.03)),
  ];
  const slope = theilSenLogSlope(points);
  approx(slope, 0.01, 1e-9); // mit Array-Indizes (0,1,2) wäre es 0.015
});

test("19. Theil-Sen-Steigung wird korrekt berechnet", () => {
  const points = pointSeries(2019, 10000, 1.01, 24);
  const slope = theilSenLogSlope(points);
  approx(slope, Math.log(1.01), 1e-9);
});

test("20. Jahres-Cap wird über die Log-Monatssteigung umgesetzt", () => {
  // Moderate Serie (1 %/Monat, unterhalb des Caps): Monatsfaktor bleibt natürlich.
  const moderate = forecastCohort(pointSeries(2019, 10000, 1.01, 24));
  assert.equal(moderate.reason, "ok");
  const moderateMonthly = moderate.forecast[12].price / moderate.forecast[0].price;
  approx(moderateMonthly, Math.pow(1.01, 12), 0.005);
  // Steile Serie (b_raw = ln 1.5 ≫ ln 1.2/12): Monatsfaktor wird auf ln(1.2)/12 geklemmt.
  const steep = forecastCohort(pointSeries(2019, 10000, 1.5, 24));
  assert.equal(steep.reason, "ok");
  const clampedMonthly = Math.exp(Math.log(1.2) / 12);
  for (let i = 1; i < steep.forecast.length; i++) {
    const ratio = steep.forecast[i].price / steep.forecast[i - 1].price;
    assert.ok(Math.abs(ratio - clampedMonthly) < 0.005, `Monatsfaktor ${ratio} muss ≈ ${clampedMonthly} sein`);
  }
});

test("21. keine rekursive monatliche ±20-%-Begrenzung", () => {
  // Eine rekursive prev*1.20-Kette würde JEDEN Prognosemonat um +20 % steigern.
  // Korrekt: +20 %/Jahr ⇒ Monatsfaktor ≈ +1,53 %, nie +20 %.
  const steep = forecastCohort(pointSeries(2019, 10000, 1.5, 24));
  assert.equal(steep.reason, "ok");
  for (let i = 1; i < steep.forecast.length; i++) {
    const ratio = steep.forecast[i].price / steep.forecast[i - 1].price;
    assert.ok(ratio < 1.1, `Monatsfaktor ${ratio} darf nicht +20 % sein`);
  }
});

test("22. jährlicher Trend überschreitet den konfigurierten Cap nicht", () => {
  const rising = forecastCohort(pointSeries(2019, 10000, 1.5, 24));
  assert.equal(rising.reason, "ok");
  for (let i = 12; i < rising.forecast.length; i++) {
    const ratio = rising.forecast[i].price / rising.forecast[i - 12].price;
    assert.ok(ratio <= 1.20 + 0.005, `aufsteigend: ${ratio} > 1.20`);
  }
  const falling = forecastCohort(pointSeries(2019, 10000, 0.9, 24));
  assert.equal(falling.reason, "ok");
  for (let i = 12; i < falling.forecast.length; i++) {
    const ratio = falling.forecast[i].price / falling.forecast[i - 12].price;
    assert.ok(ratio >= 0.80 - 0.005, `absteigend: ${ratio} < 0.80`);
  }
});

test("23. Preis fällt nie unter 500 €", () => {
  const points = pointSeries(2019, 10000, 0.9, 24);
  const result = forecastCohort(points, { annualCap: 0.95 }); // fast ohne Cap → tiefer Fall
  assert.equal(result.reason, "ok");
  assert.ok(result.forecast.length > 0);
  for (const point of result.forecast) {
    assert.ok(point.price >= 500, `Prognosewert ${point.price} < 500`);
  }
  assert.equal(Math.min(...result.forecast.map((p) => p.price)), 500, "Floor muss greifen");
});

test("24. keine negativen, NaN- oder Infinity-Werte", () => {
  const points = pointSeries(2019, 10000, 0.9, 24);
  const result = forecastCohort(points, { annualCap: 0.95 });
  for (const point of result.forecast) {
    assert.ok(Number.isFinite(point.price));
    assert.ok(point.price > 0);
    assert.ok(Number.isFinite(point.timestamp));
  }
});

test("25. extremer Ausreißer wird defensiv verworfen", () => {
  const clean = pointSeries(2019, 10000, 1.01, 19);
  const dirty = [
    ...clean,
    makePoint(monthTs(2020, 7), 10000 * 100), // 100× Median → > 10× Median
  ];
  const resultClean = forecastCohort(clean);
  const resultDirty = forecastCohort(dirty);
  assert.equal(resultClean.reason, "ok");
  assert.equal(resultDirty.reason, "ok");
  assert.deepEqual(resultDirty.forecast, resultClean.forecast);
});

test("26. Forecast enthält keine Konfidenzintervalle", () => {
  const result = forecastCohort(pointSeries(2019, 14000, 1.005, 24));
  for (const point of result.forecast) {
    assert.deepEqual(Object.keys(point).sort(), ["price", "timestamp"]);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  API (Tests 27–45)
// ═══════════════════════════════════════════════════════════════════════════

test("27. fehlende modelId → 400", async () => {
  const { status } = await get("/api/price-trend?modelYear=2019");
  assert.equal(status, 400);
});

test("28. ungültige modelId → 400", async () => {
  for (const modelId of ["abc", "1.5", "-3", "99999999"]) {
    const { status } = await get(`/api/price-trend?modelId=${modelId}&modelYear=2019`);
    assert.equal(status, 400, `modelId=${modelId}`);
  }
});

test("29. unbekannte modelId → 400 (ohne externen Request)", async () => {
  const { status } = await get("/api/price-trend?modelId=99999999&modelYear=2019");
  assert.equal(status, 400);
  assert.equal(capturedUrls.length, 0, "Katalog-Validierung muss vor dem externen Request greifen");
});

test("30. fehlendes modelYear → 400", async () => {
  const { status } = await get(`/api/price-trend?modelId=${MODEL_ID}`);
  assert.equal(status, 400);
});

test("31. ungültiges modelYear → 400", async () => {
  for (const modelYear of ["abc", "2020.5", "99", "99999", "-5"]) {
    const { status } = await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=${modelYear}`);
    assert.equal(status, 400, `modelYear=${modelYear}`);
  }
});

test("32. externe Response ohne gewünschte Kohorte → 400", async () => {
  mockResponse = () => jsonResponse({
    id: MODEL_ID,
    name: MODEL_NAME,
    model_years: [{ year: 2020, chart_entities: [{ price: 20000, timestamp: monthTs(2024, 0), weight: "0.1" }] }],
  });
  const { status, body } = await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2019`);
  assert.equal(status, 400);
  assert.equal(typeof body.error, "string");
});

test("33. gültiger Request → 200 mit vollständiger Response", async () => {
  mockResponse = () => jsonResponse(cohortRaw(2019, 14000, 1.005, 30));
  const { status, body } = await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2019`);
  assert.equal(status, 200);
  assert.deepEqual(body.model, { id: MODEL_ID, name: MODEL_NAME, make: MODEL_MAKE });
  assert.equal(body.modelYear, 2019);
  const history = body.history as Array<{ timestamp: number; price: number }>;
  const forecast = body.forecast as Array<{ timestamp: number; price: number }>;
  assert.equal(Array.isArray(history), true);
  assert.equal(history.length, 30);
  for (const point of history) {
    assert.deepEqual(Object.keys(point).sort(), ["price", "timestamp"]);
  }
  assert.equal(Array.isArray(forecast), true);
  assert.equal(forecast.length, 60);
  assert.equal(body.reason, "ok");
  assert.equal(body.source, "live");
  assert.equal(typeof body.disclaimer, "string");
  assert.ok((body.disclaimer as string).length > 20);
  // weight wird NICHT an den Browser gesendet
  assert.equal(JSON.stringify(body).includes("weight"), false);
});

test("34. Request an externe API enthält exakt ein years[]={modelYear}", async () => {
  mockResponse = () => jsonResponse(cohortRaw(2019, 14000, 1.005, 30));
  await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2019`);
  assert.equal(capturedUrls.length, 1);
  const url = new URL(capturedUrls[0]);
  assert.deepEqual(url.searchParams.getAll("years[]"), ["2019"]);
});

test("35. Request verwendet korrektes 36-Monats-Fenster", async () => {
  mockResponse = () => jsonResponse(cohortRaw(2019, 14000, 1.005, 30));
  await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2019`);
  const url = new URL(capturedUrls[0]);
  const now = new Date();
  const from = new Date(now);
  from.setUTCMonth(from.getUTCMonth() - 36);
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  assert.equal(url.searchParams.get("from"), iso(from));
  assert.equal(url.searchParams.get("to"), iso(now));
});

test("36. Cache-Hit verhindert zweiten externen Request", async () => {
  mockResponse = () => jsonResponse(cohortRaw(2019, 14000, 1.005, 30));
  const first = await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2019`);
  const second = await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2019`);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(capturedUrls.length, 1, "zweiter Request darf die externe API nicht erneut aufrufen");
  assert.equal(first.body.source, "live");
  assert.equal(second.body.source, "cache");
});

test("37. Cache-Key enthält modelId und modelYear", async () => {
  mockResponse = () => jsonResponse(cohortRaw(2019, 14000, 1.005, 30));
  await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2019`);
  await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2020`);
  assert.equal(capturedUrls.length, 2, "verschiedene Modelljahre dürfen sich nicht denselben Cache teilen");
  await get(`/api/price-trend?modelId=${OTHER_MODEL_ID}&modelYear=2019`);
  assert.equal(capturedUrls.length, 3, "verschiedene Modelle dürfen sich nicht denselben Cache teilen");
});

test("38. Feature-Flag false → 503", async () => {
  process.env.PRICE_TREND_ENABLED = "false";
  try {
    const { status, body } = await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2019`);
    assert.equal(status, 503);
    assert.equal(typeof body.error, "string");
    const years = await get(`/api/price-trend/models/${MODEL_ID}/years`);
    assert.equal(years.status, 503);
  } finally {
    process.env.PRICE_TREND_ENABLED = "true";
  }
});

test("39. Cache-Hits verbrauchen kein Rate-Limit; weitere Misses werden begrenzt", async () => {
  process.env.PRICE_TREND_RATE_LIMIT = "1";
  try {
    mockResponse = () => jsonResponse(cohortRaw(2019, 14000, 1.005, 30));
    const first = await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2019`);
    assert.equal(first.status, 200);
    const cached = await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2019`);
    assert.equal(cached.status, 200, "Cache-Hit darf nicht am Rate-Limit scheitern");
    assert.equal(cached.body.source, "cache");
    assert.equal(capturedUrls.length, 1);

    const miss = await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2020`);
    assert.equal(miss.status, 429, "zweiter Upstream-Miss im Fenster muss begrenzt werden");
    assert.equal(capturedUrls.length, 1, "429 muss vor einem weiteren externen Request greifen");
  } finally {
    delete process.env.PRICE_TREND_RATE_LIMIT;
  }
});

test("40. Timeout → 504", async () => {
  process.env.PRICE_TREND_TIMEOUT_MS = "1";
  try {
    mockResponse = () => new Promise<Response>(() => {});
    const { status } = await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2019`);
    assert.equal(status, 504);
  } finally {
    delete process.env.PRICE_TREND_TIMEOUT_MS;
  }
});

test("41. externe 500 → 502", async () => {
  mockResponse = () => jsonResponse({ error: "kaputt" }, 500);
  const { status, body } = await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2019`);
  assert.equal(status, 502);
  assert.equal(typeof body.error, "string");
  // Externe Fehlermeldung wird nicht ungefiltert durchgereicht.
  assert.equal(body.error, "Der Preisdaten-Anbieter meldet gerade einen Fehler. Bitte später erneut versuchen.");
});

test("42. externe 404 → verständliche interne Fehlerantwort", async () => {
  mockResponse = () => jsonResponse({ error: "not_found" }, 404);
  const { status, body } = await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2019`);
  assert.equal(status, 404);
  assert.equal(body.error, "Für dieses Modell sind keine Preisdaten verfügbar.");
});

test("43. Fehler werden nicht gecacht", async () => {
  mockResponse = () => jsonResponse({ error: "kaputt" }, 500);
  const failed = await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2019`);
  assert.equal(failed.status, 502);
  mockResponse = () => jsonResponse(cohortRaw(2019, 14000, 1.005, 30));
  const retry = await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2019`);
  assert.equal(retry.status, 200);
  assert.equal(capturedUrls.length, 2, "nach Fehler muss ein erneuter externer Request möglich sein");
});

test("44. Jahre-Endpoint liefert eindeutige, sortierte Jahre", async () => {
  mockResponse = () => jsonResponse({
    id: MODEL_ID,
    name: MODEL_NAME,
    model_years: [
      { year: 2020, chart_entities: [{ price: 1, timestamp: monthTs(2020, 0), weight: "0.1" }] },
      { year: 2019, chart_entities: [{ price: 1, timestamp: monthTs(2019, 0), weight: "0.1" }] },
      { year: 2020, chart_entities: [{ price: 2, timestamp: monthTs(2020, 1), weight: "0.1" }] },
      { year: 2018, chart_entities: [{ price: 1, timestamp: monthTs(2018, 0), weight: "0.1" }] },
    ],
  });
  const { status, body } = await get(`/api/price-trend/models/${MODEL_ID}/years`);
  assert.equal(status, 200);
  assert.deepEqual(body.years, [2020, 2019, 2018]);
  assert.deepEqual(body.model, { id: MODEL_ID, name: MODEL_NAME, make: MODEL_MAKE });
  assert.equal(body.source, "live");
});

test("45. Jahre-Endpoint nutzt eigenen Cache-Key und keinen years[]-Filter", async () => {
  mockResponse = () => jsonResponse(cohortRaw(2019, 14000, 1.005, 30));
  const first = await get(`/api/price-trend/models/${MODEL_ID}/years`);
  const second = await get(`/api/price-trend/models/${MODEL_ID}/years`);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.source, "cache");
  assert.equal(capturedUrls.length, 1, "Jahre-Cache muss den zweiten Request abfangen");
  assert.equal(new URL(capturedUrls[0]).searchParams.has("years[]"), false, "Jahre-Request ohne years[]-Filter");
  // Getrennt vom Trend-Cache: Trend-Request löst einen neuen externen Request aus.
  const trend = await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2019`);
  assert.equal(trend.status, 200);
  assert.equal(capturedUrls.length, 2);
});

test("45b. Jahre-Endpoint: unbekanntes Modell → 400, ungültige ID → 400", async () => {
  const unknown = await get(`/api/price-trend/models/99999999/years`);
  assert.equal(unknown.status, 400);
  const invalid = await get(`/api/price-trend/models/abc/years`);
  assert.equal(invalid.status, 400);
  assert.equal(capturedUrls.length, 0);
});

test("45c. Jahre-Endpoint: externer Fehler → 502, Timeout → 504", async () => {
  mockResponse = () => jsonResponse({ error: "x" }, 500);
  const failed = await get(`/api/price-trend/models/${MODEL_ID}/years`);
  assert.equal(failed.status, 502);
  process.env.PRICE_TREND_TIMEOUT_MS = "1";
  try {
    mockResponse = () => new Promise<Response>(() => {});
    const timedOut = await get(`/api/price-trend/models/${MODEL_ID}/years`);
    assert.equal(timedOut.status, 504);
  } finally {
    delete process.env.PRICE_TREND_TIMEOUT_MS;
  }
});

test("45d. PRICE_TREND_FORECAST_CAP akzeptiert nur 0 < cap < 1", async () => {
  mockResponse = () => jsonResponse(cohortRaw(2019, 14000, 1.03, 30));
  const expected = forecastCohort(
    normalizeCohortResponse(cohortRaw(2019, 14000, 1.03, 30), MODEL_ID, MODEL_NAME, 2019),
    { annualCap: 0.2 },
  );

  for (const invalidCap of ["0", "-0.1", "1", "1.5", "NaN", "abc"]) {
    process.env.PRICE_TREND_FORECAST_CAP = invalidCap;
    const { status, body } = await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2019`);
    assert.equal(status, 200, `cap=${invalidCap}`);
    assert.deepEqual(body.forecast, expected.forecast, `cap=${invalidCap} muss auf Default 0.20 zurückfallen`);
    // Cache je Cap-Iteration umgehen.
    const { resetPriceTrendStateForTests } = await import("../api/index.ts");
    resetPriceTrendStateForTests();
  }

  process.env.PRICE_TREND_FORECAST_CAP = "0.1";
  const custom = await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2019`);
  assert.equal(custom.status, 200);
  assert.notDeepEqual(custom.body.forecast, expected.forecast, "cap=0.10 muss akzeptiert werden");
  delete process.env.PRICE_TREND_FORECAST_CAP;
});

// ═══════════════════════════════════════════════════════════════════════════
//  ZUSÄTZLICHE ABDECKUNG
// ═══════════════════════════════════════════════════════════════════════════

test("46+. Katalog-Konsistenz: PKW_MODELS vollständig und eindeutig", () => {
  assert.ok(PKW_MODELS.length >= 1400, `Katalog klein: ${PKW_MODELS.length}`);
  const ids = new Set(PKW_MODELS.map((m) => m.id));
  assert.equal(ids.size, PKW_MODELS.length, "Modell-IDs müssen eindeutig sein");
  const vw = findModel(MODEL_ID);
  assert.equal(vw?.make, "VW");
});

test("46b. normalizeText: Umlaute und Leerzeichen normalisiert", () => {
  assert.equal(normalizeText("  Mercedes-Benz  "), "mercedes-benz");
  assert.equal(normalizeText("Öko-Straße"), "oko-straße"); // NFD + Diakritik-Strip
  assert.equal(normalizeText("VW GOLF"), "vw golf");
});

test("46c. Prognose mit Optionen: min. 500 €-Floor und Cap konfigurierbar", () => {
  const result = forecastCohort(pointSeries(2019, 10000, 1.02, 24), { annualCap: 0.02, minimumPrice: 700 });
  assert.equal(result.reason, "ok");
  for (const point of result.forecast) {
    assert.ok(point.price >= 700);
  }
});

test("46d. Kohorten-Isolation über die API: 2019 vs. 2020 (T1/T2-Muster)", async () => {
  const raw2019 = cohortRaw(2019, 13956, 1.01, 36, 2019);
  const raw2020 = cohortRaw(2020, 29239, 0.99, 30, 2020);
  let year: number | null = null;
  mockResponse = () => {
    return jsonResponse(year === 2019 ? raw2019 : raw2020);
  };
  year = 2019;
  const a = await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2019`);
  year = 2020;
  const b = await get(`/api/price-trend?modelId=${MODEL_ID}&modelYear=2020`);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const historyA = a.body.history as Array<{ price: number }>;
  const historyB = b.body.history as Array<{ price: number }>;
  assert.notEqual(historyA[0].price, historyB[0].price, "Kohorten haben unterschiedliche Preisniveaus");
  // Die 2019er-Kohorte beginnt 2019, die 2020er-Kohorte 2020 — keine Vermischung.
  assert.equal((a.body.history as Array<{ timestamp: number }>)[0].timestamp, monthTs(2019, 0));
  assert.equal((b.body.history as Array<{ timestamp: number }>)[0].timestamp, monthTs(2020, 0));
});
