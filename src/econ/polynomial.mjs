// Complex numbers are [re, im] pairs. Multivariate polynomials are
// { vars, terms: [{ c: [re, im], e: [exponent per variable] }] } with
// like terms combined and zero terms dropped.

export function cAdd(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
export function cSub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
export function cMul(a, b) { return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]; }
export function cScale(a, s) { return [a[0] * s, a[1] * s]; }
export function cAbs(a) { return Math.hypot(a[0], a[1]); }

export function cDiv(a, b) {
  const denominator = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / denominator, (a[1] * b[0] - a[0] * b[1]) / denominator];
}

export function cPow(a, k) {
  let result = [1, 0];
  let base = a;
  let exponent = k;
  while (exponent > 0) {
    if (exponent & 1) result = cMul(result, base);
    base = cMul(base, base);
    exponent >>= 1;
  }
  return result;
}

function normalize(terms) {
  const merged = new Map();
  for (const term of terms) {
    const key = term.e.join(",");
    const existing = merged.get(key);
    if (existing) {
      existing.c = cAdd(existing.c, term.c);
    } else {
      merged.set(key, { c: [...term.c], e: [...term.e] });
    }
  }
  return [...merged.values()].filter((term) => cAbs(term.c) > 1e-14);
}

export function polyZero(vars) { return { vars, terms: [] }; }

export function polyConst(vars, value) {
  const coefficient = Array.isArray(value) ? value : [value, 0];
  if (cAbs(coefficient) === 0) return polyZero(vars);
  return { vars, terms: [{ c: coefficient, e: new Array(vars).fill(0) }] };
}

export function polyMonomial(vars, coefficient, exponents) {
  const c = Array.isArray(coefficient) ? coefficient : [coefficient, 0];
  if (cAbs(c) === 0) return polyZero(vars);
  return { vars, terms: [{ c, e: [...exponents] }] };
}

export function polyAdd(a, b) {
  if (a.vars !== b.vars) throw new Error("polyAdd: variable count mismatch");
  return { vars: a.vars, terms: normalize([...a.terms, ...b.terms]) };
}

export function polySub(a, b) {
  return polyAdd(a, polyScale(b, [-1, 0]));
}

export function polyScale(a, factor) {
  const c = Array.isArray(factor) ? factor : [factor, 0];
  return { vars: a.vars, terms: normalize(a.terms.map((term) => ({ c: cMul(term.c, c), e: term.e }))) };
}

export function polyMul(a, b) {
  if (a.vars !== b.vars) throw new Error("polyMul: variable count mismatch");
  const terms = [];
  for (const left of a.terms) {
    for (const right of b.terms) {
      terms.push({
        c: cMul(left.c, right.c),
        e: left.e.map((exponent, index) => exponent + right.e[index]),
      });
    }
  }
  return { vars: a.vars, terms: normalize(terms) };
}

export function polyProduct(vars, polynomials) {
  return polynomials.reduce((accumulator, polynomial) => polyMul(accumulator, polynomial), polyConst(vars, 1));
}

export function polyShift(polynomial, exponents) {
  return {
    vars: polynomial.vars,
    terms: polynomial.terms.map((term) => ({
      c: term.c,
      e: term.e.map((exponent, index) => exponent + exponents[index]),
    })),
  };
}

export function polyDegree(polynomial) {
  return polynomial.terms.reduce(
    (best, term) => Math.max(best, term.e.reduce((sum, exponent) => sum + exponent, 0)),
    0,
  );
}

export function polyEval(polynomial, point) {
  let sum = [0, 0];
  for (const term of polynomial.terms) {
    let value = term.c;
    for (let index = 0; index < polynomial.vars; index += 1) {
      if (term.e[index] !== 0) value = cMul(value, cPow(point[index], term.e[index]));
    }
    sum = cAdd(sum, value);
  }
  return sum;
}

export function polyPartial(polynomial, index) {
  const terms = [];
  for (const term of polynomial.terms) {
    const exponent = term.e[index];
    if (exponent === 0) continue;
    const e = [...term.e];
    e[index] = exponent - 1;
    terms.push({ c: cScale(term.c, exponent), e });
  }
  return { vars: polynomial.vars, terms: normalize(terms) };
}

export function systemEval(system, point) {
  return system.map((polynomial) => polyEval(polynomial, point));
}

export function systemJacobian(system) {
  return system.map((polynomial) =>
    Array.from({ length: polynomial.vars }, (_, index) => polyPartial(polynomial, index)),
  );
}

export function jacobianEval(jacobian, point) {
  return jacobian.map((row) => row.map((polynomial) => polyEval(polynomial, point)));
}

// Bezout number: the number of paths a total-degree homotopy must track.
export function bezoutNumber(system) {
  return system.reduce((product, polynomial) => product * polyDegree(polynomial), 1);
}

/**
 * Divide out the largest monomial dividing every term.
 *
 * Clearing denominators multiplies each equation by powers of the variables,
 * which glues the coordinate hyperplanes {y_k = 0} onto the variety. Those
 * components carry no economics (prices are strictly positive) and, being
 * highly singular, they wreck path tracking. Removing them leaves exactly the
 * part of the variety we care about and cuts the path count accordingly.
 */
export function polyStripMonomialFactor(polynomial) {
  if (polynomial.terms.length === 0) return { polynomial, stripped: new Array(polynomial.vars).fill(0) };
  const stripped = Array.from({ length: polynomial.vars }, (_, index) =>
    polynomial.terms.reduce((least, term) => Math.min(least, term.e[index]), Infinity),
  );
  if (stripped.every((exponent) => exponent === 0)) return { polynomial, stripped };
  return {
    polynomial: {
      vars: polynomial.vars,
      terms: polynomial.terms.map((term) => ({
        c: term.c,
        e: term.e.map((exponent, index) => exponent - stripped[index]),
      })),
    },
    stripped,
  };
}
