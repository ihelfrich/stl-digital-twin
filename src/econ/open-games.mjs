// Compositional game theory: open games as the morphisms of a symmetric
// monoidal bicategory (Ghani, Hedges, Winschel & Zahn, LICS 2018).
//
// A closed game is a single object you either solve or do not. An *open* game
// is a game played relative to an environment, so it can be plugged into other
// games. An open game G : (X, S) -> (Y, R) carries
//
//   strategies   a set of strategy profiles
//   play         strategies x X -> Y          information flowing forwards
//   coplay       strategies x X x R -> S      utility flowing backwards
//   equilibrium  X x (Y -> R) -> P(strategies)  best responses to a continuation
//
// The forward/backward pair is a lens; the equilibrium predicate is what makes
// it a game rather than a data structure. Two open games compose sequentially
// (one moves after the other) and in parallel (they move simultaneously), and
// the equilibria of a composite are computed from the parts. That is the whole
// point: economic models built out of pieces whose solutions also compose.
//
// Composition multiplies strategy sets, so (Sg x Sh) x Sk and Sg x (Sh x Sk)
// are isomorphic rather than equal. Associativity therefore holds only up to a
// canonical invertible 2-cell, the associator, which is precisely why the
// right home for open games is a bicategory and not a category. The associator
// and the coherence law it must satisfy are built and checked below.

const key = (value) => JSON.stringify(value ?? null);

/**
 * A single agent choosing a move, possibly conditioned on what it observes.
 *
 * Its strategies are functions from observations to moves, enumerated over the
 * finite observation set. `emit` says what the game reports forward, `backward`
 * says what it hands back to whoever played before it, and `payoff` picks this
 * agent's own component out of whatever utility the environment returns.
 */
export function decision({
  name,
  moves,
  observations = [null],
  emit = (observation, move) => move,
  backward = () => null,
  payoff = (utility) => utility,
}) {
  const strategies = [];
  const build = (prefix) => {
    if (prefix.length === observations.length) {
      strategies.push([...prefix]);
      return;
    }
    for (const move of moves) build([...prefix, move]);
  };
  build([]);

  const choose = (strategy, observation) => {
    const index = observations.findIndex((candidate) => key(candidate) === key(observation));
    if (index < 0) throw new Error(`${name}: unexpected observation ${key(observation)}`);
    return strategy[index];
  };

  return {
    name,
    strategies,
    play: (strategy, observation) => emit(observation, choose(strategy, observation)),
    coplay: (strategy, observation, utility) => backward(observation, utility),
    equilibrium: (observation, continuation) => {
      const best = Math.max(
        ...moves.map((move) => payoff(continuation(emit(observation, move)))),
      );
      return strategies.filter(
        (strategy) => payoff(continuation(emit(observation, choose(strategy, observation)))) >= best - 1e-12,
      );
    },
  };
}

/** The identity open game on (X, S): pass everything straight through. */
export function identityGame(name = "id") {
  return {
    name,
    strategies: [null],
    play: (_strategy, x) => x,
    coplay: (_strategy, _x, r) => r,
    equilibrium: () => [null],
  };
}

/** Sequential composition G ; H, written left to right: G moves, then H. */
export function sequential(first, second) {
  return {
    name: `(${first.name} ; ${second.name})`,
    strategies: first.strategies.flatMap((a) => second.strategies.map((b) => [a, b])),
    play: ([a, b], x) => second.play(b, first.play(a, x)),
    coplay: ([a, b], x, r) => first.coplay(a, x, second.coplay(b, first.play(a, x), r)),
    equilibrium: (x, continuation) => {
      const result = [];
      for (const a of first.strategies) {
        for (const b of second.strategies) {
          // The second game best-responds to what the first actually played,
          // while the first best-responds to the utility the second hands back
          // for every move it might have made. That is backward induction,
          // falling out of the definition rather than coded by hand.
          const secondBest = second.equilibrium(first.play(a, x), continuation);
          if (!secondBest.some((candidate) => key(candidate) === key(b))) continue;
          const induced = (y) => second.coplay(b, y, continuation(second.play(b, y)));
          const firstBest = first.equilibrium(x, induced);
          if (!firstBest.some((candidate) => key(candidate) === key(a))) continue;
          result.push([a, b]);
        }
      }
      return result;
    },
  };
}

/** Monoidal product G (x) H: both games run side by side, simultaneously. */
export function tensor(left, right) {
  return {
    name: `(${left.name} (x) ${right.name})`,
    strategies: left.strategies.flatMap((a) => right.strategies.map((b) => [a, b])),
    play: ([a, b], [x, y]) => [left.play(a, x), right.play(b, y)],
    coplay: ([a, b], [x, y], [r, s]) => [left.coplay(a, x, r), right.coplay(b, y, s)],
    equilibrium: ([x, y], continuation) => {
      const result = [];
      for (const a of left.strategies) {
        for (const b of right.strategies) {
          const leftBest = left.equilibrium(x, (u) => continuation([u, right.play(b, y)])[0]);
          if (!leftBest.some((candidate) => key(candidate) === key(a))) continue;
          const rightBest = right.equilibrium(y, (v) => continuation([left.play(a, x), v])[1]);
          if (!rightBest.some((candidate) => key(candidate) === key(b))) continue;
          result.push([a, b]);
        }
      }
      return result;
    },
  };
}

/**
 * Sequential composition that additionally demands the second game be optimal
 * at *every* observation it might have received, not only the one the first
 * game actually produced.
 *
 * This is the whole Nash / subgame-perfect distinction, and in the open-games
 * setting it is structural rather than a separate refinement bolted on: the
 * question is simply which contexts the equilibrium predicate quantifies over.
 * Plain `sequential` quantifies over the realised context and so admits
 * non-credible threats off the equilibrium path; this one does not.
 */
export function sequentialPerfect(first, second, observations) {
  const base = sequential(first, second);
  return {
    ...base,
    name: `(${first.name} ;* ${second.name})`,
    equilibrium: (x, continuation) =>
      base.equilibrium(x, continuation).filter(([, b]) =>
        observations.every((observation) =>
          second.equilibrium(observation, continuation).some((candidate) => key(candidate) === key(b)),
        ),
      ),
  };
}

export function equilibria(game, x, continuation) {
  return game.equilibrium(x, continuation);
}

// --- 2-cells -----------------------------------------------------------
//
// A 2-cell between open games with the same boundary is a map of strategy
// profiles that leaves the observable behaviour alone: same play, same coplay,
// and the same set of equilibria before and after. These are the morphisms
// that turn a category of games into a bicategory of games.

export function twoCell(source, target, map, name = "2-cell") {
  return { name, source, target, map };
}

/**
 * Check that a candidate 2-cell really is one, on the given test data.
 * This is a finite check over sampled inputs and continuations, not a proof,
 * but it is enough to catch a plumbing error in a composite.
 */
export function checkTwoCell(cell, samples) {
  const failures = [];
  for (const strategy of cell.source.strategies) {
    const image = cell.map(strategy);
    for (const { x, coutility, continuation } of samples) {
      if (key(cell.source.play(strategy, x)) !== key(cell.target.play(image, x))) {
        failures.push({ reason: "play", strategy, x });
      }
      if (key(cell.source.coplay(strategy, x, coutility)) !== key(cell.target.coplay(image, x, coutility))) {
        failures.push({ reason: "coplay", strategy, x });
      }
      if (continuation) {
        const inSource = cell.source.equilibrium(x, continuation).some((c) => key(c) === key(strategy));
        const inTarget = cell.target.equilibrium(x, continuation).some((c) => key(c) === key(image));
        if (inSource !== inTarget) failures.push({ reason: "equilibrium", strategy, x });
      }
    }
  }
  return { valid: failures.length === 0, failures };
}

/**
 * The associator ((G;H);K) => (G;(H;K)). Its existence, and the fact that it
 * is not the identity, is the concrete reason open games form a bicategory:
 * strategy profiles are re-bracketed, the behaviour is unchanged.
 */
export function associator(first, second, third) {
  return twoCell(
    sequential(sequential(first, second), third),
    sequential(first, sequential(second, third)),
    ([[a, b], c]) => [a, [b, c]],
    "associator",
  );
}

/** The same re-bracketing for the monoidal product. */
export function tensorAssociator(first, second, third) {
  return twoCell(
    tensor(tensor(first, second), third),
    tensor(first, tensor(second, third)),
    ([[a, b], c]) => [a, [b, c]],
    "tensor-associator",
  );
}

/**
 * The interchange law: running (G (x) H) then (G' (x) H') is the same as
 * running (G ; G') alongside (H ; H'). This is the law that makes string
 * diagrams of economic models unambiguous - it says you may read a diagram
 * either by columns or by rows and get the same game.
 */
export function interchange(first, second, third, fourth) {
  return twoCell(
    sequential(tensor(first, second), tensor(third, fourth)),
    tensor(sequential(first, third), sequential(second, fourth)),
    ([[a, b], [c, d]]) => [[a, c], [b, d]],
    "interchange",
  );
}

/**
 * Pentagon coherence for the associator on four composable games: the two ways
 * of re-bracketing a fourfold composite agree. Bicategory axioms are exactly
 * this kind of statement, and here it is a finite, checkable equality.
 */
export function pentagonHolds(first, second, third, fourth) {
  const left = (profile) => {
    const [[[a, b], c], d] = profile;
    return [a, [b, [c, d]]];
  };
  const right = (profile) => {
    const [[[a, b], c], d] = profile;
    // (((G;H);K);L) => ((G;(H;K));L) => (G;((H;K);L)) => (G;(H;(K;L)))
    const step1 = [[a, [b, c]], d];
    const [ab, dd] = step1;
    const step2 = [ab[0], [ab[1], dd]];
    return [step2[0], [step2[1][0][0], [step2[1][0][1], step2[1][1]]]];
  };
  const composite = sequential(sequential(sequential(first, second), third), fourth);
  const mismatches = composite.strategies.filter(
    (profile) => key(left(profile)) !== key(right(profile)),
  );
  return { holds: mismatches.length === 0, mismatches };
}
