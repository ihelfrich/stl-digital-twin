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
import { ground, groundMultiple, multiRelation, relation } from "../src/quant/relation.mjs";
import {
  blockBootstrap, blockCrossValidate, designMatrix, fitLinear, randomCrossValidate, spatialBlocks,
  varianceInflation,
} from "../src/quant/regression.mjs";

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

// --- multiple regression ------------------------------------------------
section("multiple regression");
{
  const n = 500;
  const x1 = Array.from({ length: n }, () => gaussian());
  const x2 = Array.from({ length: n }, () => gaussian());
  const y = x1.map((value, index) => 1.5 + 2 * value - 0.7 * x2[index] + 0.5 * gaussian());
  const fit = fitLinear(designMatrix([x1, x2]), y);
  close("intercept recovered", fit.beta[0], 1.5, 0.08);
  close("first coefficient recovered", fit.beta[1], 2, 0.08);
  close("second coefficient recovered", fit.beta[2], -0.7, 0.08);
  check("standard errors are positive and small", fit.standardErrors.every((se) => se > 0 && se < 0.1));
  check("adjusted R2 is below R2", fit.adjustedR2 < fit.r2);
  throws("refuses more columns than rows",
    () => fitLinear([[1, 2, 3], [1, 2, 3]], [1, 2]), "more rows");

  check("variance inflation is ~1 for orthogonal predictors",
    varianceInflation(designMatrix([x1, x2])).every((value) => value < 1.2));
  const duplicate = x1.map((value) => value + 0.01 * gaussian());
  check("variance inflation explodes for a near-duplicate predictor",
    varianceInflation(designMatrix([x1, duplicate])).every((value) => value > 50));

  // A confounder that drives both sides: the bivariate coefficient is
  // spurious and controlling for the confounder collapses it.
  const confounder = Array.from({ length: n }, () => gaussian());
  const proxy = confounder.map((value) => value + 0.3 * gaussian());
  const outcome = confounder.map((value) => 3 * value + 0.3 * gaussian());
  const spurious = fitLinear(designMatrix([proxy]), outcome).beta[1];
  const controlled = fitLinear(designMatrix([proxy, confounder]), outcome).beta[1];
  check("bivariate picks up a spurious effect", Math.abs(spurious) > 2, `got ${spurious}`);
  check("controlling for the confounder collapses it", Math.abs(controlled) < 0.3, `got ${controlled}`);

  check("spatial blocks tile the plane",
    spatialBlocks([0, 100, 600], [0, 100, 0], 500).join(",") === "0:0,0:0,1:0");
}

// --- dependence ---------------------------------------------------------
section("spatial dependence");
{
  // Clustered data where both x and y carry a block-level component. The
  // independent-observations bootstrap should badly undercover; resampling by
  // block should be close to nominal. This is the check that licenses using
  // block intervals for everything spatial.
  const TRUTH = 1;
  const BLOCKS = 20;
  const PER_BLOCK = 20;
  let naiveHits = 0;
  let blockHits = 0;
  let naiveWidth = 0;
  let blockWidth = 0;
  const replications = 30;
  for (let replication = 0; replication < replications; replication += 1) {
    const draw = seededRandom(9000 + replication * 31);
    const normal = () => {
      let sum = 0;
      for (let index = 0; index < 12; index += 1) sum += draw();
      return sum - 6;
    };
    const xs = [];
    const ys = [];
    const blocks = [];
    for (let block = 0; block < BLOCKS; block += 1) {
      const blockX = 1.5 * normal();
      const blockY = 1.5 * normal();
      for (let point = 0; point < PER_BLOCK; point += 1) {
        const x = blockX + 0.6 * normal();
        xs.push(x);
        ys.push(TRUTH * x + blockY + 0.6 * normal());
        blocks.push(`b${block}`);
      }
    }
    const naive = bootstrapSlope(xs, ys, { samples: 120, seed: replication + 1 });
    if (naive.slopeLow <= TRUTH && TRUTH <= naive.slopeHigh) naiveHits += 1;
    naiveWidth += naive.slopeHigh - naive.slopeLow;
    const blocked = blockBootstrap(designMatrix([xs]), ys, blocks, { samples: 120, seed: replication + 1 });
    if (blocked.ok) {
      const [low, high] = [blocked.intervals[1].low, blocked.intervals[1].high];
      if (low <= TRUTH && TRUTH <= high) blockHits += 1;
      blockWidth += high - low;
    }
  }
  const naiveCoverage = naiveHits / replications;
  const blockCoverage = blockHits / replications;
  console.log(`  nominal 95%: naive covers ${(naiveCoverage * 100).toFixed(0)}%, `
    + `block covers ${(blockCoverage * 100).toFixed(0)}%, `
    + `block intervals ${(blockWidth / naiveWidth).toFixed(1)}x wider`);
  check("the naive bootstrap undercovers badly on clustered data",
    naiveCoverage < 0.7, `covered ${(naiveCoverage * 100).toFixed(0)}%`);
  check("the block bootstrap is near nominal coverage",
    blockCoverage >= 0.8, `covered ${(blockCoverage * 100).toFixed(0)}%`);
  check("block intervals are the wider ones", blockWidth > naiveWidth);

  // Real leakage needs a model that can pick up area-specific structure. Give
  // it one block indicator per area, which is what a neighbourhood fixed
  // effect is: splitting at random lets each area's level be learned from its
  // own other members, so the held-out points look easy. Holding out the whole
  // area removes every observation that identifies its level, which is the
  // situation the model would actually face somewhere new.
  const AREAS = 25;
  const PER_AREA = 20;
  const leakX = [];
  const leakY = [];
  const leakBlocks = [];
  const levels = [];
  for (let area = 0; area < AREAS; area += 1) {
    const level = 3 * gaussian();
    for (let point = 0; point < PER_AREA; point += 1) {
      const x = gaussian();
      leakX.push(x);
      leakY.push(level + 0.5 * x + 0.2 * gaussian());
      leakBlocks.push(`b${area}`);
      levels.push(area);
    }
  }
  const indicators = Array.from({ length: AREAS - 1 }, (_, area) =>
    levels.map((value) => (value === area ? 1 : 0)));
  const leakDesign = designMatrix([leakX, ...indicators]);
  const leaky = randomCrossValidate(leakDesign, leakY).r2;
  const honest = blockCrossValidate(leakDesign, leakY, leakBlocks).r2;
  console.log(`  area-effect model: random split scores ${leaky.toFixed(3)}, `
    + `held-out areas score ${honest.toFixed(3)}`);
  check("random k-fold scores the area-effect model highly", leaky > 0.9, `got ${leaky}`);
  check("holding out whole areas is far more pessimistic", honest < leaky - 0.3,
    `blocks ${honest.toFixed(3)} vs random ${leaky.toFixed(3)}`);
  // A held-out area leaves its indicator column empty in training, so the
  // design is rank deficient. The score has to stay a real number.
  check("a rank-deficient hold-out still yields a finite score", Number.isFinite(honest)
    && Math.abs(honest) < 100, `got ${honest}`);

  const deficient = fitLinear(
    [[1, 1, 0], [1, 2, 0], [1, 3, 0], [1, 4, 0]], [1, 2, 3, 4],
  );
  check("an all-zero column is reported as rank deficient", deficient.rankDeficient);
  check("the unidentified coefficient is zero, not enormous", deficient.beta[2] === 0);
  check("the identified coefficients are still right", Math.abs(deficient.beta[1] - 1) < 1e-9);
}

// --- the multivariate gate ----------------------------------------------
section("multivariate grounding gate");
{
  const areas = [];
  const distances = [];
  const storeys = [];
  const blocks = [];
  for (let block = 0; block < 40; block += 1) {
    const blockArea = 0.8 * gaussian();
    const blockLevel = 1.2 * gaussian();
    for (let point = 0; point < 25; point += 1) {
      const area = Math.exp(4 + blockArea + 0.5 * gaussian());
      const distance = Math.abs(2000 + 1500 * blockArea + 300 * gaussian());
      areas.push(area);
      distances.push(distance);
      blocks.push(`b${block}`);
      storeys.push(Math.exp(0.4 * Math.log(area) - 0.0002 * distance + blockLevel + 0.3 * gaussian()));
    }
  }
  const make = (name, unit, values) =>
    derived({ name, symbol: name, unit, source: "synthetic", method: "simulated", values });
  const spec = multiRelation({
    id: "multi", statement: "synthetic",
    response: make("storeys", UNITS.one, storeys),
    responseReference: quantity(1, UNITS.one),
    terms: [
      {
        label: "log area", observable: make("area", UNITS.squareMetre, areas),
        transform: "log", reference: quantity(1, UNITS.squareMetre),
      },
      { label: "distance", observable: make("distance", UNITS.metre, distances), transform: "identity" },
    ],
    blocks,
    blockSizeLabel: "synthetic",
  });
  const result = groundMultiple(spec, { bootstrapSamples: 300 });
  check("planted log-area coefficient is inside its block interval",
    result.coefficients[0].blockInterval[0] < 0.4 && 0.4 < result.coefficients[0].blockInterval[1],
    JSON.stringify(result.coefficients[0].blockInterval));
  check("planted distance coefficient is inside its block interval",
    result.coefficients[1].blockInterval[0] < -0.0002 && -0.0002 < result.coefficients[1].blockInterval[1],
    JSON.stringify(result.coefficients[1].blockInterval));
  check("a logged term against a logged response gives a dimensionless coefficient",
    result.coefficients[0].unit === "dimensionless");
  check("an unlogged length term gives an inverse-length coefficient",
    result.coefficients[1].unit === "length^-1", result.coefficients[1].unit);
  check("the dependence penalty is reported and exceeds one",
    result.dependencePenalty.widthRatio > 1, `${result.dependencePenalty.widthRatio}`);
  check("failing to transfer does not by itself reject the result",
    result.verdict !== "rejected", `${result.verdict} / ${result.failedChecks}`);

  // A term with no effect must not come back grounded.
  const noise = make("noise", UNITS.one, areas.map(() => 0.5 + gaussian()));
  const nullResult = groundMultiple(multiRelation({
    id: "multi-null", statement: "negative control",
    response: make("storeys", UNITS.one, storeys),
    responseReference: quantity(1, UNITS.one),
    terms: [{ label: "noise", observable: noise, transform: "identity" }],
    blocks,
  }), { bootstrapSamples: 300 });
  check("a null focal term is rejected", nullResult.verdict === "rejected",
    `${nullResult.verdict} / ${nullResult.failedChecks}`);
  check("the null term's interval spans zero",
    nullResult.coefficients[0].blockInterval[0] < 0 && nullResult.coefficients[0].blockInterval[1] > 0);

  // Two copies of the same predictor are not separately identified.
  const duplicated = groundMultiple(multiRelation({
    id: "multi-collinear", statement: "collinear",
    response: make("storeys", UNITS.one, storeys),
    responseReference: quantity(1, UNITS.one),
    terms: [
      { label: "log area", observable: make("area", UNITS.squareMetre, areas), transform: "log", reference: quantity(1, UNITS.squareMetre) },
      { label: "log area again", observable: make("area2", UNITS.squareMetre, areas.map((a) => a * 1.000001)), transform: "log", reference: quantity(1, UNITS.squareMetre) },
      // Exactly proportional, so in logs it differs from the first term by a
      // constant and is absorbed by the intercept: an exact linear dependence.
    ],
    blocks,
  }), { bootstrapSamples: 200 });
  check("collinear terms are caught", duplicated.failedChecks.includes("collinearity"),
    JSON.stringify(duplicated.failedChecks));
  check("collinearity is fatal", duplicated.verdict === "rejected");

  throws("an unpaired term is refused",
    () => multiRelation({
      id: "x", statement: "x",
      response: make("storeys", UNITS.one, storeys),
      terms: [{ label: "short", observable: make("short", UNITS.one, [1, 2, 3]), transform: "identity" }],
    }), "not paired");
  throws("a logged term without a reference scale is refused",
    () => groundMultiple(multiRelation({
      id: "x", statement: "x",
      response: make("storeys", UNITS.one, storeys),
      responseReference: quantity(1, UNITS.one),
      terms: [{ label: "log area", observable: make("area", UNITS.squareMetre, areas), transform: "log" }],
      blocks,
    })), "reference scale");
}

console.log(`\n${passed} checks passed, ${failures.length} failed`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
