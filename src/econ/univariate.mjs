// All complex roots of a univariate polynomial, by the Aberth-Ehrlich method.
//
// Homotopy continuation is the general tool, but in one variable it is both
// slower and less reliable: the roots of an excess-demand polynomial pile up
// along the real axis, and tightly clustered targets are exactly where path
// tracking swaps paths. Aberth-Ehrlich has no such failure mode - every root is
// refined simultaneously, with each one pushed away from the others - and the
// univariate case is not a special case worth skipping: an exchange economy in
// two goods reduces to precisely one polynomial in one unknown.

import { cAbs, cAdd, cDiv, cMul, cSub } from "./polynomial.mjs";

/** Dense coefficient list, index = exponent. */
export function toCoefficients(polynomial) {
  if (polynomial.vars !== 1) throw new Error("toCoefficients: not univariate");
  const degree = polynomial.terms.reduce((best, term) => Math.max(best, term.e[0]), 0);
  const coefficients = Array.from({ length: degree + 1 }, () => [0, 0]);
  for (const term of polynomial.terms) coefficients[term.e[0]] = term.c;
  return coefficients;
}

function evaluate(coefficients, z) {
  // Horner, from the top down.
  let value = [0, 0];
  for (let index = coefficients.length - 1; index >= 0; index -= 1) {
    value = cAdd(cMul(value, z), coefficients[index]);
  }
  return value;
}

function evaluateWithDerivative(coefficients, z) {
  let value = [0, 0];
  let derivative = [0, 0];
  for (let index = coefficients.length - 1; index >= 0; index -= 1) {
    derivative = cAdd(cMul(derivative, z), value);
    value = cAdd(cMul(value, z), coefficients[index]);
  }
  return { value, derivative };
}

/**
 * Starting radius: the geometric mean of the root moduli, |a_0/a_n|^(1/n).
 *
 * The Cauchy bound also encloses every root but is far too generous, and at
 * high degree that is fatal rather than merely slow - evaluating a degree-100
 * polynomial a few hundred units from the origin overflows a double long before
 * the iteration can pull the estimates back in. The geometric mean sits in the
 * middle of the roots by construction, which is exactly where Aberth wants to
 * start.
 */
function startRadius(coefficients) {
  const degree = coefficients.length - 1;
  const leading = cAbs(coefficients[degree]);
  let lowest = 0;
  while (lowest < degree && cAbs(coefficients[lowest]) === 0) lowest += 1;
  const constant = cAbs(coefficients[lowest]);
  if (leading === 0 || constant === 0 || degree === lowest) return 1;
  const radius = Math.exp((Math.log(constant) - Math.log(leading)) / (degree - lowest));
  return Number.isFinite(radius) && radius > 0 ? radius : 1;
}

/**
 * Every root of the polynomial, to full double precision where the problem
 * allows it. Returns { roots, converged } so callers can tell whether the
 * iteration actually settled.
 */
export function univariateRoots(polynomial, { iterations = 500, tolerance = 1e-14 } = {}) {
  const coefficients = toCoefficients(polynomial);
  const degree = coefficients.length - 1;
  if (degree < 1) return { roots: [], converged: true, degree: 0 };

  const radius = startRadius(coefficients);
  // Spread the starting points around a circle, off-axis so that a real
  // polynomial does not start with conjugate pairs sitting on top of each other.
  let roots = Array.from({ length: degree }, (_, index) => {
    const angle = (2 * Math.PI * index) / degree + 0.4501;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });

  let converged = false;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let largestStep = 0;
    const next = roots.map((root, index) => {
      const { value, derivative } = evaluateWithDerivative(coefficients, root);
      if (cAbs(derivative) === 0) return root;
      const ratio = cDiv(value, derivative);
      // Aberth correction: Newton, damped by the pull of the other roots.
      let repulsion = [0, 0];
      for (let other = 0; other < degree; other += 1) {
        if (other === index) continue;
        const gap = cSub(root, roots[other]);
        if (cAbs(gap) < 1e-300) continue;
        repulsion = cAdd(repulsion, cDiv([1, 0], gap));
      }
      const denominator = cSub([1, 0], cMul(ratio, repulsion));
      if (cAbs(denominator) < 1e-300) return root;
      const step = cDiv(ratio, denominator);
      if (!Number.isFinite(step[0]) || !Number.isFinite(step[1])) return root;
      largestStep = Math.max(largestStep, cAbs(step));
      return cSub(root, step);
    });
    roots = next;
    if (largestStep < tolerance * (1 + radius)) {
      converged = true;
      break;
    }
  }

  // Newton polish, which also cleans up roots the Aberth phase left loose.
  roots = roots.map((root) => {
    let current = root;
    for (let step = 0; step < 30; step += 1) {
      const { value, derivative } = evaluateWithDerivative(coefficients, current);
      if (cAbs(derivative) < 1e-300) break;
      const delta = cDiv(value, derivative);
      if (!Number.isFinite(delta[0]) || !Number.isFinite(delta[1])) break;
      current = cSub(current, delta);
      if (cAbs(delta) < 1e-15 * (1 + cAbs(current))) break;
    }
    return current;
  });

  return { roots, converged, degree };
}

/**
 * Relative backward error: |p(z)| measured against the size of the terms that
 * had to cancel to produce it. Comparing |p(z)| to a fixed tolerance is
 * meaningless at high degree, where the individual terms are enormous and the
 * sum is not.
 */
function backwardError(coefficients, z) {
  const value = cAbs(evaluate(coefficients, z));
  const magnitude = cAbs(z);
  let bound = 0;
  for (let index = coefficients.length - 1; index >= 0; index -= 1) {
    bound = bound * magnitude + cAbs(coefficients[index]);
  }
  return bound > 0 ? value / bound : value;
}

/** Solve a one-equation, one-unknown system in the shape solveSystem returns. */
export function solveUnivariate(system, { dedupeTolerance = 1e-6, residualTolerance = 1e-11 } = {}) {
  const polynomial = system[0];
  const coefficients = toCoefficients(polynomial);
  const { roots, degree } = univariateRoots(polynomial);

  const solutions = [];
  let failed = 0;
  for (const root of roots) {
    if (!Number.isFinite(root[0]) || !Number.isFinite(root[1])) {
      failed += 1;
      continue;
    }
    const residual = backwardError(coefficients, root);
    if (!Number.isFinite(residual) || residual > residualTolerance) {
      failed += 1;
      continue;
    }
    const duplicate = solutions.find((existing) => cAbs(cSub(existing.z[0], root)) < dedupeTolerance);
    if (duplicate) duplicate.multiplicity += 1;
    else solutions.push({ z: [root], residual, multiplicity: 1 });
  }
  const total = solutions.reduce((sum, solution) => sum + solution.multiplicity, 0);
  return {
    solutions,
    paths: degree,
    diverged: 0,
    failed,
    rounds: 1,
    complete: total >= degree,
    method: "aberth",
  };
}
