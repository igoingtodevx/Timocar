/**
 * AutoWunsch — Konkrete Fahrzeugvarianten (Exact Variants):
 * Unit- & API-Tests für Marke → Baureihe → Variante → Jahrgang.
 *
 * Verifizierte Quelle: https://www.pkw.de/api/v1/brands/models?with_main_ce=true
 * (verschachtelte `variants[]` innerhalb der Baureihen) und
 * https://preistrends-api.pkw.de/models/{concreteVariantId}.
 */

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  PKW_VARIANTS,
  PKW_MODELS,
  findVariant,
  findModel,
  searchModels,
  searchVariants,
  modelsByMake,
  listMakes,
  modelForSeries,
  seriesByMake,
  seriesHasVariants,
} from "../shared/pkw-models.ts";

// ── Test-Umgebung (Muster aus tests/price-trend.test.ts) ───────────────────
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

const monthTs = (year: number, month: number) => Date.UTC(year, month, 1) / 1000;

// Verifizierte konkrete Mercedes-Varianten (Audit AUTOWUNSCH_EXACT_VARIANTS_AUDIT.md)
const E400 = 552; // Mercedes-Benz E-Klasse → E 400
const E63 = 602; // Mercedes-Benz E-Klasse → E 63 AMG
const S63 = 1038; // Mercedes-Benz S-Klasse → S 63 AMG
const GT = 2229; // Mercedes-Benz GT-Klasse → AMG GT
const GTC = 3137; // Mercedes-Benz GT-Klasse → AMG GT C
const GTR = 3138; // Mercedes-Benz GT-Klasse → AMG GT R
const GTS = 2706; // Mercedes-Benz GT-Klasse → AMG GT S
const GT_AGGREGATE = 3136; // Sammel-ID GT-Klasse (keine Preisdaten, nie als Variante)
const E320 = 550; // E-Klasse → E 320 („E 320 d“ existiert nicht exakt)
const MODEL_ID = 948; // VW Golf

const MODEL_ONLY_SERIES_CASES: Array<[string, string, number]> = [
  ["Abarth", "595", 1813],
  ["Alfa Romeo", "Giulia", 18],
  ["Alpina", "B3", 21],
  ["Bentley", "Continental GT", 1831],
  ["Rolls-Royce", "Ghost", 1601],
  ["Audi", "A3", 34],
  ["Ford", "Mustang", 303],
];

// ── Verifizierte Varianten ──────────────────────────────────────────────────

test("V1. E 400 ist konkrete Variante mit korrekter modelId und Baureihe", () => {
  const v = findVariant(E400);
  assert.ok(v);
  assert.equal(v!.variantName, "E 400");
  assert.equal(v!.modelId, E400);
  assert.equal(v!.seriesName, "E-Klasse");
  assert.equal(v!.seriesId, 981);
  assert.equal(v!.brandName, "Mercedes-Benz");
  assert.equal(v!.brandId, 49);
});

test("V2. E 63 AMG ist konkrete Variante der E-Klasse", () => {
  const v = findVariant(E63);
  assert.ok(v);
  assert.equal(v!.variantName, "E 63 AMG");
  assert.equal(v!.modelId, E63);
  assert.equal(v!.seriesName, "E-Klasse");
});

test("V3. S 63 AMG ist konkrete Variante der S-Klasse", () => {
  const v = findVariant(S63);
  assert.ok(v);
  assert.equal(v!.variantName, "S 63 AMG");
  assert.equal(v!.modelId, S63);
  assert.equal(v!.seriesName, "S-Klasse");
  assert.equal(v!.seriesId, 986);
});

test("V4. AMG GT und konkrete GT-Varianten sind verfügbar", () => {
  const expected: Array<[number, string]> = [
    [GT, "AMG GT"],
    [GTC, "AMG GT C"],
    [GTR, "AMG GT R"],
    [GTS, "AMG GT S"],
  ];
  for (const [id, name] of expected) {
    const v = findVariant(id);
    assert.ok(v, `fehlt: ${name} (${id})`);
    assert.equal(v!.variantName, name);
    assert.equal(v!.seriesName, "GT-Klasse");
  }
});

test("V5. GT-Sammel-ID 3136 wird NICHT als konkrete Variante angeboten", () => {
  assert.equal(findVariant(GT_AGGREGATE), undefined);
  assert.equal(PKW_VARIANTS.some((item) => item.modelId === GT_AGGREGATE), false);
  // Keine Suche darf die Sammel-ID zurückliefern.
  for (const query of ["GT", "AMG GT", "GT-Klasse"]) {
    assert.ok(searchVariants(query, "Mercedes-Benz", "GT-Klasse").every((x) => x.modelId !== GT_AGGREGATE));
  }
});

test("V6. E 320 d wird nicht erfunden, E 320 (Quelle) existiert", () => {
  assert.equal(searchVariants("e320d", "Mercedes-Benz", "E-Klasse").length, 0);
  assert.equal(searchVariants("E 320 d", "Mercedes-Benz", "E-Klasse").length, 0);
  const e320 = findVariant(E320);
  assert.ok(e320);
  assert.equal(e320!.variantName, "E 320");
});

test("V7. Konkrete Varianten-IDs werden nicht zwischen Baureihen vermischt", () => {
  // E 400 existiert nur in der E-Klasse, nicht in der S-Klasse.
  assert.equal(searchVariants("e400", "Mercedes-Benz", "S-Klasse").length, 0);
  assert.equal(searchVariants("s63", "Mercedes-Benz", "E-Klasse").length, 0);
  assert.equal(searchVariants("e400", "Mercedes-Benz", "E-Klasse")[0]?.modelId, E400);
  assert.equal(searchVariants("s63", "Mercedes-Benz", "S-Klasse")[0]?.modelId, S63);
  assert.ok(searchVariants("e400", "Mercedes-Benz", "E-Klasse").every((x) => x.seriesName === "E-Klasse"));
});

test("V8. Kompakte Schreibweisen bleiben funktionsfähig", () => {
  assert.equal(searchVariants("e400", "Mercedes-Benz", "E-Klasse")[0]?.modelId, E400);
  assert.equal(searchVariants("e 400", "Mercedes-Benz", "E-Klasse")[0]?.modelId, E400);
  assert.equal(searchVariants("e63amg", "Mercedes-Benz", "E-Klasse")[0]?.modelId, E63);
  assert.equal(searchVariants("e 63 amg", "Mercedes-Benz", "E-Klasse")[0]?.modelId, E63);
  assert.equal(searchVariants("s63", "Mercedes-Benz", "S-Klasse")[0]?.modelId, S63);
  assert.equal(searchVariants("amg-gt", "Mercedes-Benz", "GT-Klasse")[0]?.modelId, GT);
  assert.equal(searchVariants("amg gt", "Mercedes-Benz", "GT-Klasse")[0]?.modelId, GT);
});

test("V9. Modelle ohne Varianten sind direkt als Baureihe auswählbar", () => {
  for (const [make, series, modelId] of MODEL_ONLY_SERIES_CASES) {
    assert.ok(seriesByMake(make).includes(series), `${make} → ${series} fehlt`);
    const result = searchVariants(series, make, series);
    assert.equal(result.length, 1, `${make} → ${series} darf keine zweite Auswahl erzwingen`);
    assert.equal(result[0]?.modelId, modelId);
    assert.equal(result[0]?.seriesId, undefined);
    assert.equal(seriesHasVariants(make, series), false);
    assert.equal(modelForSeries(make, series)?.modelId, modelId);
  }

  for (const [make, series, variant, modelId] of [
    ["Audi", "TT", "TT RS", 1659],
    ["Ford", "Transit", "Transit Custom", 2514],
    ["Mercedes-Benz", "E-Klasse", "E 400", E400],
  ] as const) {
    assert.equal(seriesHasVariants(make, series), true);
    assert.equal(modelForSeries(make, series), undefined);
    assert.equal(searchVariants(variant, make, series)[0]?.modelId, modelId);
  }
});

// ── Globale Suche (Kompatibilität) ─────────────────────────────────────────

test("V9. searchModels('golf') funktioniert global ohne Marke/Baureihe", () => {
  const results = searchModels("golf");
  assert.ok(results.some((x) => x.modelId === MODEL_ID), "VW Golf muss global gefunden werden");
  assert.ok(results.some((x) => x.brandName === "VW"));
  // Case-Insensitivity
  assert.deepEqual(searchModels("golf").map((x) => x.modelId), searchModels("GOLF").map((x) => x.modelId));
  assert.equal(searchModels("").length, 0);
});

test("V10. searchModels findet konkrete Mercedes-Varianten global", () => {
  const results = searchModels("E 400");
  assert.ok(results.some((x) => x.modelId === E400 && x.brandName === "Mercedes-Benz"));
  const gt = searchModels("AMG GT");
  assert.ok(gt.some((x) => x.modelId === GT));
  // Sammel-ID taucht auch global nicht auf.
  assert.ok(searchModels("GT-Klasse").every((x) => x.modelId !== GT_AGGREGATE));
});

test("V11. modelsByMake liefert nur Modelle der gewählten Marke", () => {
  const vw = modelsByMake("VW");
  assert.ok(vw.length > 0);
  assert.ok(vw.every((m) => m.make === "VW"));
  assert.ok(vw.some((m) => m.modelId === MODEL_ID));
  assert.deepEqual(modelsByMake("vw").map((m) => m.modelId), vw.map((m) => m.modelId));
  assert.equal(modelsByMake("GibtEsNicht").length, 0);
  assert.ok(listMakes().includes("VW"));
  assert.ok(new Set(listMakes()).size === listMakes().length, "Markenliste eindeutig");
});

test("V12. seriesByMake liefert die verifizierten Baureihen", () => {
  const series = seriesByMake("Mercedes-Benz");
  for (const name of ["E-Klasse", "S-Klasse", "GT-Klasse"]) {
    assert.ok(series.includes(name), `fehlt: ${name}`);
  }
  assert.deepEqual(seriesByMake("mercedes-benz"), series, "case-insensitive");
  assert.deepEqual(seriesByMake("Unbekannt"), []);
});

test("V13. Katalog-Konsistenz: eindeutige IDs, keine erfundenen Einträge", () => {
  assert.equal(PKW_VARIANTS.length, new Set(PKW_VARIANTS.map((x) => x.modelId)).size, "modelIds eindeutig");
  assert.equal(PKW_VARIANTS.length, new Set(PKW_VARIANTS.map((x) => x.id)).size, "ids eindeutig");
  assert.ok(PKW_VARIANTS.every((x) => x.modelId === x.id), "Kompatibilitäts-IDs = modelId");
  assert.ok(PKW_VARIANTS.every((x) => x.modelId > 0 && Number.isInteger(x.modelId)));
  assert.ok(PKW_VARIANTS.every((x) => x.brandName.length > 0 && x.variantName.length > 0));
  assert.ok(PKW_VARIANTS.length >= 1800, `Katalog klein: ${PKW_VARIANTS.length}`);
  assert.equal(PKW_MODELS.length, PKW_VARIANTS.length, "PKW_MODELS = PKW_VARIANTS");
  // Verifizierte Beispiele alle vorhanden
  for (const id of [E320, E400, E63, S63, GT, GTC, GTR, GTS]) assert.ok(findVariant(id), `fehlt: ${id}`);
});

test("V14. findModel-Kompatibilität: bekannte/unbekannte ID", () => {
  assert.ok(findModel(MODEL_ID));
  assert.equal(findModel(MODEL_ID)?.name, "Golf");
  assert.equal(findModel(99999999), undefined);
  assert.equal(findModel(-5), undefined);
});

// ── API: Jahre-Endpoint ─────────────────────────────────────────────────────

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
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

test("A1. Jahre sind dedupliziert und absteigend sortiert", async () => {
  mockResponse = () =>
    jsonResponse({
      id: E400,
      name: "E 400",
      model_years: [
        { year: 2020, chart_entities: [{ price: 1000, timestamp: monthTs(2020, 0), weight: "0.1" }] },
        { year: 2019, chart_entities: [{ price: 1000, timestamp: monthTs(2019, 0), weight: "0.1" }] },
        { year: 2020, chart_entities: [{ price: 2000, timestamp: monthTs(2020, 1), weight: "0.1" }] },
        { year: 2018, chart_entities: [{ price: 1000, timestamp: monthTs(2018, 0), weight: "0.1" }] },
      ],
    });
  const { status, body } = await get(`/api/price-trend/models/${E400}/years`);
  assert.equal(status, 200);
  assert.deepEqual(body.years, [2020, 2019, 2018]);
  assert.deepEqual(body.model, { id: E400, name: "E 400", make: "Mercedes-Benz" });
});

test("A2. Jahre ohne gültige Historie werden nicht angeboten", async () => {
  mockResponse = () =>
    jsonResponse({
      id: E63,
      name: "E 63 AMG",
      model_years: [
        // 2021: Preis 0 → ungültig
        { year: 2021, chart_entities: [{ price: 0, timestamp: monthTs(2021, 0), weight: "0.1" }] },
        // 2020: leere chart_entities → ungültig
        { year: 2020, chart_entities: [] },
        // 2019: gültig
        { year: 2019, chart_entities: [{ price: 5000, timestamp: monthTs(2019, 0), weight: "0.1" }] },
      ],
    });
  const { status, body } = await get(`/api/price-trend/models/${E63}/years`);
  assert.equal(status, 200);
  assert.deepEqual(body.years, [2019]);
});

test("A3. Variante ohne Preisdaten liefert leere Jahre (Empty-State) statt Fehler", async () => {
  mockResponse = () => jsonResponse({ id: GTC, name: "AMG GT C", model_years: [] });
  const { status, body } = await get(`/api/price-trend/models/${GTC}/years`);
  assert.equal(status, 200);
  assert.deepEqual(body.years, []);
});

test("A4. GT-Sammel-ID 3136 wird vom Backend abgelehnt, ohne externen Request", async () => {
  const first = await get(`/api/price-trend/models/${GT_AGGREGATE}/years`);
  assert.equal(first.status, 400, "Sammel-ID ist kein konkretes Modell → 400");
  assert.equal(capturedUrls.length, 0, "kein externer Request für Sammel-ID");
  const trend = await get(`/api/price-trend?modelId=${GT_AGGREGATE}&modelYear=2019`);
  assert.equal(trend.status, 400, "kein roter technischer Fehler");
  assert.equal(capturedUrls.length, 0);
});

test("A5. Konkrete Variante E 400 liefert gültige Preisdaten", async () => {
  const entities: Array<{ price: number; timestamp: number; weight: string }> = [];
  for (let k = 0; k < 36; k++) {
    entities.push({ price: 40000 + k * 100, timestamp: monthTs(2019, k), weight: "0.00001" });
  }
  mockResponse = () => jsonResponse({ id: E400, name: "E 400", model_years: [{ year: 2019, chart_entities: entities }] });
  const { status, body } = await get(`/api/price-trend?modelId=${E400}&modelYear=2019`);
  assert.equal(status, 200);
  assert.deepEqual(body.model, { id: E400, name: "E 400", make: "Mercedes-Benz" });
  assert.equal(body.modelYear, 2019);
  assert.equal((body.history as Array<unknown>).length, 36);
  assert.ok((body.forecast as Array<unknown>).length > 0, "Prognose mit 36 Punkten möglich");
  assert.equal(body.reason, "ok");
  assert.equal(capturedUrls.length, 1);
  const url = new URL(capturedUrls[0]!);
  assert.equal(url.searchParams.get("years[]"), "2019");
});

test("A6. Trend ohne gewünschte Kohorte → verständliche 400 (kein 502)", async () => {
  mockResponse = () => jsonResponse({ id: S63, name: "S 63 AMG", model_years: [{ year: 2020, chart_entities: [{ price: 1, timestamp: monthTs(2020, 0), weight: "0.1" }] }] });
  const { status, body } = await get(`/api/price-trend?modelId=${S63}&modelYear=2019`);
  assert.equal(status, 400);
  assert.ok(typeof body.error === "string" && body.error.length > 0);
});
