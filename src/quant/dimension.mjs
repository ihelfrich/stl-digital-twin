// Physical dimensions and units.
//
// The point of carrying dimensions through a model is not tidiness. It is that
// most ways of writing down a wrong quantitative relationship are dimensionally
// detectable before any data is touched: adding a length to a time, fitting an
// exponent to a quantity that carries units, or taking the logarithm of
// something that is not a pure number. The last one is the common sin in
// empirical work - `log(area)` is not a thing unless you say area *relative to
// what*, and the reference scale you chose silently ends up inside the
// intercept.
//
// Base dimensions are the seven SI ones plus currency, which is genuinely
// independent of them and which economics needs.

export const BASE_DIMENSIONS = [
  "length", "mass", "time", "current", "temperature", "amount", "luminosity", "currency",
];

const EXPONENT_TOLERANCE = 1e-9;

export function dimension(exponents = {}) {
  for (const name of Object.keys(exponents)) {
    if (!BASE_DIMENSIONS.includes(name)) throw new Error(`dimension: unknown base dimension "${name}"`);
  }
  return Object.freeze(
    Object.fromEntries(BASE_DIMENSIONS.map((name) => [name, exponents[name] ?? 0])),
  );
}

export const DIMENSIONLESS = dimension({});

export function dimensionsEqual(a, b) {
  return BASE_DIMENSIONS.every((name) => Math.abs(a[name] - b[name]) < EXPONENT_TOLERANCE);
}

export function isDimensionless(value) {
  return dimensionsEqual(value, DIMENSIONLESS);
}

export function multiplyDimensions(a, b) {
  return dimension(Object.fromEntries(BASE_DIMENSIONS.map((name) => [name, a[name] + b[name]])));
}

export function divideDimensions(a, b) {
  return dimension(Object.fromEntries(BASE_DIMENSIONS.map((name) => [name, a[name] - b[name]])));
}

export function powerDimension(a, exponent) {
  return dimension(Object.fromEntries(BASE_DIMENSIONS.map((name) => [name, a[name] * exponent])));
}

export function formatDimension(value) {
  const parts = BASE_DIMENSIONS
    .filter((name) => Math.abs(value[name]) > EXPONENT_TOLERANCE)
    .map((name) => (Math.abs(value[name] - 1) < EXPONENT_TOLERANCE ? name : `${name}^${value[name]}`));
  return parts.length === 0 ? "dimensionless" : parts.join("*");
}

/**
 * A unit is a named scale on a dimension. `factor` converts to the SI base;
 * `offset` exists only for temperature scales and is deliberately refused
 * anywhere it would be ambiguous - 20 degC times 2 is not a temperature.
 */
export function unit(symbol, dimensionValue, factor = 1, offset = 0) {
  return Object.freeze({ symbol, dimension: dimensionValue, factor, offset });
}

const L = dimension({ length: 1 });
const T = dimension({ time: 1 });

export const UNITS = {
  one: unit("1", DIMENSIONLESS, 1),
  metre: unit("m", L, 1),
  kilometre: unit("km", L, 1000),
  foot: unit("ft", L, 0.3048),
  squareMetre: unit("m^2", dimension({ length: 2 }), 1),
  squareKilometre: unit("km^2", dimension({ length: 2 }), 1e6),
  cubicMetre: unit("m^3", dimension({ length: 3 }), 1),
  second: unit("s", T, 1),
  hour: unit("h", T, 3600),
  metrePerSecond: unit("m/s", dimension({ length: 1, time: -1 }), 1),
  kelvin: unit("K", dimension({ temperature: 1 }), 1),
  celsius: unit("degC", dimension({ temperature: 1 }), 1, 273.15),
  kilogram: unit("kg", dimension({ mass: 1 }), 1),
  perKilometre: unit("1/km", dimension({ length: -1 }), 1 / 1000),
  perMetre: unit("1/m", dimension({ length: -1 }), 1),
  // Built area per unit of land area: dimensionless, but the two scales differ.
  squareMetrePerSquareKilometre: unit("m^2/km^2", DIMENSIONLESS, 1e-6),
  usd: unit("USD", dimension({ currency: 1 }), 1),
};

export function derivedUnit(symbol, left, right, operation = "*") {
  const combined = operation === "*"
    ? multiplyDimensions(left.dimension, right.dimension)
    : divideDimensions(left.dimension, right.dimension);
  const factor = operation === "*" ? left.factor * right.factor : left.factor / right.factor;
  if (left.offset !== 0 || right.offset !== 0) {
    throw new Error("derivedUnit: offset units cannot be combined");
  }
  return unit(symbol, combined, factor);
}
