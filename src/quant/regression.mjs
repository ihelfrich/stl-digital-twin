// Multiple regression, with uncertainty that accounts for spatial clustering.
//
// Two problems with the bivariate machinery in estimate.mjs, both of which make
// a result look better founded than it is.
//
// First, one predictor at a time cannot separate an effect from a confounder.
// Footprint area predicts storey count, but central buildings are both taller
// and on differently-shaped plots, so the bivariate coefficient is part
// geometry and part geography and there is no way to tell how much of each.
//
// Second, and worse, the bootstrap and the k-fold split in estimate.mjs both
// assume observations are independent draws. Buildings are not: neighbours
// resemble each other, so the effective sample size is far below n. That
// inflates confidence two separate ways - intervals come out too narrow, and
// out-of-sample R^2 comes out too high because a held-out building's
// neighbours sat in the training set. Resampling and splitting by spatial
// block fixes both, and the test suite includes a coverage study showing the
// naive version really does undercover.

import { seededRandom } from "./estimate.mjs";

/**
 * Householder QR of X with the same reflections applied to y.
 *
 * Solving the normal equations directly would square the condition number,
 * which matters as soon as two predictors are correlated - and controls are
 * correlated with the thing they control for, by construction.
 */
function householderQR(matrix, target) {
  const n = matrix.length;
  const p = matrix[0].length;
  const a = matrix.map((row) => [...row]);
  const b = [...target];
  for (let k = 0; k < p; k += 1) {
    let norm = 0;
    for (let i = k; i < n; i += 1) norm += a[i][k] ** 2;
    norm = Math.sqrt(norm);
    if (norm < 1e-300) continue;
    const alpha = a[k][k] > 0 ? -norm : norm;
    const v = new Array(n).fill(0);
    for (let i = k; i < n; i += 1) v[i] = a[i][k];
    v[k] -= alpha;
    let vNorm = 0;
    for (let i = k; i < n; i += 1) vNorm += v[i] ** 2;
    if (vNorm < 1e-300) continue;
    for (let j = k; j < p; j += 1) {
      let dot = 0;
      for (let i = k; i < n; i += 1) dot += v[i] * a[i][j];
      const factor = (2 * dot) / vNorm;
      for (let i = k; i < n; i += 1) a[i][j] -= factor * v[i];
    }
    let dot = 0;
    for (let i = k; i < n; i += 1) dot += v[i] * b[i];
    const factor = (2 * dot) / vNorm;
    for (let i = k; i < n; i += 1) b[i] -= factor * v[i];
  }
  return {
    r: a.slice(0, p).map((row) => row.slice(0, p)),
    qty: b.slice(0, p),
    tail: b.slice(p),
  };
}

/**
 * Back substitution that drops rank-deficient directions instead of dividing
 * by a pivot that is numerically zero.
 *
 * This matters in practice, not just in principle: hold out a whole area from
 * a model carrying one indicator per area and that area's column is entirely
 * zero in the training rows. Dividing through by the resulting tiny pivot
 * produces coefficients of order 1e11 and predictions to match. Zeroing the
 * unidentified direction gives the answer that model can actually support -
 * it has nothing to say about that area's level - and keeps everything finite.
 */
function backSubstitute(r, y, tolerance = 1e-10) {
  const p = r.length;
  const x = new Array(p).fill(0);
  let largest = 0;
  for (let i = 0; i < p; i += 1) largest = Math.max(largest, Math.abs(r[i][i]));
  const floor = Math.max(largest * tolerance, 1e-300);
  let rank = 0;
  for (let i = p - 1; i >= 0; i -= 1) {
    if (Math.abs(r[i][i]) < floor) {
      x[i] = 0;
      continue;
    }
    rank += 1;
    let sum = y[i];
    for (let j = i + 1; j < p; j += 1) sum -= r[i][j] * x[j];
    x[i] = sum / r[i][i];
  }
  x.rank = rank;
  return x;
}

/** Inverse of an upper-triangular matrix, by column. */
function invertUpper(r) {
  const p = r.length;
  const inverse = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let column = 0; column < p; column += 1) {
    const unit = new Array(p).fill(0);
    unit[column] = 1;
    const solved = backSubstitute(r, unit);
    for (let row = 0; row < p; row += 1) inverse[row][column] = solved[row];
  }
  return inverse;
}

/** Prepend the intercept column to a list of predictor columns. */
export function designMatrix(columns) {
  const n = columns[0].length;
  for (const column of columns) {
    if (column.length !== n) throw new Error("designMatrix: columns have different lengths");
  }
  return Array.from({ length: n }, (_, row) => [1, ...columns.map((column) => column[row])]);
}

/** Least squares fit of y on X, where X already contains any intercept. */
export function fitLinear(x, y) {
  const n = x.length;
  const p = x[0].length;
  if (y.length !== n) throw new Error("fitLinear: length mismatch");
  if (n <= p) throw new Error(`fitLinear: need more rows (${n}) than columns (${p})`);

  const { r, qty, tail } = householderQR(x, y);
  const beta = backSubstitute(r, qty);
  const rank = beta.rank ?? p;
  const fitted = x.map((row) => row.reduce((sum, value, index) => sum + value * beta[index], 0));
  const residuals = y.map((value, index) => value - fitted[index]);
  // Recompute from the residuals rather than from the QR tail, which is only
  // the whole story when the design has full rank.
  const sse = residuals.reduce((sum, value) => sum + value ** 2, 0);
  const mean = y.reduce((sum, value) => sum + value, 0) / n;
  const sst = y.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const sigmaSquared = sse / Math.max(1, n - rank);

  const rInverse = invertUpper(r);
  const standardErrors = Array.from({ length: p }, (_, index) => {
    let sum = 0;
    for (let k = index; k < p; k += 1) sum += rInverse[index][k] ** 2;
    return Math.sqrt(sigmaSquared * sum);
  });

  return {
    beta: [...beta],
    standardErrors,
    residuals,
    fitted,
    n,
    p,
    rank,
    rankDeficient: rank < p,
    sigma: Math.sqrt(sigmaSquared),
    r2: sst === 0 ? 0 : 1 - sse / sst,
    adjustedR2: sst === 0 ? 0 : 1 - (sse / (n - p)) / (sst / (n - 1)),
  };
}

/**
 * Variance inflation per predictor: how much wider its interval is because the
 * other predictors already explain it. Above about 10 the coefficients are not
 * separately identified and reporting them individually is misleading.
 */
export function varianceInflation(x) {
  const p = x[0].length;
  const factors = [];
  for (let target = 1; target < p; target += 1) {
    const others = x.map((row) => row.filter((_, index) => index !== target));
    const column = x.map((row) => row[target]);
    try {
      const fit = fitLinear(others, column);
      factors.push(fit.r2 >= 1 ? Infinity : 1 / (1 - fit.r2));
    } catch {
      factors.push(Number.NaN);
    }
  }
  return factors;
}

function groupByBlock(blocks) {
  const groups = new Map();
  blocks.forEach((block, index) => {
    const key = String(block);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });
  return [...groups.values()];
}

/**
 * Cluster bootstrap: resample whole spatial blocks with replacement rather
 * than individual observations, so the resample inherits the dependence
 * structure of the original data instead of destroying it.
 */
export function blockBootstrap(x, y, blocks, { samples = 1000, seed = 20260915, level = 0.95 } = {}) {
  const groups = groupByBlock(blocks);
  if (groups.length < 4) {
    return { ok: false, reason: `need at least four blocks, got ${groups.length}` };
  }
  const random = seededRandom(seed);
  const p = x[0].length;
  const draws = Array.from({ length: p }, () => []);
  let usable = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const rows = [];
    for (let pick = 0; pick < groups.length; pick += 1) {
      rows.push(...groups[Math.floor(random() * groups.length)]);
    }
    if (rows.length <= p) continue;
    try {
      const fit = fitLinear(rows.map((index) => x[index]), rows.map((index) => y[index]));
      fit.beta.forEach((value, index) => draws[index].push(value));
      usable += 1;
    } catch {
      // A resample that happens to be collinear contributes nothing.
    }
  }
  if (usable < samples / 10) return { ok: false, reason: "too many degenerate resamples" };
  const tail = (1 - level) / 2;
  const quantile = (sorted, q) => {
    const position = q * (sorted.length - 1);
    const low = Math.floor(position);
    const high = Math.ceil(position);
    return low === high ? sorted[low] : sorted[low] + (position - low) * (sorted[high] - sorted[low]);
  };
  return {
    ok: true,
    blocks: groups.length,
    samples: usable,
    level,
    intervals: draws.map((column) => {
      const sorted = column.slice().sort((a, b) => a - b);
      return { low: quantile(sorted, tail), high: quantile(sorted, 1 - tail) };
    }),
  };
}

/**
 * Cross-validation that holds out whole blocks. Splitting at random leaks:
 * a held-out building's neighbours stay in the training set, so the model is
 * scored on points it has effectively already seen.
 */
export function blockCrossValidate(x, y, blocks, { folds = 5, seed = 20260915 } = {}) {
  const groups = groupByBlock(blocks);
  if (groups.length < folds) return { r2: Number.NaN, note: `only ${groups.length} blocks` };
  const random = seededRandom(seed + 3);
  const order = groups
    .map((group, index) => ({ group, key: random(), index }))
    .sort((a, b) => a.key - b.key);
  const n = y.length;
  const mean = y.reduce((sum, value) => sum + value, 0) / n;
  let sse = 0;
  let sst = 0;
  let predictions = 0;
  for (let fold = 0; fold < folds; fold += 1) {
    const testRows = order.filter((_, position) => position % folds === fold).flatMap((entry) => entry.group);
    const trainRows = order.filter((_, position) => position % folds !== fold).flatMap((entry) => entry.group);
    if (trainRows.length <= x[0].length || testRows.length === 0) continue;
    let fit;
    try {
      fit = fitLinear(trainRows.map((index) => x[index]), trainRows.map((index) => y[index]));
    } catch {
      continue;
    }
    for (const index of testRows) {
      const predicted = x[index].reduce((sum, value, column) => sum + value * fit.beta[column], 0);
      sse += (y[index] - predicted) ** 2;
      sst += (y[index] - mean) ** 2;
      predictions += 1;
    }
  }
  return {
    r2: sst === 0 ? Number.NaN : 1 - sse / sst,
    folds,
    blocks: groups.length,
    predictions,
  };
}

/**
 * Random k-fold over rows, for comparison against `blockCrossValidate`.
 * Provided so the gap between the two can be measured rather than asserted:
 * where a model can pick up area-specific structure, random splitting scores
 * it on points whose neighbours trained it.
 */
export function randomCrossValidate(x, y, { folds = 5, seed = 20260915 } = {}) {
  const n = y.length;
  if (n < folds * 2) return { r2: Number.NaN, note: "too few rows" };
  const random = seededRandom(seed + 5);
  const order = Array.from({ length: n }, (_, index) => ({ index, key: random() }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.index);
  const mean = y.reduce((sum, value) => sum + value, 0) / n;
  let sse = 0;
  let sst = 0;
  for (let fold = 0; fold < folds; fold += 1) {
    const testRows = order.filter((_, position) => position % folds === fold);
    const trainRows = order.filter((_, position) => position % folds !== fold);
    if (trainRows.length <= x[0].length || testRows.length === 0) continue;
    let fit;
    try {
      fit = fitLinear(trainRows.map((index) => x[index]), trainRows.map((index) => y[index]));
    } catch {
      continue;
    }
    for (const index of testRows) {
      const predicted = x[index].reduce((sum, value, column) => sum + value * fit.beta[column], 0);
      sse += (y[index] - predicted) ** 2;
      sst += (y[index] - mean) ** 2;
    }
  }
  return { r2: sst === 0 ? Number.NaN : 1 - sse / sst, folds };
}

/** Assign each point to a square spatial block of the given size in metres. */
export function spatialBlocks(xMetres, yMetres, blockSize) {
  return xMetres.map((value, index) =>
    `${Math.floor(value / blockSize)}:${Math.floor(yMetres[index] / blockSize)}`);
}
