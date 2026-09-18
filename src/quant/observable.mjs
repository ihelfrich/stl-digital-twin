// Observables: measured series that remember where they came from.
//
// The failure mode this exists to prevent is the one the first economic layer
// walked into. It computed "floor space" for 38,570 buildings from a height
// field that only 167 of them actually have; the other 99.6% got a hard-coded
// default. Nothing in the output said so, and the number looked like a
// measurement.
//
// So an observable records, per record, whether the value was measured or
// imputed, and reports coverage. A relation built on low-coverage observables
// is not thereby wrong, but it is a statement about the imputation rule rather
// than about the city, and the grounding report has to say which.

import { UNITS } from "./dimension.mjs";
import { quantity, toSI } from "./quantity.mjs";

/**
 * @param read - given a record, return { value, measured } or null to skip.
 *               `measured: false` marks a value produced by an imputation rule
 *               rather than read from the source.
 */
export function extract({ name, symbol, unit: unitValue, source, field, method, records, read }) {
  const points = [];
  let imputed = 0;
  let skipped = 0;
  for (const record of records) {
    const reading = read(record);
    if (reading === null || reading === undefined || !Number.isFinite(reading.value)) {
      skipped += 1;
      continue;
    }
    if (!reading.measured) imputed += 1;
    points.push({ value: reading.value, measured: Boolean(reading.measured), id: reading.id });
  }
  const measured = points.length - imputed;
  return Object.freeze({
    name,
    symbol,
    unit: unitValue,
    points,
    provenance: Object.freeze({
      source,
      field: field ?? null,
      method: method ?? "direct read",
      records: records.length,
      used: points.length,
      skipped,
      measured,
      imputed,
      coverage: points.length === 0 ? 0 : measured / points.length,
      extractedAt: new Date().toISOString(),
    }),
  });
}

/** Build an observable from values that are derived rather than read. */
export function derived({ name, symbol, unit: unitValue, source, method, values, measured = true }) {
  const points = values
    .filter((value) => Number.isFinite(value))
    .map((value) => ({ value, measured, id: undefined }));
  return Object.freeze({
    name,
    symbol,
    unit: unitValue,
    points,
    provenance: Object.freeze({
      source,
      field: null,
      method,
      records: values.length,
      used: points.length,
      skipped: values.length - points.length,
      measured: measured ? points.length : 0,
      imputed: measured ? 0 : points.length,
      coverage: measured ? 1 : 0,
      extractedAt: new Date().toISOString(),
    }),
  });
}

export function values(observable) {
  return observable.points.map((point) => point.value);
}

/** Values in SI base units, which is the only scale it is safe to compare on. */
export function siValues(observable) {
  return observable.points.map((point) => toSI(quantity(point.value, observable.unit)));
}

export function measuredOnly(observable) {
  return Object.freeze({
    ...observable,
    points: observable.points.filter((point) => point.measured),
    provenance: Object.freeze({
      ...observable.provenance,
      method: `${observable.provenance.method} (restricted to measured records)`,
      imputed: 0,
      used: observable.points.filter((point) => point.measured).length,
      coverage: 1,
    }),
  });
}

export function summarize(observable) {
  const series = values(observable).slice().sort((a, b) => a - b);
  if (series.length === 0) return { n: 0 };
  const quantile = (p) => series[Math.min(series.length - 1, Math.floor(p * series.length))];
  const mean = series.reduce((sum, value) => sum + value, 0) / series.length;
  const variance = series.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, series.length - 1);
  return {
    n: series.length,
    unit: observable.unit.symbol,
    min: series[0],
    q25: quantile(0.25),
    median: quantile(0.5),
    q75: quantile(0.75),
    max: series[series.length - 1],
    mean,
    sd: Math.sqrt(variance),
    coverage: observable.provenance.coverage,
  };
}

export { UNITS };
