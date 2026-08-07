/**
 * Generates the static PKW variant catalog from pkw.de (one request, build-time only).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const CATALOG_URL = "https://www.pkw.de/api/v1/brands/models?with_main_ce=true";
const OUTPUT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../shared/pkw-models.ts");

type RawVariant = { id?: unknown; name?: unknown };
type RawModel = { id?: unknown; name?: unknown; variants?: unknown };
type RawBrand = { id?: unknown; name?: unknown; models?: unknown };
export interface NormalizedVariant {
  brandId: number;
  brandName: string;
  seriesId?: number;
  seriesName?: string;
  modelId: number;
  variantName: string;
  displayName: string;
  id: number;
  make: string;
  name: string;
}

const validId = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0;
const clean = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ") : undefined;

export function normalizeCatalog(raw: unknown): NormalizedVariant[] {
  if (!Array.isArray(raw)) throw new Error("Katalog-Response ist kein Array");
  const seen = new Set<number>();
  const result: NormalizedVariant[] = [];
  for (const brand of raw) {
    if (!brand || typeof brand !== "object") continue;
    const b = brand as RawBrand;
    const brandName = clean(b.name);
    if (!validId(b.id) || !brandName || !Array.isArray(b.models)) continue;
    for (const model of b.models) {
      if (!model || typeof model !== "object") continue;
      const m = model as RawModel;
      const seriesName = clean(m.name);
      if (!validId(m.id) || !seriesName) continue;
      const variants = Array.isArray(m.variants) ? m.variants : [];
      const entries = variants.length > 0 ? variants : [{ id: m.id, name: m.name }];
      for (const item of entries) {
        if (!item || typeof item !== "object") continue;
        const v = item as RawVariant;
        const id = v.id;
        const name = clean(v.name);
        if (!validId(id) || !name || seen.has(id)) continue;
        seen.add(id);
        const isAggregate = variants.length === 0;
        result.push({
          brandId: b.id,
          brandName,
          ...(isAggregate ? { seriesName } : { seriesId: m.id, seriesName }),
          modelId: id,
          variantName: name,
          displayName: name,
          id,
          make: brandName,
          name,
        });
      }
    }
  }
  result.sort((a, b) => a.brandName.localeCompare(b.brandName, "de") || (a.seriesName ?? "").localeCompare(b.seriesName ?? "", "de") || a.displayName.localeCompare(b.displayName, "de") || a.modelId - b.modelId);
  return result;
}

export function normalizeText(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
}

function helperSource(): string {
  return `
function normalizeText(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/\\p{Diacritic}/gu, "").replace(/\\s+/g, " ").trim();
}

function catalogSeriesName(item: PkwVariant): string {
  return item.seriesName ?? item.variantName;
}

function buildSyntheticSeriesParents(): PkwVariant[] {
  const groups = new Map<number, PkwVariant[]>();
  for (const item of PKW_VARIANTS) {
    if (item.seriesId === undefined || !item.seriesName) continue;
    const existing = groups.get(item.seriesId);
    if (existing) existing.push(item);
    else groups.set(item.seriesId, [item]);
  }

  const parents: PkwVariant[] = [];
  for (const [seriesId, children] of groups) {
    const first = children[0]!;
    const seriesName = first.seriesName!;
    const seriesNeedle = normalizeText(seriesName);
    if (!seriesNeedle || seriesNeedle === "andere") continue;

    // pkw.de uses variants[] both for pure grouping nodes (e.g. E-Klasse)
    // and for real base models with derivatives (e.g. TT, Transit, T5).
    // A parent behaves like a concrete model when child names extend the
    // parent name itself. Pure taxonomy groups do not satisfy this rule.
    const behavesLikeConcreteModel = children.some((item) => {
      const variant = normalizeText(item.variantName);
      return variant === seriesNeedle
        || variant.startsWith(seriesNeedle + " ")
        || variant.startsWith(seriesNeedle + "-")
        || variant.startsWith(seriesNeedle + "/");
    });
    if (!behavesLikeConcreteModel) continue;
    if (PKW_VARIANTS.some((item) => item.modelId === seriesId)) continue;

    parents.push({
      brandId: first.brandId,
      brandName: first.brandName,
      seriesId,
      seriesName,
      modelId: seriesId,
      variantName: seriesName,
      displayName: seriesName,
      id: seriesId,
      make: first.brandName,
      name: seriesName,
    });
  }
  return parents;
}

const SYNTHETIC_SERIES_PARENTS: readonly PkwVariant[] = buildSyntheticSeriesParents();

export function listMakes(): string[] {
  return [...new Set(PKW_VARIANTS.map((item) => item.brandName))];
}

export function seriesByMake(make: string): string[] {
  const needle = normalizeText(make);
  return [...new Set(PKW_VARIANTS.filter((item) => normalizeText(item.brandName) === needle).map(catalogSeriesName))].sort((a, b) => a.localeCompare(b, "de"));
}

export function variantsByMake(make: string, series?: string): PkwVariant[] {
  const makeNeedle = normalizeText(make);
  const seriesNeedle = normalizeText(series ?? "");
  const base = PKW_VARIANTS.filter((item) => normalizeText(item.brandName) === makeNeedle && (!seriesNeedle || normalizeText(catalogSeriesName(item)) === seriesNeedle));
  if (!seriesNeedle) return base;
  const parents = SYNTHETIC_SERIES_PARENTS.filter((item) => normalizeText(item.brandName) === makeNeedle && normalizeText(catalogSeriesName(item)) === seriesNeedle);
  return [...parents, ...base];
}

export function seriesHasVariants(make: string, series: string): boolean {
  return variantsByMake(make, series).some((item) => item.seriesId !== undefined);
}

export function modelForSeries(make: string, series: string): PkwVariant | undefined {
  if (!series.trim() || seriesHasVariants(make, series)) return undefined;
  return variantsByMake(make, series).find((item) => item.seriesId === undefined);
}

function searchKey(value: string): string {
  return normalizeText(value).replaceAll(" ", "").replaceAll("-", "");
}

export function searchVariants(query: string, make?: string, series?: string, limit = 100): PkwVariant[] {
  const needle = searchKey(query);
  if (!needle && !make && !series) return [];
  return variantsByMake(make ?? "", series).filter((item) => !needle || searchKey([item.variantName, item.displayName, item.seriesName ?? ""].join(" ")).includes(needle)).slice(0, limit);
}

export function findVariant(id: number): PkwVariant | undefined {
  return PKW_VARIANTS.find((item) => item.modelId === id) ?? SYNTHETIC_SERIES_PARENTS.find((item) => item.modelId === id);
}

export function searchModels(query: string, limit = 50): PkwVariant[] {
  const needle = searchKey(query);
  if (!needle) return [];
  return [...SYNTHETIC_SERIES_PARENTS, ...PKW_VARIANTS].filter((item) => searchKey([item.brandName, item.seriesName ?? "", item.variantName, item.displayName].join(" ")).includes(needle)).slice(0, limit);
}

export const findModel = findVariant;
export const modelsByMake = variantsByMake;
`;
}

function render(items: NormalizedVariant[]): string {
  return items.map((item) => `  ${JSON.stringify(item)},`).join("\n");
}

async function main(): Promise<void> {
  const response = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Katalog-Request fehlgeschlagen: HTTP ${response.status}`);
  const items = normalizeCatalog(await response.json());
  if (!items.length) throw new Error("Katalog ist leer");
  const source = `/** GENERATED from ${CATALOG_URL}; do not edit manually. */

export interface PkwVariant {
  brandId: number;
  brandName: string;
  seriesId?: number;
  seriesName?: string;
  modelId: number;
  variantName: string;
  displayName: string;
  id: number;
  make: string;
  name: string;
}

export type PkwModel = PkwVariant;

export const PKW_VARIANTS: readonly PkwVariant[] = [
${render(items)}
];

export const PKW_MODELS = PKW_VARIANTS;

${helperSource()}
`;
  fs.writeFileSync(OUTPUT_PATH, source, "utf8");
  console.log(`OK: ${items.length} variants → ${OUTPUT_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error); process.exit(1); });

export type { RawBrand, RawModel, RawVariant };
export const CATALOG_ENDPOINT = CATALOG_URL;
export const CATALOG_OUTPUT = OUTPUT_PATH;
export const generatorMain = main;
export const isValidCatalogId = validId;
export const cleanCatalogText = clean;
