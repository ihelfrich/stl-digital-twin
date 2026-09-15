// An Arrow-Debreu exchange economy with CES preferences, reduced to a square
// polynomial system so that *every* competitive equilibrium can be computed at
// once rather than one at a time.
//
// Agent h with share weights a_h, elasticity of substitution sigma_h and
// endowment e_h has Marshallian demand
//
//   x_hi(p) = A_hi * p_i^-sigma_h * (p . e_h) / sum_j A_hj * p_j^(1-sigma_h),
//   A_hi = a_hi^sigma_h.
//
// Those exponents are not integers, so the excess-demand system is not
// polynomial as written. It is semi-algebraic whenever every sigma_h is
// rational (Kubler & Schmedders 2010), and the standard way to see that is the
// change of variables p_i = y_i^q with q a common denominator of the sigma_h.
// Clearing denominators then leaves an honest polynomial system in y, and the
// competitive equilibria are exactly its strictly positive real points that
// also satisfy the original excess-demand equations.

import {
  polyAdd, polyConst, polyMonomial, polyMul, polyProduct, polyShift, polyStripMonomialFactor,
} from "./polynomial.mjs";
import { realPositiveSolutions, solveSystem } from "./homotopy.mjs";

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function lcm(a, b) { return (a * b) / gcd(a, b); }

// Continued-fraction rationalisation, so callers may pass sigma as a float.
export function toRational(value, maxDenominator = 24) {
  if (Array.isArray(value)) return { numerator: value[0], denominator: value[1] };
  let bestNumerator = 1;
  let bestDenominator = 1;
  let bestError = Infinity;
  for (let denominator = 1; denominator <= maxDenominator; denominator += 1) {
    const numerator = Math.round(value * denominator);
    if (numerator <= 0) continue;
    const error = Math.abs(value - numerator / denominator);
    if (error < bestError - 1e-12) {
      bestError = error;
      bestNumerator = numerator;
      bestDenominator = denominator;
    }
  }
  const divisor = gcd(bestNumerator, bestDenominator);
  return { numerator: bestNumerator / divisor, denominator: bestDenominator / divisor };
}

export function normalizeEconomy(economy) {
  const goods = economy.goods ?? economy.agents[0].endowment.length;
  const agents = economy.agents.map((agent) => {
    const sigma = toRational(agent.elasticity);
    const shares = agent.shares ?? new Array(goods).fill(1 / goods);
    const value = sigma.numerator / sigma.denominator;
    return {
      ...agent,
      shares,
      sigma,
      sigmaValue: value,
      weights: shares.map((share) => share ** value),
    };
  });
  return { goods, agents };
}

// Ground-truth demand in floating point. The polynomial system is a means to
// an end; this is the object whose zeros we actually care about.
export function excessDemand(economy, prices) {
  const { goods, agents } = normalizeEconomy(economy);
  const totals = new Array(goods).fill(0);
  for (const agent of agents) {
    const income = prices.reduce((sum, price, index) => sum + price * agent.endowment[index], 0);
    const denominator = prices.reduce(
      (sum, price, index) => sum + agent.weights[index] * price ** (1 - agent.sigmaValue),
      0,
    );
    for (let good = 0; good < goods; good += 1) {
      const demand = (agent.weights[good] * prices[good] ** -agent.sigmaValue * income) / denominator;
      totals[good] += demand - agent.endowment[good];
    }
  }
  return totals;
}

/**
 * Build the cleared polynomial system F(y) = 0 in the n-1 variables
 * y_1..y_{n-1}, where p_i = y_i^q and p_n = 1 by Walras normalisation. Only
 * the first n-1 markets appear: Walras' law makes the last equation redundant.
 */
export function buildEquilibriumSystem(economy) {
  const { goods, agents } = normalizeEconomy(economy);
  const vars = goods - 1;
  if (vars < 1) throw new Error("buildEquilibriumSystem: need at least two goods");

  const q = agents.reduce((accumulator, agent) => lcm(accumulator, agent.sigma.denominator), 1);
  const s = agents.map((agent) => (q * agent.sigma.numerator) / agent.sigma.denominator);
  const t = s.map((value) => Math.max(0, value - q));

  const unit = (index, power) => {
    const exponents = new Array(vars).fill(0);
    exponents[index] = power;
    return exponents;
  };

  // m_h = sum_j e_hj p_j, with p_n = 1.
  const incomes = agents.map((agent) => {
    let polynomial = polyConst(vars, agent.endowment[goods - 1]);
    for (let good = 0; good < vars; good += 1) {
      polynomial = polyAdd(polynomial, polyMonomial(vars, agent.endowment[good], unit(good, q)));
    }
    return polynomial;
  });

  // D~_h = (prod_k y_k^t_h) * sum_j A_hj p_j^(1-sigma_h)
  const denominators = agents.map((agent, index) => {
    let polynomial = polyConst(vars, agent.weights[goods - 1]);
    for (let good = 0; good < vars; good += 1) {
      polynomial = polyAdd(polynomial, polyMonomial(vars, agent.weights[good], unit(good, q - s[index])));
    }
    return polyShift(polynomial, new Array(vars).fill(t[index]));
  });

  const allDenominators = polyProduct(vars, denominators);

  const system = [];
  for (let good = 0; good < vars; good += 1) {
    const supply = agents.reduce((sum, agent) => sum + agent.endowment[good], 0);
    let equation = polyMul(polyMonomial(vars, -supply, unit(good, q)), allDenominators);
    for (let index = 0; index < agents.length; index += 1) {
      const others = polyProduct(vars, denominators.filter((_, other) => other !== index));
      const exponents = new Array(vars).fill(t[index]);
      exponents[good] = q - Math.min(s[index], q);
      const numerator = polyMul(
        polyMonomial(vars, agents[index].weights[good], exponents),
        incomes[index],
      );
      equation = polyAdd(equation, polyMul(numerator, others));
    }
    system.push(polyStripMonomialFactor(equation).polynomial);
  }
  return { system, q, vars, goods };
}

/**
 * Topological index of a regular equilibrium: sign det(-DZ) on the normalised
 * price simplex. Dierker (1972): the indices of a regular economy sum to +1,
 * which is how we know the solver did not miss an equilibrium.
 */
export function equilibriumIndex(economy, prices, step = 1e-6) {
  const size = prices.length - 1;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(0));
  for (let column = 0; column < size; column += 1) {
    const forward = [...prices];
    const backward = [...prices];
    forward[column] += step;
    backward[column] -= step;
    const high = excessDemand(economy, forward);
    const low = excessDemand(economy, backward);
    for (let row = 0; row < size; row += 1) {
      matrix[row][column] = -(high[row] - low[row]) / (2 * step);
    }
  }
  // Determinant by Gaussian elimination; we only need its sign.
  let sign = 1;
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    if (Math.abs(matrix[pivot][column]) < 1e-12) return 0;
    if (pivot !== column) {
      [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
      sign = -sign;
    }
    if (matrix[column][column] < 0) sign = -sign;
    for (let row = column + 1; row < size; row += 1) {
      const factor = matrix[row][column] / matrix[column][column];
      for (let index = column; index < size; index += 1) {
        matrix[row][index] -= factor * matrix[column][index];
      }
    }
  }
  return sign;
}

/**
 * Compute every competitive equilibrium of the economy.
 *
 * Path count is the Bezout number of the cleared system, so this is
 * exponential in the number of goods: it is a tool for small, sharply posed
 * markets (a handful of districts or factors), not for large-scale models.
 */
export function solveEconomy(economy, options = {}) {
  const { tolerance = 1e-6 } = options;
  const { system, q, goods } = buildEquilibriumSystem(economy);
  const result = solveSystem(system, options);
  const candidates = realPositiveSolutions(result);

  const equilibria = [];
  for (const y of candidates) {
    const prices = [...y.map((value) => value ** q), 1];
    const residual = Math.max(...excessDemand(economy, prices).map(Math.abs));
    // Reject the spurious roots the denominator clearing introduced.
    if (!(residual < tolerance)) continue;
    const duplicate = equilibria.find((existing) =>
      existing.prices.every((price, index) => Math.abs(price - prices[index]) < 1e-6),
    );
    if (duplicate) continue;
    equilibria.push({ prices, residual, index: equilibriumIndex(economy, prices) });
  }
  equilibria.sort((a, b) => a.prices[0] - b.prices[0]);

  const indexSum = equilibria.reduce((sum, equilibrium) => sum + equilibrium.index, 0);
  return {
    goods,
    equilibria,
    indexSum,
    regular: equilibria.every((equilibrium) => equilibrium.index !== 0),
    diagnostics: {
      paths: result.paths,
      diverged: result.diverged,
      failed: result.failed,
      rounds: result.rounds,
      complete: result.complete,
      q,
    },
  };
}
