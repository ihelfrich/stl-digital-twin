// Tests for the grounded-quantity layer. Run with: npm run test:quant
//
// Two things are being checked. That the estimators recover parameters we
// planted, and - more importantly - that the grounding gate rejects things it
// should. A gate that passes everything is decoration.

import {
  BASE_DIMENSIONS, dimension, dimensionsEqual, divideDimensions, formatDimension,
  isDimensionless, multiplyDimensions, powerDimension, UNITS,
} from "../src/quant/dimension.mjs";
import {
  add, convert, divide, logRatio, multiply, power, quantity, subtract, toSI, valueIn,
} from "../src/quant/quantity.mjs";
import { derived, extract, measuredOnly, siValues, summarize } from "../src/quant/observable.mjs";
import {
  bootstrapSlope, compareTailModels, crossValidate, ols, permutationTest, powerLawTail,
  residualAutocorrelation, seededRandom,
} from "../src/quant/estimate.mjs";
import { ground, relation } from "../src/quant/relation.mjs";

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

function close(name, actual, expected, tolerance = 1e-6) {
  check(name, Math.abs(actual - expected) < tolerance, `got ${actual}, expected ${expected}`);
}

function throws(name, fn, fragment) {
  try {
    fn();
    failures.push(`${name}: expected a throw, got none`);
  } catch (error) {
    if (fragment && !String(error.message).includes(fragment)) {
      failures.push(`${name}: message "${error.message}" lacks "${fragment}"`);
    } else {
      passed += 1;
    }
  }
}

function section(title) { console.log(`\n${title}`); }

const random = seededRandom(4242);
const gaussian = () => {
  let sum = 0;
  for (let index = 0; index < 12; index += 1) sum += random();
  return sum - 6;
};

// --- dimensions --------------------------------------------------------
section("dimensions and units");
{
  const length = dimension({ length: 1 });
  const time = dimension({ time: 1 });
  const speed = divideDimensions(length, time);
  check("speed is length/time", speed.length === 1 && speed.time === -1);
  check("area is length^2", multiplyDimensions(length, length).length === 2);
  check("inverse length", powerDimension(length, -1).length === -1);
  check("dimensionless detection", isDimensionless(divideDimensions(length, length)));
  check("formatting", formatDimension(speed) === "length*time^-1", formatDimension(speed));
  check("every base dimension present", BASE_DIMENSIONS.every((name) => name in length));
  check("currency is a base dimension", BASE_DIMENSIONS.includes("currency"));
  throws("unknown base dimension is refused", () => dimension({ vibes: 1 }), "unknown base dimension");

  close("1 km is 1000 m", valueIn(quantity(1, UNITS.kilometre), UNITS.metre), 1000);
  close("round trip km->m->km", valueIn(convert(quantity(2.5, UNITS.kilometre), UNITS.metre), UNITS.kilometre), 2.5);
  close("feet convert", valueIn(quantity(10, UNITS.foot), UNITS.metre), 3.048, 1e-9);
  close("20 degC is 293.15 K", valueIn(quantity(20, UNITS.celsius), UNITS.kelvin), 293.15, 1e-9);
  close("100 km over 2 h", valueIn(divide(quantity(100, UNITS.kilometre), quantity(2, UNITS.hour)),
    UNITS.metrePerSecond), 13.888888888, 1e-6);
  close("addition converts", add(quantity(30, UNITS.metre), quantity(0.1, UNITS.kilometre)).value, 130);
  close("subtraction", subtract(quantity(1, UNITS.kilometre), quantity(100, UNITS.metre)).value, 0.9, 1e-9);
  close("area via multiply", toSI(multiply(quantity(30, UNITS.metre), quantity(0.1, UNITS.kilometre))), 3000);
  close("power", toSI(power(quantity(3, UNITS.metre), 2)), 9);

  throws("cannot add length to time",
    () => add(quantity(1, UNITS.metre), quantity(1, UNITS.second)), "cannot add");
  throws("cannot convert across dimensions",
    () => convert(quantity(1, UNITS.metre), UNITS.second), "is not");
  throws("offset units cannot be scaled",
    () => multiply(quantity(20, UNITS.celsius), quantity(2, UNITS.one)), "offset");

  // The check this layer exists for.
  throws("cannot take the log of a dimensioned quantity",
    () => logRatio(quantity(30, UNITS.metre), quantity(1, UNITS.second)), "dimensionless");
  close("log of a ratio", logRatio(quantity(30, UNITS.metre), quantity(1, UNITS.metre)).value, Math.log(30));
  close("reference scale changes the intercept, as it must",
    logRatio(quantity(30, UNITS.metre), quantity(1, UNITS.kilometre)).value, Math.log(0.03), 1e-9);

  // Uncertainty propagation: relative uncertainties add in quadrature.
  const productUncertainty = multiply(quantity(10, UNITS.metre, 1), quantity(20, UNITS.metre, 2));
  close("relative uncertainty combines in quadrature",
    productUncertainty.uncertainty / productUncertainty.value, Math.hypot(0.1, 0.1), 1e-9);
}

// --- observables -------------------------------------------------------
section("observables and provenance");
{
  const records = Array.from({ length: 100 }, (_, index) => ({ id: index, h: index < 30 ? index + 1 : null }));
  const observable = extract({
    name: "height", symbol: "h", unit: UNITS.metre, source: "test", field: "h",
    method: "tagged where present, otherwise a default",
    records,
    read: (row) => (row.h === null ? { value: 8, measured: false } : { value: row.h, measured: true }),
  });
  close("coverage reflects what was measured", observable.provenance.coverage, 0.3, 1e-12);
  check("imputed values are counted", observable.provenance.imputed === 70);
  check("all records used", observable.provenance.used === 100);

  const restricted = measuredOnly(observable);
  check("restricting to measured drops the rest", restricted.points.length === 30);
  close("restricted coverage is one", restricted.provenance.coverage, 1);

  const skipping = extract({
    name: "height", symbol: "h", unit: UNITS.metre, source: "test", records,
    read: (row) => (row.h === null ? null : { value: row.h, measured: true }),
  });
  check("skipped records are reported", skipping.provenance.skipped === 70);

  const kilometres = derived({
    name: "d", symbol: "d", unit: UNITS.kilometre, source: "test", method: "t", values: [1, 2, 3],
  });
  check("SI values convert", siValues(kilometres).join(",") === "1000,2000,3000");
  close("summary median", summarize(kilometres).median, 2);
}

// --- estimators --------------------------------------------------------
section("estimators");
{
  const x = Array.from({ length: 200 }, (_, index) => index / 20);
  const y = x.map((value) => 2.5 - 0.8 * value + 0.3 * gaussian());
  const fit = ols(x, y);
  close("slope recovered", fit.slope, -0.8, 0.02);
  close("intercept recovered", fit.intercept, 2.5, 0.06);
  check("standard error is sane", fit.slopeStandardError > 0 && fit.slopeStandardError < 0.05);

  const boot = bootstrapSlope(x, y, { samples: 600 });
  check("bootstrap interval contains the truth", boot.slopeLow < -0.8 && boot.slopeHigh > -0.8,
    `[${boot.slopeLow}, ${boot.slopeHigh}]`);
  check("bootstrap interval is ordered", boot.slopeLow < boot.slopeHigh);

  check("cross-validation sees the signal", crossValidate(x, y).r2 > 0.9);
  check("permutation rejects the null", permutationTest(x, y, { samples: 300 }).pValue < 0.01);

  const noise = x.map(() => gaussian());
  check("cross-validation does not see noise", crossValidate(x, noise).r2 < 0.05);
  check("permutation does not reject under the null",
    permutationTest(x, noise, { samples: 300 }).pValue > 0.05);

  // Under the null the permutation p-value should be roughly uniform, so an
  // average near 0.5 across independent noise draws.
  let total = 0;
  const draws = 12;
  for (let draw = 0; draw < draws; draw += 1) {
    const yn = x.map(() => gaussian());
    total += permutationTest(x, yn, { samples: 200, seed: 1000 + draw }).pValue;
  }
  check("permutation p is calibrated under the null", Math.abs(total / draws - 0.5) < 0.2,
    `mean p = ${(total / draws).toFixed(3)}`);

  // Autocorrelation detector: an ordered random walk has strongly correlated
  // residuals, independent noise does not.
  let walk = 0;
  const walked = x.map(() => { walk += gaussian(); return walk; });
  check("autocorrelation is detected in a random walk",
    residualAutocorrelation(ols(x, walked).residuals) > 0.5);
  check("autocorrelation is absent in independent noise",
    Math.abs(residualAutocorrelation(ols(x, noise).residuals)) < 0.3);
}

// --- heavy tails -------------------------------------------------------
section("tail estimation");
{
  const powerLawData = Array.from({ length: 3000 }, () => 10 * (1 - random()) ** (-1 / 1.5));
  const fitted = powerLawTail(powerLawData, { syntheticSamples: 60 });
  check("power-law fit succeeds", fitted.ok);
  close("tail exponent recovered", fitted.alpha, 2.5, 0.12);
  close("x_min recovered", fitted.xmin, 10, 1.5);
  check("goodness of fit does not reject a genuine power law", fitted.gofPValue > 0.1);

  const comparison = compareTailModels(powerLawData, fitted.xmin);
  check("likelihood ratio favours the power law", comparison.favours === "power law",
    `favours ${comparison.favours}`);
  check("p-value is a probability", comparison.pValue >= 0 && comparison.pValue <= 1,
    `p = ${comparison.pValue}`);

  // Exponential data must not come back as a power law. The KS test alone is
  // too weak to catch this, which is exactly why the comparison exists.
  const exponentialData = Array.from({ length: 3000 }, () => -10 * Math.log(1 - random()));
  const wrongly = compareTailModels(exponentialData, 20);
  check("exponential data is not called a power law", wrongly.favours !== "power law",
    `favours ${wrongly.favours}`);
  check("short tails are flagged as underpowered",
    compareTailModels(powerLawData, fitted.xmin).underpowered === (fitted.tailSize < 500));
}

// --- the grounding gate ------------------------------------------------
section("grounding gate");
{
  const radii = Array.from({ length: 40 }, (_, index) => (index + 1) * 250);
  const makeDensity = (noiseScale) => derived({
    name: "density", symbol: "D", unit: UNITS.one, source: "synthetic", method: "simulated",
    values: radii.map((r) => Math.exp(1.2 - 0.00025 * r + noiseScale * gaussian())),
  });
  const radiusObservable = derived({
    name: "radius", symbol: "r", unit: UNITS.metre, source: "synthetic", method: "simulated",
    values: radii,
  });
  const build = (response, extra = {}) => relation({
    id: "t", statement: "t", form: "log-linear",
    response, predictor: radiusObservable,
    responseReference: quantity(1, UNITS.one), nullSlope: 0, ordered: true, ...extra,
  });

  const strong = ground(build(makeDensity(0.05)), { bootstrapSamples: 400, permutationSamples: 300 });
  check("a planted relationship is grounded", strong.verdict === "grounded",
    `${strong.verdict}: ${strong.failedChecks}`);
  close("planted slope recovered", strong.estimate.slope, -0.00025, 2e-5);
  check("slope carries inverse length", strong.estimate.slopeUnit === "length^-1");
  check("interval contains the planted slope",
    strong.estimate.slopeCI[0] < -0.00025 && strong.estimate.slopeCI[1] > -0.00025);

  // Pure noise must be rejected. This is the check that licenses the others.
  const pureNoise = derived({
    name: "density", symbol: "D", unit: UNITS.one, source: "synthetic", method: "noise",
    values: radii.map(() => Math.exp(gaussian())),
  });
  const rejected = ground(build(pureNoise), { bootstrapSamples: 400, permutationSamples: 300 });
  check("pure noise is rejected", rejected.verdict === "rejected", `got ${rejected.verdict}`);
  check("noise fails the null check", rejected.failedChecks.includes("null-rejected"));

  // A real but weak effect - decisively non-zero, but explaining little - must
  // land between the two verdicts. Large n makes the verdict stable; at n = 40
  // the boundary is genuinely fuzzy and a single draw can fall either side.
  const weakN = 2000;
  const weakX = Array.from({ length: weakN }, () => 5 * gaussian());
  const weakPredictor = derived({
    name: "x", symbol: "x", unit: UNITS.metre, source: "synthetic", method: "simulated",
    values: weakX.map((value) => value + 40),
  });
  const weakResponse = derived({
    name: "y", symbol: "y", unit: UNITS.one, source: "synthetic", method: "simulated",
    values: weakX.map((value) => Math.exp(0.2 * value + 2.4 * gaussian())),
  });
  const weak = ground(relation({
    id: "weak", statement: "small but real", form: "log-linear",
    response: weakResponse, predictor: weakPredictor,
    responseReference: quantity(1, UNITS.one), nullSlope: 0,
  }), { bootstrapSamples: 400, permutationSamples: 300 });
  check("a weak effect is qualified, not grounded", weak.verdict === "qualified",
    `got ${weak.verdict} (oos R2 ${weak.estimate.outOfSampleR2.toFixed(3)}, failed ${weak.failedChecks})`);
  check("a weak effect still rejects the null", !weak.failedChecks.includes("null-rejected"));
  check("a weak effect is flagged for low skill", weak.failedChecks.includes("out-of-sample-skill"));

  // Imputed data is caught even when the relationship is perfect, because the
  // relationship is then a property of the imputation rule.
  const imputed = derived({
    name: "density", symbol: "D", unit: UNITS.one, source: "synthetic", method: "made up",
    values: radii.map((r) => Math.exp(1.2 - 0.00025 * r)), measured: false,
  });
  const lowCoverage = ground(build(imputed), { bootstrapSamples: 200, permutationSamples: 200 });
  check("imputed values fail the provenance check",
    lowCoverage.failedChecks.includes("provenance-coverage"), JSON.stringify(lowCoverage.failedChecks));
  check("a perfectly fitting imputation is not grounded", lowCoverage.verdict !== "grounded");

  // Structural errors are refused before any fitting happens.
  throws("logging without a reference scale is refused",
    () => ground(relation({
      id: "t", statement: "t", form: "log-linear",
      response: makeDensity(0.05), predictor: radiusObservable, nullSlope: 0,
    })), "reference scale");
  throws("unpaired observables are refused",
    () => relation({
      id: "t", statement: "t", form: "linear",
      response: makeDensity(0.05),
      predictor: derived({ name: "x", symbol: "x", unit: UNITS.metre, source: "s", method: "m", values: [1, 2] }),
    }), "not paired");
  throws("an unknown form is refused",
    () => relation({ id: "t", statement: "t", form: "quadratic", response: makeDensity(0.05), predictor: radiusObservable }),
    "unknown form");

  // Reference comparisons report but never gate.
  const withComparison = ground(build(makeDensity(0.01), {
    comparisons: [{ label: "planted", value: -0.00025 }, { label: "wrong", value: 0.01 }],
  }), { bootstrapSamples: 400, permutationSamples: 300 });
  check("a correct reference value lands inside the interval",
    withComparison.comparisons[0].insideInterval);
  check("a wrong reference value lands outside", !withComparison.comparisons[1].insideInterval);
  check("comparisons do not change the verdict", withComparison.verdict === "grounded");
}

console.log(`\n${passed} checks passed, ${failures.length} failed`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
