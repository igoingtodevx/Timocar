/**
 * AutoWunsch — Preisentwicklung: Normalisierung & Prognose (V1).
 *
 * Datenmodell (Audit 2, maßgeblich):
 * - `modelId` identifiziert das Modell.
 * - `modelYear` identifiziert eine eigenständige Modelljahr-Kohorte.
 * - Kohorten werden NIE vermischt; Deduplizierung ausschließlich über
 *   modelId + modelYear + timestamp.
 *
 * Prognose (V1):
 * - Robuste Theil-Sen-Regression auf logarithmierten Monatspreisen.
 * - t_i = tatsächliche Monatsdifferenz zum ersten gültigen Punkt (kein Array-Index).
 * - Jahres-Cap über die monatliche Log-Steigung (keine rekursive prev*0.80/1.20-Begrenzung).
 * - Kein SE-Band, keine Konfidenzintervalle, deterministisch.
 */

export interface PricePoint {
  modelId: number;
  modelName: string;
  modelYear: number;
  timestamp: number; // Unix-Sekunden, Monatsbeginn UTC
  price: number;     // €
  weight: number;    // normiertes Gewicht (String→Number), NICHT prognostisch verwendet
}

export interface HistoryPoint {
  timestamp: number;
  price: number;
}

export interface ForecastPoint {
  timestamp: number;
  price: number;
}

export interface ForecastResult {
  forecast: ForecastPoint[];
  reason: "ok" | "insufficient_data";
}

export interface ForecastOptions {
  /** Jährliche Veränderungsbegrenzung, z. B. 0.20 = ±20 % pro Jahr. */
  annualCap?: number;
  /** Untergrenze eines Prognosewerts in Euro. */
  minimumPrice?: number;
  /** Mindestanzahl gültiger Monatswerte für eine Prognose. */
  minimumMonths?: number;
  /** Anzahl der Prognosemonate (Default 60). */
  forecastMonths?: number;
}

export const DEFAULT_FORECAST_OPTIONS: Required<ForecastOptions> = {
  annualCap: 0.20,
  minimumPrice: 500,
  minimumMonths: 18,
  forecastMonths: 60,
};

/** Monatsbeginn UTC aus Unix-Sekunden (auf volle Minuten gerundet zur Vermeidung von Float-Artefakten). */
export function monthStart(timestamp: number): number {
  const date = new Date(timestamp * 1000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
}

/** Monatsdifferenz zwischen zwei Timestamps (Monatsbeginn UTC), unabhängig von Kalenderlängen. */
export function monthDifference(fromTimestamp: number, toTimestamp: number): number {
  const from = new Date(fromTimestamp * 1000);
  const to = new Date(toTimestamp * 1000);
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

/** Unix-Sekunden des Monatsbeginns `months` Monate nach dem Monatsbeginn von `timestamp`. */
export function addMonthsToTimestamp(timestamp: number, months: number): number {
  const date = new Date(timestamp * 1000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1) / 1000;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Normalisiert die Response der externen API für GENAU EINE angefragte Kohorte.
 *
 * - Alle model_years-Einträge mit `year === modelYear` werden zusammengeführt.
 * - `price` muss endlich und > 0 sein, `timestamp` endlich und > 0.
 * - `weight` wird defensiv als String→Number geparst (ungültig → 0), aber nie
 *   prognostisch verwendet.
 * - Deduplizierung ausschließlich über modelId + modelYear + timestamp;
 *   bei doppelten Schlüsseln wird deterministisch der erste Wert behalten.
 * - Rückgabe chronologisch nach timestamp sortiert (stabil).
 */
export function normalizeCohortResponse(
  raw: unknown,
  modelId: number,
  modelName: string,
  modelYear: number,
): PricePoint[] {
  if (typeof raw !== "object" || raw === null) return [];
  const record = raw as { model_years?: unknown };
  if (!Array.isArray(record.model_years)) return [];

  const cohorts = record.model_years.filter((entry: unknown): entry is { year?: unknown; chart_entities?: unknown } => {
    if (typeof entry !== "object" || entry === null) return false;
    return (entry as { year?: unknown }).year === modelYear;
  });
  if (cohorts.length === 0) return [];

  const seen = new Set<string>();
  const points: PricePoint[] = [];

  for (const cohort of cohorts) {
    if (!Array.isArray(cohort.chart_entities)) continue;
    for (const entity of cohort.chart_entities) {
      if (typeof entity !== "object" || entity === null) continue;
      const { price, timestamp, weight } = entity as { price?: unknown; timestamp?: unknown; weight?: unknown };

      if (!isFiniteNumber(price) || price <= 0) continue;
      if (!isFiniteNumber(timestamp) || timestamp <= 0) continue;

      const key = `${modelId}:${modelYear}:${timestamp}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let parsedWeight = 0;
      if (typeof weight === "string" && weight.trim() !== "") {
        const numeric = Number(weight);
        if (Number.isFinite(numeric) && numeric > 0) parsedWeight = numeric;
      } else if (isFiniteNumber(weight) && weight > 0) {
        parsedWeight = weight;
      }

      points.push({ modelId, modelName, modelYear, timestamp, price, weight: parsedWeight });
    }
  }

  points.sort((a, b) => a.timestamp - b.timestamp);
  return points;
}

interface PreparedPoint {
  t: number;
  z: number;
  lastTimestamp: number;
}

/** Interne Vorbereitung: Bereinigung + t_i als tatsächliche Monatsdifferenz. */
function preparePoints(points: PricePoint[]): PreparedPoint[] | null {
  if (points.length === 0) return null;

  // Defensive Datenhygiene (zusätzlich zur Normalisierung):
  // price endlich und > 0; nicht-endliche Werte verwerfen.
  const valid = points.filter((p) => Number.isFinite(p.price) && p.price > 0 && Number.isFinite(p.timestamp) && p.timestamp > 0);
  if (valid.length === 0) return null;

  const sorted = [...valid].sort((a, b) => a.timestamp - b.timestamp);

  // Ausreißer-Schutz: Preise > 10 × Median verwerfen.
  const prices = sorted.map((p) => p.price);
  const priceMedian = median(prices);
  const cleaned = sorted.filter((p) => p.price <= priceMedian * 10);

  const t0 = cleaned[0]!.timestamp;
  return cleaned.map((p) => ({
    t: monthDifference(t0, p.timestamp),
    z: Math.log(p.price),
    lastTimestamp: p.timestamp,
  }));
}

/**
 * Theil-Sen-Steigung auf logarithmierten Preisen.
 * t_i = tatsächliche Monatsdifferenz zum ersten Punkt — KEIN Array-Index.
 * Exportiert für deterministische Unit-Tests.
 */
export function theilSenLogSlope(points: PricePoint[]): number {
  const prepared = preparePoints(points);
  if (!prepared) return NaN;

  const slopes: number[] = [];
  for (let j = 1; j < prepared.length; j++) {
    for (let i = 0; i < j; i++) {
      const dt = prepared[j]!.t - prepared[i]!.t;
      if (dt <= 0) continue; // identische Monate liefern keine Steigung
      slopes.push((prepared[j]!.z - prepared[i]!.z) / dt);
    }
  }
  if (slopes.length === 0) return NaN;
  return median(slopes);
}

/**
 * Rechnerische Prognose für eine einzelne Modelljahr-Kohorte.
 *
 * - Nur die übergebenen Punkte (bereits auf die Kohorte normalisiert) werden verwendet.
 * - < minimumMonths (Default 18) gültige Punkte → forecast = [], reason = "insufficient_data".
 * - Theil-Sen auf ln(price) mit tatsächlichen Monatsdifferenzen.
 * - b wird auf [ln(1-cap)/12, ln(1+cap)/12] begrenzt (Cap pro Jahr, NICHT rekursiv pro Monat).
 * - Alle Prognosewerte direkt aus exp(a + b*t) — keine prev*0.80/1.20-Kette.
 * - Exakt 60 monatliche Punkte, erster Punkt = Monat nach dem letzten historischen Punkt.
 * - Volle Euro (Math.round), nie unter minimumPrice (Default 500 €), keine NaN/Infinity.
 * - Deterministisch: gleicher Input → gleicher Output.
 */
export function forecastCohort(points: PricePoint[], options?: ForecastOptions): ForecastResult {
  const opts: Required<ForecastOptions> = { ...DEFAULT_FORECAST_OPTIONS, ...options };

  const prepared = preparePoints(points);
  if (!prepared || prepared.length < opts.minimumMonths) {
    return { forecast: [], reason: "insufficient_data" };
  }

  // Theil-Sen: b_raw = Median aller Paar-Steigungen
  const slopes: number[] = [];
  for (let j = 1; j < prepared.length; j++) {
    for (let i = 0; i < j; i++) {
      const dt = prepared[j]!.t - prepared[i]!.t;
      if (dt <= 0) continue;
      slopes.push((prepared[j]!.z - prepared[i]!.z) / dt);
    }
  }
  const bRaw = slopes.length > 0 ? median(slopes) : NaN;

  const minMonthlySlope = Math.log(1 - opts.annualCap) / 12;
  const maxMonthlySlope = Math.log(1 + opts.annualCap) / 12;
  const b = Math.min(Math.max(bRaw, minMonthlySlope), maxMonthlySlope);

  // Achsenabschnitt: Median über z_i − b·t_i
  const intercepts = prepared.map((p) => p.z - b * p.t);
  const a = median(intercepts);

  const lastT = prepared[prepared.length - 1]!.t;
  const lastTimestamp = prepared[prepared.length - 1]!.lastTimestamp;

  const forecast: ForecastPoint[] = [];
  for (let k = 1; k <= opts.forecastMonths; k++) {
    const t = lastT + k;
    const rawPrice = Math.exp(a + b * t);
    const rounded = Math.round(rawPrice);
    const price = Math.max(rounded, opts.minimumPrice);
    if (!Number.isFinite(price)) continue;
    forecast.push({ timestamp: addMonthsToTimestamp(lastTimestamp, k), price });
  }

  return { forecast, reason: "ok" };
}
