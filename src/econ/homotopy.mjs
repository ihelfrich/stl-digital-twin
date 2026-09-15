// Numerical algebraic geometry: a total-degree homotopy continuation solver.
//
// To find every isolated complex solution of F(z) = 0 we build a start system
// G(z) whose roots we know by hand, then deform G into F along
//
//   H(z, t) = (1 - t) * gamma * G(z) + t * F(z),   t: 0 -> 1
//
// and track each start root. The random complex gamma ("the gamma trick")
// keeps the paths off the discriminant locus with probability one, so no two
// paths collide before t = 1. The number of paths is the Bezout number, the
// product of the total degrees, which bounds the number of isolated solutions.

import {
  cAbs, cAdd, cDiv, cMul, cScale, cSub,
  bezoutNumber, jacobianEval, polyDegree, systemEval, systemJacobian,
} from "./polynomial.mjs";
import { solveUnivariate } from "./univariate.mjs";

// Gaussian elimination with partial pivoting over the complex numbers.
export function solveLinear(matrix, rhs) {
  const size = rhs.length;
  const augmented = matrix.map((row, index) => [...row.map((value) => [...value]), [...rhs[index]]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (cAbs(augmented[row][column]) > cAbs(augmented[pivot][column])) pivot = row;
    }
    if (cAbs(augmented[pivot][column]) < 1e-30) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const diagonal = augmented[column][column];
    for (let row = column + 1; row < size; row += 1) {
      const factor = cDiv(augmented[row][column], diagonal);
      if (cAbs(factor) === 0) continue;
      for (let index = column; index <= size; index += 1) {
        augmented[row][index] = cSub(augmented[row][index], cMul(factor, augmented[column][index]));
      }
    }
  }
  const solution = new Array(size);
  for (let row = size - 1; row >= 0; row -= 1) {
    let accumulator = augmented[row][size];
    for (let column = row + 1; column < size; column += 1) {
      accumulator = cSub(accumulator, cMul(augmented[row][column], solution[column]));
    }
    solution[row] = cDiv(accumulator, augmented[row][row]);
  }
  return solution;
}

function rootsOfUnity(degree) {
  return Array.from({ length: degree }, (_, index) => {
    const angle = (2 * Math.PI * index) / degree;
    return [Math.cos(angle), Math.sin(angle)];
  });
}

function startPoints(degrees) {
  let points = [[]];
  for (const degree of degrees) {
    const next = [];
    for (const point of points) {
      for (const root of rootsOfUnity(degree)) next.push([...point, root]);
    }
    points = next;
  }
  return points;
}

function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function createSolverContext(system, seed = 20260915) {
  const degrees = system.map((polynomial) => polyDegree(polynomial));
  if (degrees.some((degree) => degree === 0)) throw new Error("homotopy: degenerate system with a constant equation");
  const random = makeRandom(seed);
  const angle = 2 * Math.PI * random();
  return {
    system,
    degrees,
    jacobian: systemJacobian(system),
    gamma: [Math.cos(angle), Math.sin(angle)],
    paths: bezoutNumber(system),
  };
}

function startEval(degrees, z) {
  return degrees.map((degree, index) => {
    let power = [1, 0];
    for (let step = 0; step < degree; step += 1) power = cMul(power, z[index]);
    return cSub(power, [1, 0]);
  });
}

function startJacobian(degrees, z) {
  return degrees.map((degree, row) =>
    degrees.map((_, column) => {
      if (row !== column) return [0, 0];
      let power = [1, 0];
      for (let step = 0; step < degree - 1; step += 1) power = cMul(power, z[row]);
      return cScale(power, degree);
    }),
  );
}

function homotopyValue(context, z, t) {
  const target = systemEval(context.system, z);
  const start = startEval(context.degrees, z);
  return target.map((value, index) =>
    cAdd(cScale(cMul(context.gamma, start[index]), 1 - t), cScale(value, t)),
  );
}

function homotopyJacobian(context, z, t) {
  const target = jacobianEval(context.jacobian, z);
  const start = startJacobian(context.degrees, z);
  return target.map((row, rowIndex) =>
    row.map((value, columnIndex) =>
      cAdd(cScale(cMul(context.gamma, start[rowIndex][columnIndex]), 1 - t), cScale(value, t)),
    ),
  );
}

// dH/dt = F(z) - gamma * G(z)
function homotopyTimeDerivative(context, z) {
  const target = systemEval(context.system, z);
  const start = startEval(context.degrees, z);
  return target.map((value, index) => cSub(value, cMul(context.gamma, start[index])));
}

// Newton correction onto the path. Convergence is judged by the size of the
// correction itself, which is scale free, rather than by the residual, whose
// magnitude depends on the degree. A step whose corrector fails to converge is
// rejected outright: silently accepting a half-corrected iterate is exactly how
// two paths merge and a solution goes missing.
function newtonCorrect(context, z, t, tolerance = 1e-11, iterations = 8) {
  let current = z;
  for (let step = 0; step < iterations; step += 1) {
    const delta = solveLinear(homotopyJacobian(context, current, t), homotopyValue(context, current, t));
    if (!delta) return null;
    current = current.map((entry, index) => cSub(entry, delta[index]));
    if (current.some((entry) => !Number.isFinite(entry[0]) || !Number.isFinite(entry[1]))) return null;
    const correction = Math.max(...delta.map(cAbs));
    const scale = 1 + Math.max(...current.map(cAbs));
    if (correction < tolerance * scale) return { z: current, iterations: step + 1 };
  }
  return null;
}

function distance(a, b) {
  return Math.max(...a.map((entry, index) => cAbs(cSub(entry, b[index]))));
}

// dz/dt along the path, from differentiating H(z(t), t) = 0.
function pathDerivative(context, z, t) {
  const solved = solveLinear(homotopyJacobian(context, z, t), homotopyTimeDerivative(context, z));
  if (!solved) return null;
  return solved.map((entry) => cScale(entry, -1));
}

// Fourth-order Runge-Kutta predictor. A first-order Euler step leaves the
// corrector a long way to travel, and when the roots of the target system are
// clustered - as they are for excess-demand systems, whose roots pile up along
// the real axis - that is exactly when paths swap. A higher-order predictor
// keeps the correction small enough for the jump guard to stay meaningful.
function predict(context, z, t, step) {
  const k1 = pathDerivative(context, z, t);
  if (!k1) return null;
  const advance = (base, direction, amount) =>
    base.map((entry, index) => cAdd(entry, cScale(direction[index], amount)));
  const k2 = pathDerivative(context, advance(z, k1, step / 2), t + step / 2);
  if (!k2) return null;
  const k3 = pathDerivative(context, advance(z, k2, step / 2), t + step / 2);
  if (!k3) return null;
  const k4 = pathDerivative(context, advance(z, k3, step), t + step);
  if (!k4) return null;
  return z.map((entry, index) => {
    const slope = cAdd(
      cAdd(k1[index], cScale(k2[index], 2)),
      cAdd(cScale(k3[index], 2), k4[index]),
    );
    return cAdd(entry, cScale(slope, step / 6));
  });
}

function trackPath(context, start, options) {
  const { divergenceBound, minStep, maxStep } = options;
  let z = start;
  let t = 0;
  let step = maxStep;
  let streak = 0;
  let iterations = 0;
  while (t < 1 && iterations < 8000) {
    iterations += 1;
    const target = Math.min(1, t + step);
    const predicted = predict(context, z, t, target - t) ?? z;
    const corrected = newtonCorrect(context, predicted, target);
    // Path-jumping guard: the corrector should nudge the predictor back onto
    // the path, not travel further than the predictor itself did. When it
    // does, we have most likely landed on a neighbouring path.
    const jumped = corrected
      && distance(corrected.z, predicted) > 2 * distance(predicted, z) + 1e-7;
    const accepted = corrected && !jumped && Math.max(...corrected.z.map(cAbs)) < divergenceBound;
    if (accepted) {
      z = corrected.z;
      t = target;
      // Grow the step only after a run of easy corrections. A step that needed
      // the corrector to work hard is a warning that the path is turning.
      streak = corrected.iterations <= 2 ? streak + 1 : 0;
      if (streak >= 3) {
        step = Math.min(maxStep, step * 2);
        streak = 0;
      } else if (corrected.iterations >= 5) {
        step /= 2;
      }
    } else {
      streak = 0;
      step /= 2;
      if (step < minStep) {
        return { z, t, converged: false, diverged: Math.max(...z.map(cAbs)) >= divergenceBound / 1e4 };
      }
    }
  }
  return { z, t, converged: t >= 1, diverged: false };
}

function refineAtTarget(system, jacobian, z, iterations = 40) {
  let current = z;
  for (let step = 0; step < iterations; step += 1) {
    const value = systemEval(system, current);
    const residual = Math.max(...value.map(cAbs));
    if (residual < 1e-13) break;
    const delta = solveLinear(jacobianEval(jacobian, current), value);
    if (!delta) break;
    current = current.map((entry, index) => cSub(entry, delta[index]));
  }
  return current;
}

function solveOnce(system, options) {
  const {
    seed = 20260915,
    divergenceBound = 1e8,
    minStep = 1e-13,
    maxStep = 0.05,
    residualTolerance = 1e-7,
    dedupeTolerance = 1e-6,
  } = options;
  const context = createSolverContext(system, seed);
  const solutions = [];
  let diverged = 0;
  let failed = 0;
  for (const start of startPoints(context.degrees)) {
    const tracked = trackPath(context, start, { divergenceBound, minStep, maxStep });
    if (!tracked.converged) {
      if (tracked.diverged) diverged += 1;
      else failed += 1;
      continue;
    }
    const refined = refineAtTarget(system, context.jacobian, tracked.z);
    if (refined.some((entry) => !Number.isFinite(entry[0]) || !Number.isFinite(entry[1]))) {
      failed += 1;
      continue;
    }
    const residual = Math.max(...systemEval(system, refined).map(cAbs));
    if (!(residual < residualTolerance)) {
      failed += 1;
      continue;
    }
    const duplicate = solutions.find((existing) =>
      existing.z.every((entry, index) => cAbs(cSub(entry, refined[index])) < dedupeTolerance),
    );
    if (duplicate) {
      duplicate.multiplicity += 1;
      continue;
    }
    solutions.push({ z: refined, residual, multiplicity: 1 });
  }
  return { solutions, paths: context.paths, diverged, failed };
}

/**
 * Solve a square polynomial system for all isolated complex roots.
 *
 * Path tracking is a numerical procedure and a badly placed gamma can still
 * let two paths swap near a cluster of roots, so we repeat the solve with a
 * fresh gamma and a finer step and take the union. Finding Bezout-many
 * distinct roots certifies completeness: no square system can have more.
 * Systems with roots at infinity never reach that bound, which is why the
 * result reports `complete` rather than asserting it. Paths that run off to
 * infinity are expected and counted separately.
 */
export function solveSystem(system, options = {}) {
  const { attempts = 3, seed = 20260915, maxStep = 0.05, dedupeTolerance = 1e-6 } = options;
  // One equation in one unknown is not a degenerate case here - it is what a
  // two-good exchange economy reduces to - and it has a better solver.
  if (system.length === 1 && system[0].vars === 1) return solveUnivariate(system, options);
  const solutions = [];
  let paths = 0;
  let diverged = 0;
  let failed = 0;
  let rounds = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const round = solveOnce(system, {
      ...options,
      seed: seed + attempt * 7919,
      maxStep: maxStep / 5 ** attempt,
    });
    rounds += 1;
    paths = round.paths;
    diverged = round.diverged;
    failed = round.failed;
    for (const candidate of round.solutions) {
      const duplicate = solutions.find((existing) =>
        existing.z.every((entry, index) => cAbs(cSub(entry, candidate.z[index])) < dedupeTolerance),
      );
      if (duplicate) duplicate.multiplicity += candidate.multiplicity;
      else solutions.push(candidate);
    }
    if (solutions.length >= paths) break;
  }
  return {
    solutions, paths, diverged, failed, rounds,
    complete: solutions.length >= paths,
    method: "homotopy",
  };
}

export function realPositiveSolutions(result, tolerance = 1e-7) {
  return result.solutions
    .filter((solution) => solution.z.every((entry) => Math.abs(entry[1]) < tolerance && entry[0] > tolerance))
    .map((solution) => solution.z.map((entry) => entry[0]));
}
