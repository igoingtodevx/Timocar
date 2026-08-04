/**
 * AutoWunsch — PKW-Modellkatalog-Generator (Einmalausführung, nicht Teil des Laufzeitbetriebs)
 *
 * Holt den öffentlichen Marken-/Modellkatalog von pkw.de mit genau EINEM Request
 * und generiert daraus die statische Datei `shared/pkw-models.ts`.
 *
 * Ausführung:
 *   node --import tsx scripts/fetch-pkw-models.ts
 *
 * Die generierte Datei wird committet. Die Anwendung macht zur Laufzeit KEINE
 * Requests an www.pkw.de — nur der Preis-Proxy spricht mit preistrends-api.pkw.de.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const CATALOG_URL = "https://www.pkw.de/api/v1/brands/models?with_main_ce=true";
const OUTPUT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../shared/pkw-models.ts");
const TIMEOUT_MS = 30_000;

type RawModel = { id?: unknown; name?: unknown };
type RawBrand = { id?: unknown; name?: unknown; models?: unknown };

interface NormalizedModel {
  id: number;
  make: string;
  name: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Defensive Normalisierung: nur Marken/Modelle mit gültiger ID und nicht-leerem
 * Namen werden übernommen; Namen werden getrimmt und Mehrfach-Leerzeichen
 * reduziert. Duplikate (gleiche Modell-ID) werden mit dem ersten Vorkommen
 * behalten — deterministisch.
 */
export function normalizeCatalog(raw: unknown): NormalizedModel[] {
  if (!Array.isArray(raw)) {
    throw new Error("Katalog-Response ist kein Array");
  }

  const seen = new Set<number>();
  const out: NormalizedModel[] = [];

  for (const brand of raw) {
    if (typeof brand !== "object" || brand === null) continue;
    const brandRecord = brand as RawBrand;
    if (!isNonEmptyString(brandRecord.name)) continue;
    const make = brandRecord.name.trim().replace(/\s+/g, " ");
    const models = Array.isArray(brandRecord.models) ? brandRecord.models : [];
    for (const model of models) {
      if (typeof model !== "object" || model === null) continue;
      const modelRecord = model as RawModel;
      if (!isFiniteId(modelRecord.id) || !isNonEmptyString(modelRecord.name)) continue;
      if (seen.has(modelRecord.id)) continue;
      seen.add(modelRecord.id);
      out.push({
        id: modelRecord.id,
        make,
        name: modelRecord.name.trim().replace(/\s+/g, " "),
      });
    }
  }

  out.sort((a, b) => {
    const byMake = a.make.localeCompare(b.make, "de");
    if (byMake !== 0) return byMake;
    return a.name.localeCompare(b.name, "de");
  });

  return out;
}

/** Umlaute/Diakritika normalisieren (nur für Suche/Vergleich, nicht für Anzeige). */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildHelperSource(): string {
  return `
export interface PkwModel {
  id: number;
  make: string;
  name: string;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\\p{Diacritic}/gu, "")
    .replace(/\\s+/g, " ")
    .trim();
}

export function listMakes(): string[] {
  const makes: string[] = [];
  for (const model of PKW_MODELS) {
    if (makes[makes.length - 1] !== model.make) makes.push(model.make);
  }
  return makes;
}

export function modelsByMake(make: string): PkwModel[] {
  const needle = normalizeText(make);
  if (!needle) return [];
  return PKW_MODELS.filter((model) => normalizeText(model.make) === needle);
}

export function findModel(id: number): PkwModel | undefined {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  return PKW_MODELS.find((model) => model.id === id);
}

export function searchModels(query: string, limit?: number): PkwModel[] {
  const needle = normalizeText(query);
  if (!needle) return [];
  const cap = typeof limit === "number" && Number.isInteger(limit) && limit > 0 ? limit : 50;
  const results: PkwModel[] = [];
  for (const model of PKW_MODELS) {
    if (normalizeText(model.name).includes(needle) || normalizeText(model.make).includes(needle)) {
      results.push(model);
      if (results.length >= cap) break;
    }
  }
  return results;
}
`;
}

function renderEntries(models: NormalizedModel[]): string {
  const lines: string[] = [];
  for (const model of models) {
    lines.push(`  { id: ${model.id}, make: ${JSON.stringify(model.make)}, name: ${JSON.stringify(model.name)} },`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let raw: unknown;
  try {
    const response = await fetch(CATALOG_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Katalog-Request fehlgeschlagen: HTTP ${response.status}`);
    }
    raw = await response.json();
  } finally {
    clearTimeout(timer);
  }

  const models = normalizeCatalog(raw);
  if (models.length === 0) {
    throw new Error("Katalog ist leer — Abbruch, keine Datei geschrieben");
  }

  const makeCount = new Set(models.map((m) => m.make)).size;
  const source = `/**
 * AutoWunsch — Statischer PKW-Modellkatalog.
 *
 * GENERIERT — nicht manuell bearbeiten.
 * Quelle: ${CATALOG_URL}
 * Erzeugt von: scripts/fetch-pkw-models.ts
 *
 * ${models.length} Modelle aus ${makeCount} Marken.
 */

export interface PkwModel {
  id: number;
  make: string;
  name: string;
}

export const PKW_MODELS: readonly PkwModel[] = [
${renderEntries(models)}
];
${buildHelperSource()}
`;

  fs.writeFileSync(OUTPUT_PATH, source, "utf8");
  console.log(`OK: ${models.length} Modelle (${makeCount} Marken) → ${OUTPUT_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error("Katalog-Generator fehlgeschlagen:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
