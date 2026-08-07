import test from "node:test";
import assert from "node:assert/strict";
import { findVariant, modelForSeries, searchVariants, seriesHasVariants } from "../shared/pkw-models.ts";
import { normalizeCohortResponse } from "../shared/price-trend.ts";

test("R1. Audi TT parent bleibt neben TT RS / TT S auswählbar", () => {
  const parent = findVariant(46);
  assert.ok(parent);
  assert.equal(parent.modelId, 46);
  assert.equal(parent.variantName, "TT");
  assert.equal(parent.seriesName, "TT");
  assert.equal(seriesHasVariants("Audi", "TT"), true);
  assert.equal(modelForSeries("Audi", "TT"), undefined);
  const ids = searchVariants("", "Audi", "TT").map((item) => item.modelId);
  assert.deepEqual(ids, [46, 1659, 1660]);
});

test("R2. Ford Transit parent bleibt neben den Transit-Derivaten auswählbar", () => {
  const parent = findVariant(309);
  assert.ok(parent);
  assert.equal(parent.variantName, "Transit");
  const ids = searchVariants("", "Ford", "Transit").map((item) => item.modelId);
  assert.equal(ids[0], 309);
  for (const id of [1886, 1585, 2514, 1584]) assert.ok(ids.includes(id), `Transit-Untermodell ${id} fehlt`);
});

test("R3. Parent-IDs werden nicht mehr anhand von Namen verworfen", () => {
  for (const [make, series, id] of [
    ["Audi", "TT", 46],
    ["Ford", "Transit", 309],
    ["Porsche", "911", 762],
    ["BMW", "1er Reihe", 970],
    ["Mercedes-Benz", "E-Klasse", 981],
    ["Mercedes-Benz", "GT-Klasse", 3136],
  ] as const) {
    const parent = findVariant(id);
    assert.ok(parent, `${make} → ${series} (${id}) fehlt`);
    assert.equal(parent!.variantName, series);
    assert.ok(searchVariants("", make, series).some((item) => item.modelId === id));
  }
});

test("R4. Doppelte model_years-Kohorten werden zusammengeführt", () => {
  const ts1 = Date.UTC(2020, 0, 1) / 1000;
  const ts2 = Date.UTC(2020, 1, 1) / 1000;
  const raw = {
    model_years: [
      { year: 2020, chart_entities: [] },
      { year: 2020, chart_entities: [{ price: 10000, timestamp: ts1, weight: "0.1" }] },
      { year: 2020, chart_entities: [{ price: 11000, timestamp: ts2, weight: "0.2" }, { price: 99999, timestamp: ts1, weight: "0.9" }] },
    ],
  };
  const points = normalizeCohortResponse(raw, 46, "TT", 2020);
  assert.deepEqual(points.map((point) => [point.timestamp, point.price]), [[ts1, 10000], [ts2, 11000]]);
});
