// Estimation with the checks that decide whether an estimate means anything:
// out-of-sample skill, a bootstrap interval, a permutation null, and residual
// diagnostics. Plus a maximum-likelihood tail estimator, because fitting a
// straight line through a log-log rank plot is the single most common way to
// get a confident and wrong power law.

export function seededRandom(seed = 20260915) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Ordinary least squares, y = intercept + slope * x. */
export function ols(x, y) {
  const n = x.length;
  if (n !== y.length) throw new Error("ols: length mismatch");
  if (n < 3) throw new Error("ols: need at least three points");
  const meanX = x.reduce((sum, value) => sum + value, 0) / n;
  const meanY = y.reduce((sum, value) => sum + value, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let index = 0; index < n; index += 1) {
    sxy += (x[index] - meanX) * (y[index] - meanY);
    sxx += (x[index] - meanX) ** 2;
  }
  if (sxx === 0) throw new Error("ols: x has no variation");
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const residuals = y.map((value, index) => value - intercept - slope * x[index]);
  const sse = residuals.reduce((sum, value) => sum + value ** 2, 0);
  const sst = y.reduce((sum, value) => sum + (value - meanY) ** 2, 0);
  const sigmaSquared = sse / (n - 2);
  return {
    intercept,
    slope,
    r2: sst === 0 ? 0 : 1 - sse / sst,
    n,
    residuals,
    slopeStandardError: Math.sqrt(sigmaSquared / sxx),
    interceptStandardError: Math.sqrt(sigmaSquared * (1 / n + meanX ** 2 / sxx)),
    residualSd: Math.sqrt(sigmaSquared),
  };
}

function shuffled(array, random) {
  const copy = [...array];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return Number.NaN;
  const position = p * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
}

/** Percentile bootstrap over resampled pairs. */
export function bootstrapSlope(x, y, { samples = 2000, seed = 20260915, level = 0.95 } = {}) {
  const random = seededRandom(seed);
  const n = x.length;
  const slopes = [];
  const intercepts = [];
  for (let draw = 0; draw < samples; draw += 1) {
    const bx = new Array(n);
    const by = new Array(n);
    for (let index = 0; index < n; index += 1) {
      const pick = Math.floor(random() * n);
      bx[index] = x[pick];
      by[index] = y[pick];
    }
    try {
      const fit = ols(bx, by);
      slopes.push(fit.slope);
      intercepts.push(fit.intercept);
    } catch {
      // A degenerate resample contributes nothing; it is not an error.
    }
  }
  slopes.sort((a, b) => a - b);
  intercepts.sort((a, b) => a - b);
  const tail = (1 - level) / 2;
  return {
    samples: slopes.length,
    level,
    slopeLow: percentile(slopes, tail),
    slopeHigh: percentile(slopes, 1 - tail),
    interceptLow: percentile(intercepts, tail),
    interceptHigh: percentile(intercepts, 1 - tail),
  };
}

/**
 * k-fold out-of-sample R^2. In-sample R^2 measures how well a line was drawn
 * through points it already saw; this measures whether it predicts.
 */
export function crossValidate(x, y, { folds = 5, seed = 20260915 } = {}) {
  const n = x.length;
  if (n < folds * 2) return { r2: Number.NaN, folds: 0, note: "too few points to cross-validate" };
  const random = seededRandom(seed);
  const order = shuffled(Array.from({ length: n }, (_, index) => index), random);
  const meanY = y.reduce((sum, value) => sum + value, 0) / n;
  let sse = 0;
  let sst = 0;
  let used = 0;
  for (let fold = 0; fold < folds; fold += 1) {
    const test = order.filter((_, position) => position % folds === fold);
    const train = order.filter((_, position) => position % folds !== fold);
    if (train.length < 3 || test.length === 0) continue;
    let fit;
    try {
      fit = ols(train.map((index) => x[index]), train.map((index) => y[index]));
    } catch {
      continue;
    }
    for (const index of test) {
      const predicted = fit.intercept + fit.slope * x[index];
      sse += (y[index] - predicted) ** 2;
      sst += (y[index] - meanY) ** 2;
      used += 1;
    }
  }
  return { r2: sst === 0 ? Number.NaN : 1 - sse / sst, folds, predictions: used };
}

/**
 * Permutation null: break the pairing and refit many times. If the observed
 * fit is not clearly better than fits to shuffled data, there is nothing here.
 */
export function permutationTest(x, y, { samples = 1000, seed = 20260915 } = {}) {
  const observed = ols(x, y).r2;
  const random = seededRandom(seed + 1);
  let atLeastAsGood = 0;
  let valid = 0;
  for (let draw = 0; draw < samples; draw += 1) {
    try {
      if (ols(x, shuffled(y, random)).r2 >= observed) atLeastAsGood += 1;
      valid += 1;
    } catch {
      // skip
    }
  }
  return {
    observedR2: observed,
    samples: valid,
    // Add-one correction, so a p-value is never reported as exactly zero.
    pValue: (1 + atLeastAsGood) / (valid + 1),
  };
}

/** Lag-1 residual autocorrelation, in the order the points were supplied. */
export function residualAutocorrelation(residuals) {
  const n = residuals.length;
  if (n < 3) return Number.NaN;
  const mean = residuals.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index += 1) {
    denominator += (residuals[index] - mean) ** 2;
    if (index > 0) numerator += (residuals[index] - mean) * (residuals[index - 1] - mean);
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Maximum-likelihood power-law tail, after Clauset, Shalizi & Newman.
 *
 * Note that a passing goodness-of-fit test is weak evidence on its own: the KS
 * test has little power once x_min has been chosen to minimise KS, and it will
 * happily accept exponential data. Pair it with `compareTailModels`, which is
 * what actually discriminates.
 *
 * For a continuous power law above x_min the MLE is
 *   alpha = 1 + n / sum(ln(x_i / x_min)),
 * and x_min is chosen to minimise the Kolmogorov-Smirnov distance between the
 * empirical and fitted CDFs. The goodness-of-fit p-value is obtained by
 * refitting synthetic samples drawn from the fitted law: a *small* p rejects
 * the power law. This is the opposite convention to the permutation test above
 * and is a standard source of confusion.
 */
export function powerLawTail(data, { seed = 20260915, syntheticSamples = 200 } = {}) {
  const sorted = data.filter((value) => value > 0).sort((a, b) => a - b);
  if (sorted.length < 50) return { ok: false, reason: "need at least 50 positive values" };

  const fitAbove = (xmin) => {
    const tail = sorted.filter((value) => value >= xmin);
    if (tail.length < 50) return null;
    const sum = tail.reduce((accumulator, value) => accumulator + Math.log(value / xmin), 0);
    if (sum <= 0) return null;
    const alpha = 1 + tail.length / sum;
    let ks = 0;
    for (let index = 0; index < tail.length; index += 1) {
      const empirical = (index + 1) / tail.length;
      const theoretical = 1 - (tail[index] / xmin) ** (1 - alpha);
      ks = Math.max(ks, Math.abs(empirical - theoretical), Math.abs(index / tail.length - theoretical));
    }
    return { xmin, alpha, ks, n: tail.length };
  };

  // Candidate x_min values, thinned so this stays linear-ish on large samples.
  const unique = [...new Set(sorted)];
  const stride = Math.max(1, Math.floor(unique.length / 120));
  let best = null;
  for (let index = 0; index < unique.length; index += stride) {
    const candidate = fitAbove(unique[index]);
    if (candidate && (!best || candidate.ks < best.ks)) best = candidate;
  }
  if (!best) return { ok: false, reason: "no admissible x_min" };

  // Goodness of fit: how often does data genuinely from this law look worse?
  const random = seededRandom(seed + 2);
  let worse = 0;
  for (let draw = 0; draw < syntheticSamples; draw += 1) {
    const synthetic = Array.from({ length: best.n }, () =>
      best.xmin * (1 - random()) ** (-1 / (best.alpha - 1))).sort((a, b) => a - b);
    const sum = synthetic.reduce((accumulator, value) => accumulator + Math.log(value / best.xmin), 0);
    const alpha = 1 + synthetic.length / sum;
    let ks = 0;
    for (let index = 0; index < synthetic.length; index += 1) {
      const empirical = (index + 1) / synthetic.length;
      const theoretical = 1 - (synthetic[index] / best.xmin) ** (1 - alpha);
      ks = Math.max(ks, Math.abs(empirical - theoretical));
    }
    if (ks >= best.ks) worse += 1;
  }
  return {
    ok: true,
    alpha: best.alpha,
    xmin: best.xmin,
    tailSize: best.n,
    ks: best.ks,
    standardError: (best.alpha - 1) / Math.sqrt(best.n),
    gofPValue: worse / syntheticSamples,
    // CSN's own rule of thumb.
    powerLawPlausible: worse / syntheticSamples > 0.1,
  };
}


/**
 * Two-sided normal p-value, P(|Z| > |z|), via Abramowitz & Stegun 7.1.26.
 * This is erfc(|z|/sqrt(2)), which is already two-sided - doubling it again is
 * an easy mistake and yields p-values above 1.
 */
function twoSidedNormalP(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t
    + 0.254829592) * t * Math.exp(-x * x);
  return 1 - erf;
}

/**
 * Vuong likelihood-ratio test of a power law against an exponential, on the
 * same tail. This is the test that matters: "the data are consistent with a
 * power law" is close to meaningless unless the obvious alternatives have been
 * ruled out, and heavy-tailed-looking data is very often exponential or
 * lognormal instead.
 *
 * Returns the normalised log-likelihood ratio. Positive favours the power law,
 * negative favours the exponential, and the p-value says whether the sign is
 * distinguishable from zero. Both models have one free parameter, so no
 * complexity correction is needed.
 */
export function compareTailModels(data, xmin) {
  const tail = data.filter((value) => value >= xmin).sort((a, b) => a - b);
  const n = tail.length;
  if (n < 50) return { ok: false, reason: "tail too small to compare" };

  const logSum = tail.reduce((sum, value) => sum + Math.log(value / xmin), 0);
  const alpha = 1 + n / logSum;
  const mean = tail.reduce((sum, value) => sum + value, 0) / n;
  if (mean <= xmin) return { ok: false, reason: "degenerate tail" };
  const lambda = 1 / (mean - xmin);

  const differences = tail.map((value) => {
    const powerLaw = Math.log(alpha - 1) - Math.log(xmin) - alpha * Math.log(value / xmin);
    const exponential = Math.log(lambda) - lambda * (value - xmin);
    return powerLaw - exponential;
  });
  const ratio = differences.reduce((sum, value) => sum + value, 0);
  const meanDifference = ratio / n;
  const variance = differences.reduce((sum, value) => sum + (value - meanDifference) ** 2, 0) / n;
  if (variance <= 0) return { ok: false, reason: "zero variance in the likelihood ratio" };
  const statistic = ratio / (Math.sqrt(n) * Math.sqrt(variance));

  return {
    ok: true,
    alpha,
    lambda,
    tailSize: n,
    logLikelihoodRatio: ratio,
    statistic,
    pValue: twoSidedNormalP(statistic),
    favours: Math.abs(statistic) < 1.96 ? "neither" : (statistic > 0 ? "power law" : "exponential"),
    // With a short tail the comparison simply has no power, which is a
    // different statement from the two models fitting equally well.
    underpowered: n < 500,
  };
}
