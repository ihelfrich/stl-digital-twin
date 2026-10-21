// Quantities: a number, a unit, and a standard uncertainty that propagates.
//
// Uncertainty is propagated to first order, which is the right approximation
// when the relative uncertainty is small and an honest over-simplification when
// it is not. Every quantity therefore reports `relativeUncertainty` so a caller
// can see when the linearisation has stopped being trustworthy.

import {
  DIMENSIONLESS, dimensionsEqual, divideDimensions, formatDimension, isDimensionless,
  multiplyDimensions, powerDimension, UNITS, unit,
} from "./dimension.mjs";

export function quantity(value, unitValue, uncertainty = 0) {
  if (!Number.isFinite(value)) throw new Error(`quantity: value must be finite, got ${value}`);
  if (uncertainty < 0) throw new Error("quantity: uncertainty must be non-negative");
  return Object.freeze({ value, unit: unitValue, uncertainty });
}

export function dimensionless(value, uncertainty = 0) {
  return quantity(value, UNITS.one, uncertainty);
}

/** Value expressed in SI base units. */
export function toSI(q) {
  return q.value * q.unit.factor + q.unit.offset;
}

export function siUncertainty(q) {
  return q.uncertainty * q.unit.factor;
}

export function convert(q, target) {
  if (!dimensionsEqual(q.unit.dimension, target.dimension)) {
    throw new Error(
      `convert: ${formatDimension(q.unit.dimension)} is not ${formatDimension(target.dimension)}`,
    );
  }
  const si = toSI(q);
  return quantity((si - target.offset) / target.factor, target, siUncertainty(q) / target.factor);
}

export function valueIn(q, target) {
  return convert(q, target).value;
}

export function add(a, b) {
  if (!dimensionsEqual(a.unit.dimension, b.unit.dimension)) {
    throw new Error(
      `add: cannot add ${formatDimension(a.unit.dimension)} to ${formatDimension(b.unit.dimension)}`,
    );
  }
  const converted = convert(b, a.unit);
  return quantity(
    a.value + converted.value,
    a.unit,
    Math.hypot(a.uncertainty, converted.uncertainty),
  );
}

export function subtract(a, b) {
  return add(a, quantity(-b.value, b.unit, b.uncertainty));
}

function requireMultiplicable(q, operation) {
  if (q.unit.offset !== 0) {
    throw new Error(`${operation}: unit ${q.unit.symbol} has an offset and cannot be scaled`);
  }
}

export function multiply(a, b) {
  requireMultiplicable(a, "multiply");
  requireMultiplicable(b, "multiply");
  const product = a.value * a.unit.factor * b.value * b.unit.factor;
  const relative = Math.hypot(relativeUncertainty(a), relativeUncertainty(b));
  const combined = multiplyDimensions(a.unit.dimension, b.unit.dimension);
  return quantity(product, unit(`${a.unit.symbol}*${b.unit.symbol}`, combined, 1),
    Math.abs(product) * relative);
}

export function divide(a, b) {
  requireMultiplicable(a, "divide");
  requireMultiplicable(b, "divide");
  if (b.value === 0) throw new Error("divide: division by zero");
  const ratio = (a.value * a.unit.factor) / (b.value * b.unit.factor);
  const relative = Math.hypot(relativeUncertainty(a), relativeUncertainty(b));
  const combined = divideDimensions(a.unit.dimension, b.unit.dimension);
  return quantity(ratio, unit(`${a.unit.symbol}/${b.unit.symbol}`, combined, 1),
    Math.abs(ratio) * relative);
}

export function power(a, exponent) {
  requireMultiplicable(a, "power");
  const base = a.value * a.unit.factor;
  const result = base ** exponent;
  const combined = powerDimension(a.unit.dimension, exponent);
  return quantity(result, unit(`${a.unit.symbol}^${exponent}`, combined, 1),
    Math.abs(result * exponent) * relativeUncertainty(a));
}

export function relativeUncertainty(q) {
  return q.value === 0 ? 0 : Math.abs(q.uncertainty / q.value);
}

/**
 * The gate that matters for empirical work: you may only take the logarithm of
 * a pure number. Anything else needs a reference scale, and naming it is the
 * caller's job because the choice ends up in the intercept.
 */
export function requireDimensionless(q, context) {
  if (!isDimensionless(q.unit.dimension)) {
    throw new Error(
      `${context}: expected a dimensionless quantity, got ${formatDimension(q.unit.dimension)}. `
      + "Divide by an explicit reference scale first.",
    );
  }
  return q;
}

/** log(q / reference), with the dimensional check done rather than assumed. */
export function logRatio(q, reference, context = "logRatio") {
  const ratio = divide(q, reference);
  requireDimensionless(ratio, context);
  const value = toSI(ratio);
  if (!(value > 0)) throw new Error(`${context}: log of a non-positive ratio (${value})`);
  return dimensionless(Math.log(value), relativeUncertainty(ratio));
}

export function format(q, digits = 4) {
  const uncertainty = q.uncertainty > 0 ? ` +/- ${q.uncertainty.toPrecision(2)}` : "";
  return `${q.value.toPrecision(digits)}${uncertainty} ${q.unit.symbol}`;
}

export { DIMENSIONLESS, UNITS };
