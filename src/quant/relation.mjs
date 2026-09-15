// A relation is a quantitative claim about two measured things, together with
// everything needed to decide whether to believe it.
//
// Declaring a relation means committing in advance to its functional form, the
// dimension its coefficient must carry, and the value of that coefficient that
// would mean "no relationship". Then `ground` runs the checks and returns a
// verdict. The checks are deliberately ones that can fail, and the test suite
// includes a negative control confirming they do - a gate that passes
// everything grounds nothing.

import { formatDimension, divideDimensions, powerDimension, DIMENSIONLESS, UNITS } from "./dimension.mjs";
import { quantity, toSI, divide, requireDimensionless } from "./quantity.mjs";
import { siValues } from "./observable.mjs";
import {
  bootstrapSlope, crossValidate, ols, permutationTest, residualAutocorrelation,
} from "./estimate.mjs";

export const DEFAULT_THRESHOLDS = Object.freeze({
  minimumSampleSize: 20,
  minimumCoverage: 0.95,
  minimumOutOfSampleR2: 0.25,
  maximumNullPValue: 0.01,
  maximumResidualAutocorrelation: 0.5,
});

const FORMS = {
  // y = a + b*x, in the observables' own SI units.
  linear: {
    slopeDimension: (response, predictor) => divideDimensions(response, predictor),
    transform: (y, x) => ({ y, x }),
  },
  // log(y/y0) = a + b*x   ->  exponential decay or growth in x
  "log-linear": {
    slopeDimension: (_response, predictor) => powerDimension(predictor, -1),
    transform: (y, x) => ({ y: y.map(Math.log), x }),
  },
  // log(y/y0) = a + b*log(x/x0)  ->  power law, b dimensionless
  "log-log": {
    slopeDimension: () => DIMENSIONLESS,
    transform: (y, x) => ({ y: y.map(Math.log), x: x.map(Math.log) }),
  },
};

/**
 * Turn an observable into the numbers the fit will see, dividing by the
 * declared reference scale where the form takes a logarithm. The division is
 * what makes the log argument dimensionless, and it is required rather than
 * assumed: without it the reference scale is still there, just hidden inside
 * the intercept where nobody checks its units.
 */
function prepare(observable, reference, needsRatio, role) {
  const raw = siValues(observable);
  if (!needsRatio) return raw;
  if (!reference) {
    throw new Error(
      `relation: ${role} is logged, so it needs an explicit reference scale of dimension `
      + `${formatDimension(observable.unit.dimension)}`,
    );
  }
  const ratio = divide(quantity(1, observable.unit), reference);
  requireDimensionless(ratio, `relation ${role} reference`);
  const referenceSI = toSI(reference);
  if (!(referenceSI > 0)) throw new Error(`relation: ${role} reference must be positive`);
  return raw.map((value) => value / referenceSI);
}

export function relation({
  id,
  statement,
  form,
  response,
  predictor,
  responseReference = null,
  predictorReference = null,
  nullSlope = 0,
  note = null,
  ordered = false,
  comparisons = [],
}) {
  if (!FORMS[form]) throw new Error(`relation: unknown form "${form}"`);
  if (response.points.length !== predictor.points.length) {
    throw new Error(
      `relation ${id}: observables are not paired `
      + `(${response.points.length} vs ${predictor.points.length})`,
    );
  }
  return {
    id, statement, form, response, predictor, responseReference, predictorReference,
    nullSlope, note, ordered, comparisons,
  };
}

export function ground(spec, options = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) };
  const shape = FORMS[spec.form];
  const logsResponse = spec.form !== "linear";
  const logsPredictor = spec.form === "log-log";

  const rawY = prepare(spec.response, spec.responseReference, logsResponse, "response");
  const rawX = prepare(spec.predictor, spec.predictorReference, logsPredictor, "predictor");

  // Logs need positive arguments; dropping non-positive pairs is a real choice
  // and is reported rather than done quietly.
  const kept = [];
  for (let index = 0; index < rawY.length; index += 1) {
    const yOk = !logsResponse || rawY[index] > 0;
    const xOk = !logsPredictor || rawX[index] > 0;
    if (yOk && xOk && Number.isFinite(rawY[index]) && Number.isFinite(rawX[index])) kept.push(index);
  }
  const dropped = rawY.length - kept.length;
  const { y, x } = shape.transform(kept.map((i) => rawY[i]), kept.map((i) => rawX[i]));

  const checks = [];
  const record = (name, passed, detail) => checks.push({ name, passed, detail });

  if (x.length < 3) {
    return {
      id: spec.id,
      statement: spec.statement,
      verdict: "rejected",
      reason: "not enough usable pairs",
      checks: [{ name: "sample-size", passed: false, detail: `${x.length} usable pairs` }],
    };
  }

  const fit = ols(x, y);
  const boot = bootstrapSlope(x, y, { samples: options.bootstrapSamples ?? 2000, seed: options.seed });
  const cv = crossValidate(x, y, { folds: options.folds ?? 5, seed: options.seed });
  const permutation = permutationTest(x, y, {
    samples: options.permutationSamples ?? 1000,
    seed: options.seed,
  });
  const autocorrelation = residualAutocorrelation(fit.residuals);

  // 1. Dimensions. The slope's dimension follows from the form and the two
  //    observables; there is nothing to fit before this has to be right.
  const slopeDimension = shape.slopeDimension(
    spec.response.unit.dimension,
    spec.predictor.unit.dimension,
  );
  record("dimensional-coherence", true,
    `slope carries ${formatDimension(slopeDimension)}`
    + (logsResponse ? `; response logged against ${spec.responseReference.unit.symbol}` : "")
    + (logsPredictor ? `; predictor logged against ${spec.predictorReference.unit.symbol}` : ""));

  // 2. Provenance. A relation over imputed values describes the imputation.
  const coverage = Math.min(spec.response.provenance.coverage, spec.predictor.provenance.coverage);
  record("provenance-coverage", coverage >= thresholds.minimumCoverage,
    `${(coverage * 100).toFixed(1)}% of values measured rather than imputed `
    + `(threshold ${(thresholds.minimumCoverage * 100).toFixed(0)}%)`);

  // 3. Enough data to say anything.
  record("sample-size", x.length >= thresholds.minimumSampleSize,
    `${x.length} pairs used${dropped > 0 ? `, ${dropped} dropped as non-positive` : ""}`);

  // 4. Does it predict, or only describe? A relationship can be real and still
  //    explain almost nothing, so this separates the two: predicting worse than
  //    the mean is disqualifying, predicting weakly is a caveat.
  const predictsAtAll = Number.isFinite(cv.r2) && cv.r2 > 0;
  record("out-of-sample-skill",
    Number.isFinite(cv.r2) && cv.r2 >= thresholds.minimumOutOfSampleR2,
    Number.isFinite(cv.r2)
      ? `${cv.folds}-fold R2 = ${cv.r2.toFixed(3)} (in-sample ${fit.r2.toFixed(3)})`
        + (predictsAtAll && cv.r2 < thresholds.minimumOutOfSampleR2
          ? " - predicts better than the mean, but weakly" : "")
      : "too few points to cross-validate");

  // 5. Better than shuffled data.
  record("null-rejected", permutation.pValue <= thresholds.maximumNullPValue,
    `permutation p = ${permutation.pValue.toPrecision(3)} over ${permutation.samples} shuffles`);

  // 6. The interval has to exclude "no relationship".
  const excludesNull = spec.nullSlope < boot.slopeLow || spec.nullSlope > boot.slopeHigh;
  record("interval-excludes-null", excludesNull,
    `95% CI [${boot.slopeLow.toPrecision(4)}, ${boot.slopeHigh.toPrecision(4)}] `
    + `vs null ${spec.nullSlope}`);

  // 7. Ordered data - rings, time series - can fake precision through
  //    autocorrelated residuals, which makes the CI too narrow.
  if (spec.ordered) {
    record("residual-independence",
      Math.abs(autocorrelation) <= thresholds.maximumResidualAutocorrelation,
      `lag-1 residual autocorrelation = ${autocorrelation.toFixed(3)}; `
      + "ordered data, so the interval is optimistic if this is large");
  }

  // Reference values - a constant already hard-coded somewhere, or a figure
  // from the literature - are reported against the interval but never gate it.
  // Disagreeing with a prior estimate is a finding, not a failure.
  const comparisons = (spec.comparisons ?? []).map((comparison) => ({
    label: comparison.label,
    value: comparison.value,
    insideInterval: comparison.value >= boot.slopeLow && comparison.value <= boot.slopeHigh,
  }));

  const failed = checks.filter((check) => !check.passed);
  // "Rejected" means there is no relationship to speak of. A weak but real
  // effect is "qualified" - saying an effect explains little is a finding, and
  // collapsing it into the same bucket as noise would throw that away.
  const fatal = failed.some((check) =>
    check.name === "null-rejected"
    || check.name === "interval-excludes-null"
    || check.name === "sample-size"
    || (check.name === "out-of-sample-skill" && !predictsAtAll));

  return {
    id: spec.id,
    statement: spec.statement,
    form: spec.form,
    note: spec.note,
    verdict: failed.length === 0 ? "grounded" : (fatal ? "rejected" : "qualified"),
    failedChecks: failed.map((check) => check.name),
    estimate: {
      slope: fit.slope,
      slopeUnit: formatDimension(slopeDimension),
      slopeStandardError: fit.slopeStandardError,
      slopeCI: [boot.slopeLow, boot.slopeHigh],
      intercept: fit.intercept,
      interceptCI: [boot.interceptLow, boot.interceptHigh],
      inSampleR2: fit.r2,
      outOfSampleR2: cv.r2,
      residualSd: fit.residualSd,
      lag1Autocorrelation: autocorrelation,
      n: x.length,
    },
    checks,
    comparisons,
    provenance: {
      response: { name: spec.response.name, ...spec.response.provenance },
      predictor: { name: spec.predictor.name, ...spec.predictor.provenance },
    },
  };
}

export { UNITS };
