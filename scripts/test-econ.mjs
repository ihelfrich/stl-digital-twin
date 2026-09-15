// Tests for the economic layer. Run with: npm run test:econ
//
// These check mathematics, not snapshots: known closed forms, theorems the
// output has to satisfy, and category laws that either hold or do not.

import {
  polyAdd, polyConst, polyDegree, polyEval, polyMonomial, polyMul, polyPartial, polyStripMonomialFactor,
} from "../src/econ/polynomial.mjs";
import { realPositiveSolutions, solveSystem } from "../src/econ/homotopy.mjs";
import { buildEquilibriumSystem, excessDemand, solveEconomy } from "../src/econ/exchange-economy.mjs";
import {
  cohomology, coboundary, createSheaf, decompose, diffuse, globalSections, spectrum,
} from "../src/econ/sheaf.mjs";
import { matVec } from "../src/econ/linalg.mjs";
import {
  associator, checkTwoCell, decision, equilibria, interchange, pentagonHolds, sequential,
  sequentialPerfect, tensor,
} from "../src/econ/open-games.mjs";

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

function close(name, actual, expected, tolerance = 1e-6) {
  check(name, Math.abs(actual - expected) < tolerance, `got ${actual}, expected ${expected}`);
}

function section(title) {
  console.log(`\n${title}`);
}

// --- polynomials -------------------------------------------------------
section("polynomials");
{
  const x = polyMonomial(2, 1, [1, 0]);
  const y = polyMonomial(2, 1, [0, 1]);
  const p = polyMul(polyMul(x, x), y); // x^2 y
  close("x^2 y at (2,3)", polyEval(p, [[2, 0], [3, 0]])[0], 12);
  check("total degree", polyDegree(p) === 3);
  close("d/dx at (2,3)", polyEval(polyPartial(p, 0), [[2, 0], [3, 0]])[0], 12);

  const withFactor = polyAdd(polyMonomial(1, 3, [5]), polyMonomial(1, -7, [3]));
  const { polynomial: stripped, stripped: exponents } = polyStripMonomialFactor(withFactor);
  check("monomial factor removed", exponents[0] === 3 && polyDegree(stripped) === 2);
  close("stripped polynomial keeps its other roots", polyEval(stripped, [[Math.sqrt(7 / 3), 0]])[0], 0, 1e-9);
}

// --- homotopy continuation ---------------------------------------------
section("homotopy continuation");
{
  // (x-1)(x-2)(x-3)
  const cubic = [polyAdd(
    polyAdd(polyMonomial(1, 1, [3]), polyMonomial(1, -6, [2])),
    polyAdd(polyMonomial(1, 11, [1]), polyConst(1, -6)),
  )];
  const roots = realPositiveSolutions(solveSystem(cubic)).map(([value]) => value).sort((a, b) => a - b);
  check("cubic finds all three roots", roots.length === 3, JSON.stringify(roots));
  close("root 1", roots[0], 1);
  close("root 2", roots[1], 2);
  close("root 3", roots[2], 3);

  // Unit circle meets the diagonal in two points.
  const intersection = [
    polyAdd(polyAdd(polyMonomial(2, 1, [2, 0]), polyMonomial(2, 1, [0, 2])), polyConst(2, -1)),
    polyAdd(polyMonomial(2, 1, [1, 0]), polyMonomial(2, -1, [0, 1])),
  ];
  const result = solveSystem(intersection);
  check("circle meets line twice", result.solutions.length === 2);
  check("Bezout bound met exactly", result.complete);
  const positive = realPositiveSolutions(result);
  close("intersection point", positive[0][0], Math.SQRT1_2);
}

// --- competitive equilibrium -------------------------------------------
section("competitive equilibrium");
{
  const symmetric = {
    goods: 2,
    agents: [
      { shares: [0.8, 0.2], elasticity: 0.2, endowment: [2, 1] },
      { shares: [0.2, 0.8], elasticity: 0.2, endowment: [1, 2] },
    ],
  };
  const solved = solveEconomy(symmetric);
  check("symmetric economy has one equilibrium", solved.equilibria.length === 1);
  close("symmetric equilibrium price", solved.equilibria[0].prices[0], 1);
  check("index theorem", solved.indexSum === 1);

  // Cobb-Douglas (sigma = 1) has a closed form: with good 2 as numeraire,
  // p1 = sum_h a_h e_h2 / (E_1 - sum_h a_h e_h1).
  const cobb = {
    goods: 2,
    agents: [
      { shares: [0.7, 0.3], elasticity: 1, endowment: [3, 1] },
      { shares: [0.25, 0.75], elasticity: 1, endowment: [1, 4] },
    ],
  };
  const numerator = 0.7 * 1 + 0.25 * 4;
  const denominator = (3 + 1) - (0.7 * 3 + 0.25 * 1);
  const cobbSolved = solveEconomy(cobb);
  check("Cobb-Douglas has one equilibrium", cobbSolved.equilibria.length === 1);
  close("Cobb-Douglas closed form", cobbSolved.equilibria[0].prices[0], numerator / denominator, 1e-8);

  // A 2x2 CES economy with three equilibria. Kubler & Schmedders (2010) show
  // three is the maximum for this class, and that multiplicity needs both low
  // substitutability and sharply opposed endowments - as here.
  const multiple = {
    goods: 2,
    agents: [
      { shares: [0.99, 0.01], elasticity: 0.1, endowment: [2, 0.05] },
      { shares: [0.01, 0.99], elasticity: 0.1, endowment: [0.05, 2] },
    ],
  };
  const many = solveEconomy(multiple);
  check("three equilibria found", many.equilibria.length === 3, `got ${many.equilibria.length}`);
  check("indices alternate to +1", many.indexSum === 1);
  check("middle equilibrium is unstable", many.equilibria[1].index === -1);
  close("equilibria are reciprocal by symmetry", many.equilibria[0].prices[0] * many.equilibria[2].prices[0], 1, 1e-4);

  // Every equilibrium really clears every market.
  for (const point of many.equilibria) {
    const residual = Math.max(...excessDemand(multiple, point.prices).map(Math.abs));
    check("market clears at each equilibrium", residual < 1e-7, `residual ${residual}`);
  }

  // Randomised check of Dierker's index theorem across the region where
  // multiplicity actually occurs. An even count, or indices that do not sum to
  // +1, would mean the solver missed a solution.
  let state = 2026;
  const random = () => { state = (state * 1103515245 + 12345) >>> 0; return state / 4294967296; };
  let trials = 0;
  let violations = 0;
  let evenCounts = 0;
  let maxCount = 0;
  for (let trial = 0; trial < 60; trial += 1) {
    const share = 0.9 + 0.099 * random();
    const elasticity = [0.1, 0.125, 0.2][Math.floor(random() * 3)];
    const small = 0.001 + 0.25 * random();
    const economy = {
      goods: 2,
      agents: [
        { shares: [share, 1 - share], elasticity, endowment: [1, small] },
        { shares: [1 - share, share], elasticity, endowment: [small, 1] },
      ],
    };
    const outcome = solveEconomy(economy);
    trials += 1;
    if (outcome.indexSum !== 1) violations += 1;
    if (outcome.equilibria.length % 2 === 0) evenCounts += 1;
    maxCount = Math.max(maxCount, outcome.equilibria.length);
  }
  check("index theorem holds on every random economy", violations === 0, `${violations}/${trials} failed`);
  check("equilibrium count is always odd", evenCounts === 0, `${evenCounts} even counts`);
  check("2x2 CES never exceeds three equilibria", maxCount <= 3, `saw ${maxCount}`);
  console.log(`  ${trials} random economies, max ${maxCount} equilibria, ${violations} index violations`);

  // Three goods needs two unknowns, so this one goes through homotopy
  // continuation rather than the univariate solver. A symmetric economy has
  // its equilibrium at equal prices.
  const threeGoods = {
    goods: 3,
    agents: [
      { shares: [0.5, 0.3, 0.2], elasticity: 0.5, endowment: [2, 1, 1] },
      { shares: [0.2, 0.5, 0.3], elasticity: 0.5, endowment: [1, 2, 1] },
      { shares: [0.3, 0.2, 0.5], elasticity: 0.5, endowment: [1, 1, 2] },
    ],
  };
  const threeSolved = solveEconomy(threeGoods);
  check("three-good economy is solved by homotopy", threeSolved.diagnostics.paths > 1);
  check("three-good economy has one equilibrium", threeSolved.equilibria.length === 1,
    `got ${threeSolved.equilibria.length}`);
  close("symmetric three-good price 1", threeSolved.equilibria[0].prices[0], 1, 1e-6);
  close("symmetric three-good price 2", threeSolved.equilibria[0].prices[1], 1, 1e-6);
  check("three-good index theorem", threeSolved.indexSum === 1);

  // The univariate branch must find every root, not merely the useful ones:
  // that is what makes "these are all the equilibria" a statement and not a
  // hope. Degree grows with the number of agents, so this also exercises it.
  const many12 = {
    goods: 2,
    agents: Array.from({ length: 12 }, (_, index) => ({
      shares: [0.3 + 0.03 * index, 0.7 - 0.03 * index],
      elasticity: 0.1,
      endowment: [1 + 0.1 * index, 2 - 0.05 * index],
    })),
  };
  const many12Solved = solveEconomy(many12);
  check("degree-100 system resolves nearly every root", many12Solved.diagnostics.failed <= 2,
    `${many12Solved.diagnostics.failed} of ${many12Solved.diagnostics.paths} unresolved`);
  check("twelve-agent index theorem", many12Solved.indexSum === 1);
  // The roots that fail to converge at this degree sit in a thin annulus in
  // the complex plane. What matters economically is that no *equilibrium* is
  // lost, and the index theorem is what certifies that.
  const many12System = buildEquilibriumSystem(many12);
  const evaluateMany = (value) => polyEval(many12System.system[0], [[value, 0]])[0];
  let scannedCount = 0;
  let last = evaluateMany(1e-4);
  let lastPoint = 1e-4;
  for (let step = 1; step <= 200000; step += 1) {
    const point = step * 1e-5;
    const value = evaluateMany(point);
    if ((last < 0) !== (value < 0)) {
      let low = lastPoint;
      let high = point;
      for (let iteration = 0; iteration < 120; iteration += 1) {
        const middle = (low + high) / 2;
        if ((evaluateMany(low) < 0) !== (evaluateMany(middle) < 0)) high = middle; else low = middle;
      }
      const price = ((low + high) / 2) ** many12System.q;
      if (Math.abs(excessDemand(many12, [price, 1])[0]) < 1e-6) scannedCount += 1;
    }
    last = value;
    lastPoint = point;
  }
  check("degree-100 equilibria match a bisection scan",
    scannedCount === many12Solved.equilibria.length,
    `scan ${scannedCount} vs solver ${many12Solved.equilibria.length}`);

  // Independent cross-check: scan the univariate system by bisection and
  // confirm the homotopy solver found exactly the same equilibria.
  const { system, q } = buildEquilibriumSystem(multiple);
  const evaluate = (value) => polyEval(system[0], [[value, 0]])[0];
  const scanned = [];
  let previous = evaluate(1e-4);
  let previousPoint = 1e-4;
  for (let step = 1; step <= 300000; step += 1) {
    const point = step * 1e-5;
    const value = evaluate(point);
    if ((previous < 0) !== (value < 0)) {
      let low = previousPoint;
      let high = point;
      for (let iteration = 0; iteration < 120; iteration += 1) {
        const middle = (low + high) / 2;
        if ((evaluate(low) < 0) !== (evaluate(middle) < 0)) high = middle; else low = middle;
      }
      const price = ((low + high) / 2) ** q;
      if (Math.abs(excessDemand(multiple, [price, 1])[0]) < 1e-6) scanned.push(price);
    }
    previous = value;
    previousPoint = point;
  }
  check("bisection scan agrees on the count", scanned.length === many.equilibria.length,
    `scan ${scanned.length} vs solver ${many.equilibria.length}`);
  scanned.sort((a, b) => a - b).forEach((price, index) => {
    close(`bisection agrees on equilibrium ${index + 1}`, many.equilibria[index].prices[0], price, 1e-5);
  });
}

// --- sheaf cohomology --------------------------------------------------
section("sheaf cohomology");
{
  const ids = ["a", "b", "c"];
  const triangle = createSheaf(
    ids.map((id) => ({ id, dim: 1 })),
    [["a", "b"], ["b", "c"], ["c", "a"]].map(([source, target]) => ({
      source, target, dim: 1, source_map: [[1]], target_map: [[1]],
    })),
  );
  const triangleCohomology = cohomology(triangle);
  check("constant sheaf on a triangle: H^0 = 1", triangleCohomology.h0 === 1);
  check("constant sheaf on a triangle: H^1 = 1 (one cycle)", triangleCohomology.h1 === 1);
  check("global section is constant", globalSections(triangle).length === 1);

  // Log price ratios that close up around the loop are a coboundary.
  close("consistent ratios have no obstruction", decompose(triangle, [0.3, 0.2, -0.5]).obstructionNorm, 0, 1e-9);
  // A loop that does not close is an arbitrage of 0.15, spread evenly.
  close("arbitrage loop shows up in H^1", decompose(triangle, [0.3, 0.2, -0.35]).obstructionNorm,
    0.15 / Math.sqrt(3));

  // The obstruction is orthogonal to everything a district-level assignment
  // could produce, which is what makes it a cohomology class and not a residual.
  const split = decompose(triangle, [0.3, 0.2, -0.35]);
  const d = coboundary(triangle);
  const dot = matVec(d, [1, -2, 3]).reduce((sum, value, index) => sum + value * split.obstruction[index], 0);
  close("obstruction is orthogonal to the image of d", dot, 0, 1e-9);

  // Laplacian kernel is exactly H^0, and diffusion lands in it.
  const laplacianSpectrum = spectrum(triangle);
  check("kernel of the Laplacian is H^0", laplacianSpectrum.kernelDimension === triangleCohomology.h0);
  const flowed = diffuse(triangle, [1, -3, 5], { steps: 500 });
  close("diffusion converges to a global section", flowed.residual, 0, 1e-6);
  close("diffusion preserves the mean", (flowed.state[0] + flowed.state[1] + flowed.state[2]) / 3, 1, 1e-6);

  // Euler characteristic: h0 - h1 = dim C^0 - dim C^1, for any cellular sheaf.
  let state = 11;
  const random = () => { state = (state * 1103515245 + 12345) >>> 0; return state / 4294967296; };
  let eulerFailures = 0;
  for (let trial = 0; trial < 25; trial += 1) {
    const size = 3 + Math.floor(random() * 4);
    const stalk = 1 + Math.floor(random() * 2);
    const vertices = Array.from({ length: size }, (_, index) => ({ id: `v${index}`, dim: stalk }));
    const edges = [];
    for (let index = 0; index < size; index += 1) {
      for (let other = index + 1; other < size; other += 1) {
        if (random() > 0.5) continue;
        const map = () => Array.from({ length: stalk }, () =>
          Array.from({ length: stalk }, () => random() * 2 - 1));
        edges.push({ source: `v${index}`, target: `v${other}`, dim: stalk, source_map: map(), target_map: map() });
      }
    }
    if (edges.length === 0) continue;
    const sheaf = createSheaf(vertices, edges);
    const homology = cohomology(sheaf);
    if (homology.h0 - homology.h1 !== homology.dimC0 - homology.dimC1) eulerFailures += 1;
  }
  check("Euler characteristic holds on random sheaves", eulerFailures === 0, `${eulerFailures} failures`);

  // A sheaf with a non-trivial holonomy has no nonzero global section: the
  // local frames cannot be reconciled around the loop.
  const twisted = createSheaf(
    ids.map((id) => ({ id, dim: 1 })),
    [
      { source: "a", target: "b", dim: 1, source_map: [[1]], target_map: [[1]] },
      { source: "b", target: "c", dim: 1, source_map: [[1]], target_map: [[1]] },
      { source: "c", target: "a", dim: 1, source_map: [[2]], target_map: [[1]] },
    ],
  );
  check("holonomy kills the global sections", cohomology(twisted).h0 === 0);
}

// --- compositional game theory -----------------------------------------
section("compositional game theory");
{
  const play = (table) => ([left, right]) => table[`${left},${right}`];
  const simultaneous = (movesLeft, movesRight) =>
    tensor(decision({ name: "L", moves: movesLeft }), decision({ name: "R", moves: movesRight }));

  const prisoners = equilibria(simultaneous(["C", "D"], ["C", "D"]), [null, null],
    play({ "C,C": [3, 3], "C,D": [0, 5], "D,C": [5, 0], "D,D": [1, 1] }));
  check("prisoner's dilemma has one equilibrium", prisoners.length === 1);
  check("both defect", JSON.stringify(prisoners[0]) === JSON.stringify([["D"], ["D"]]));

  const stag = equilibria(simultaneous(["S", "H"], ["S", "H"]), [null, null],
    play({ "S,S": [4, 4], "S,H": [0, 3], "H,S": [3, 0], "H,H": [3, 3] }));
  check("stag hunt has two pure equilibria", stag.length === 2);

  const pennies = equilibria(simultaneous(["H", "T"], ["H", "T"]), [null, null],
    play({ "H,H": [1, -1], "H,T": [-1, 1], "T,H": [-1, 1], "T,T": [1, -1] }));
  check("matching pennies has no pure equilibrium", pennies.length === 0);

  // Entry deterrence: sequential composition computes Nash, and quantifying
  // over every observation instead of the realised one computes subgame
  // perfection. The difference is exactly the non-credible threat.
  const payoffs = { "Out,F": [0, 2], "Out,A": [0, 2], "In,F": [-1, -1], "In,A": [1, 1] };
  const continuation = ([move, response]) => payoffs[`${move},${response}`];
  const entrant = decision({ name: "Entrant", moves: ["In", "Out"] });
  const incumbent = decision({
    name: "Incumbent",
    moves: ["F", "A"],
    observations: ["In", "Out"],
    emit: (observation, move) => [observation, move],
    backward: (_observation, utility) => utility[0],
    payoff: (utility) => utility[1],
  });
  const nash = equilibria(sequential(entrant, incumbent), null, continuation);
  const perfect = equilibria(sequentialPerfect(entrant, incumbent, ["In", "Out"]), null, continuation);
  check("entry game has four Nash profiles", nash.length === 4, `got ${nash.length}`);
  check("subgame perfection removes the non-credible threat", perfect.length === 2, `got ${perfect.length}`);
  check("entry always happens under subgame perfection",
    perfect.every(([strategy]) => strategy[0] === "In"));
  check("the incumbent accommodates after entry",
    perfect.every(([, strategy]) => strategy[0] === "A"));
  check("deterrence survives as a Nash outcome",
    nash.some(([strategy]) => strategy[0] === "Out"));

  // Bicategory structure.
  const relay = (name, observations) =>
    decision({ name, moves: [0, 1], observations, backward: (_observation, utility) => utility });
  const [a, b, c, e] = [relay("a", [null]), relay("b", [0, 1]), relay("c", [0, 1]), relay("d", [0, 1])];
  const samples = [{ x: null, coutility: 2, continuation: (value) => value }];
  const assoc = associator(a, b, c);
  check("associator is a valid 2-cell", checkTwoCell(assoc, samples).valid);
  const sample = assoc.source.strategies[5];
  check("associator is not the identity",
    JSON.stringify(sample) !== JSON.stringify(assoc.map(sample)));
  check("pentagon coherence holds", pentagonHolds(a, b, c, e).holds);
  const interchangeCell = interchange(a, relay("b0", [null]), c, e);
  const tensorSamples = [{ x: [null, null], coutility: [1, 1], continuation: ([y, z]) => [y, z] }];
  check("interchange law holds", checkTwoCell(interchangeCell, tensorSamples).valid);
}

console.log(`\n${passed} checks passed, ${failures.length} failed`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
