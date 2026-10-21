# Algebraic geometry and higher category theory in economics

Short answer: yes, and for the most part economics got there first. Both
subjects already do load-bearing work in parts of economic theory, and neither
needs to be smuggled in as a metaphor. What is missing is usually not the
mathematics but a working implementation attached to real data, so this branch
adds one to the twin: three engines, each answering a question the others
cannot, all wired to St. Louis building stock and live feeds.

This document says what is established, what is built here, what the numbers
came out as, and where the whole approach stops earning its keep.

---

## 1. Algebraic geometry

### Where it already sits in economics

Equilibrium theory has been geometric since the 1970s. Debreu's *regular
economies* and the equilibrium-manifold programme (Balasko, Mas-Colell) are
differential topology applied to the excess-demand map. The properly *algebraic*
line is newer and sharper:

- **Semi-algebraic economies.** Kubler & Schmedders (2010) show that an
  Arrow-Debreu exchange economy with semi-algebraic preferences yields a square
  polynomial system with finitely many solutions, so equilibria can be computed
  by the machinery of computational algebraic geometry. For two goods and two
  CES agents they prove the number of competitive equilibria never exceeds
  three, and that multiplicity occupies only a tiny fraction of parameter space.
- **Nash equilibria are arbitrary varieties.** Datta (2003) proves that *every*
  real algebraic variety is isomorphic to the set of totally mixed Nash
  equilibria of some three-player game. Game theory does not restrict the
  geometry at all, so no structural theorem about equilibrium sets can be proved
  from strategic form alone.
- **Tropical geometry in auctions.** Baldwin & Klemperer (2019) analyse demand
  for indivisible goods by observing that the locus of price-indifference is a
  tropical hypersurface; their "demand types" classify when equilibrium exists.
  Tran & Yu develop the product-mix auction on the same footing.

### What is implemented here

`src/econ/exchange-economy.mjs` takes an exchange economy with CES preferences
and *rational* elasticities of substitution and reduces equilibrium to a
polynomial system, following the Kubler-Schmedders reduction. With prices
`p_i = y_i^q` for a common denominator `q`, the non-integer exponents clear and
the excess-demand equations become honest polynomials in `y`. Clearing
denominators glues the coordinate hyperplanes onto the variety, so
`polyStripMonomialFactor` divides them back out - they carry no economics, since
prices are strictly positive, and they are singular enough to wreck the solver.

Solving is then a root-finding problem, and the code dispatches on size:

- **One unknown** (two goods, any number of agents) goes to
  `src/econ/univariate.mjs`, an Aberth-Ehrlich solver. This is the case
  Kubler & Schmedders reduce to, and it is the common one.
- **Several unknowns** go to `src/econ/homotopy.mjs`, a total-degree homotopy
  continuation solver with a random gamma, an RK4 predictor, a Newton corrector
  that rejects steps it cannot converge, and a path-jumping guard.

Both return *every* isolated solution, which is the entire point. A local solver
tells you an equilibrium exists; this tells you how many there are.

### How we know the answers are right

Getting all solutions is a claim that can fail silently, so it is checked three
ways:

1. **The index theorem.** Dierker (1972): the indices `sign det(-DZ)` of a
   regular economy's equilibria sum to `+1`. Miss one and the sum breaks.
   `equilibriumIndex` computes it numerically and every result reports it.
2. **A completeness certificate.** A square system has at most Bezout-many
   isolated roots, so finding that many distinct roots proves none were missed.
3. **Brute force.** The test suite scans the univariate system by bisection at
   `1e-5` resolution and checks that the solver found exactly the same
   equilibria - including at degree 100.

The tests also reproduce the Kubler-Schmedders bound. Over 60 randomly drawn
2x2 CES economies in the region where multiplicity actually occurs, the solver
never returns more than three equilibria, never returns an even number, and
never violates the index theorem. Cobb-Douglas is checked against its closed
form.

Path tracking took three rounds of fixing to get here, which is worth recording
because each failure was invisible in the output:

- A Newton corrector that returned half-corrected iterates let two paths merge
  and silently lost an equilibrium. Convergence is now required, not hoped for.
- A first-order Euler predictor could not follow clustered roots; RK4 fixed it.
- Aberth initialised on the Cauchy bound overflowed a double at degree 100.
  The geometric-mean radius `|a_0/a_n|^(1/n)` starts in the middle of the roots
  instead.

---

## 2. Sheaves and higher category theory

### Where it already sits

This side is younger and thinner, and it is worth being straight about how thin.

- **Compositional game theory.** Ghani, Hedges, Winschel & Zahn (LICS 2018)
  introduce *open games*: games played relative to an environment, which compose
  sequentially and in parallel. They are the morphisms of a symmetric monoidal
  category, so economic models can be built from parts whose equilibria compose.
  Because composition multiplies strategy sets, associativity holds only up to
  canonical isomorphism - the structure is a **bicategory**, and that is
  currently the honest extent of "higher" category theory in economics. Bayesian
  open games (Bolt, Hedges & Zahn) extend it to incomplete information.
- **Cellular sheaves.** Hansen & Ghrist develop sheaf Laplacians and diffusion
  on cellular sheaves, applied to opinion dynamics on networks. The
  sheaf-theoretic treatment of contextuality (Abramsky & Brandenburger) is the
  same idea in a different field: local data that is consistent pairwise and
  inconsistent globally.
- **Sheaves in economics specifically.** This is active but young. Sarfo's
  *Sheaf-Theoretic General Equilibrium* (2025) develops equilibrium as gluing
  of local data with `H^1` as the obstruction; there is earlier work applying
  sheaves to Goodwin-type models with trade. Nothing here is claimed as novel
  mathematics.

### What is implemented here

`src/econ/sheaf.mjs` builds cellular sheaves on a graph and computes what they
are for:

```
C^0 = (+) F(v)        one local reading per district
C^1 = (+) F(e)        one comparison per link
(d x)_e = r_target x_target - r_source x_source

H^0 = ker d           price systems every link agrees with
H^1 = C^1 / im d      disagreements no price system can explain
```

Given observed link data `c`, `decompose` splits it as `c = d(potential) +
obstruction` with the obstruction orthogonal to the image. That obstruction is
the harmonic representative of a class in `H^1`, and its norm is a single number
saying how far the city is from admitting a consistent price system at all. In
the special case of scalar stalks and log price ratios, a nonzero class is
exactly an arbitrage loop - the tests check that a triangle with ratios summing
to `0.15` returns an obstruction of `0.15/sqrt(3)`.

`src/econ/open-games.mjs` implements open games with `play`, `coplay` and
`equilibrium`, sequential and monoidal composition, and the 2-cells. The
associator `((G;H);K) => (G;(H;K))` is constructed explicitly, checked to be a
valid 2-cell (same play, same coplay, same equilibria) and checked *not* to be
the identity on strategy profiles - which is the concrete reason a bicategory is
the right home. Pentagon coherence and the interchange law are verified as
finite equalities.

The economics falls out rather than being coded by hand. Sequential composition
computes Nash equilibria; requiring the second game to be optimal at *every*
observation rather than the realised one computes subgame perfection. The entry
deterrence test shows this directly: four Nash profiles, two of which are held
up by a threat the incumbent would never carry out, and the perfect version
removes exactly those. The Nash/subgame-perfect distinction turns out to be a
question of which contexts the equilibrium predicate quantifies over.

---

## 3. Results on the twin

`npm run econ` derives 12 districts on a 4x3 grid over the building bounding
box, with floor space from OpenStreetMap building footprints and heights, and
access from live transit positions discounted by incident load. Output goes to
`public/data/economy-feed.json`.

**Equilibrium.** Districts trade built space against access. At every elasticity
of substitution from 1.0 down to 0.1 the economy has exactly one competitive
equilibrium, the indices sum to `+1`, and the solver resolves all Bezout-many
roots - at the lowest elasticity that is a degree-100 polynomial. The relative
price of space sits at `0.994`-`1.000` throughout.

That is a negative result and it is the interesting kind. Multiplicity would
have meant the same building stock and the same transit service could support
more than one internally consistent configuration, making the city's current
state a matter of coordination rather than fundamentals. It does not, over the
range tested. The check is only meaningful because the solver finds *all*
equilibria; a local solver could not distinguish "one equilibrium" from "the one
I happened to land on".

**Sheaf.** 12 districts with 2-dimensional stalks and 17 links with
2-dimensional stalks give `dim C^0 = 24`, `dim C^1 = 34`, and

```
H^0 = 2     H^1 = 12     spectral gap 0.352     obstruction 39.1%
```

`H^0 = 2` says a two-parameter family of price systems is consistent with every
link. `H^1 = 12` counts the independent ways link data can fail to glue -
consistent with the Euler characteristic, `h0 - h1 = dim C^0 - dim C^1 = -10`.
The headline is the last number: **39.1% of the observed cross-boundary data
cannot be explained by any assignment of district-level prices**, and the feed
ranks which boundaries carry it. The cochain is measured on the boundaries
themselves - transit crossing each boundary band, incidents sitting on it - and
not derived from the district aggregates, because a cochain built from node data
is a coboundary by construction and its obstruction is zero for reasons that
have nothing to do with the city. That mistake was in the first version.

**Game.** A development game priced by the equilibrium above has three Nash
equilibria and one subgame-perfect equilibrium. The gap is the hold-up problem:
outcomes sustained by a zoning response the city would not actually choose.

---

## 4. Where this stops working

- **Complexity.** The Bezout number is the product of the total degrees, so cost
  grows exponentially in the number of goods. Two goods and a dozen agents is a
  degree-100 polynomial solved in about a second. Five goods would not finish.
  This is a tool for small, sharply posed markets, not a replacement for
  large-scale CGE models.
- **Semi-algebraic is a real restriction.** Elasticities must be rational, and
  are converted by continued fractions if given as floats. Plenty of standard
  preference specifications are not semi-algebraic at all, and production, taxes
  and incomplete markets are not handled here.
- **The sheaf is linear.** Stalks are vector spaces and restrictions are linear
  maps, so this captures log-linear price relations and nothing else. It is a
  cellular sheaf on a graph, not a sheaf on a topological space with a real
  site, and the district grid is an arbitrary 4x3 partition rather than a
  meaningful economic geography.
- **Higher category theory is the weakest leg.** The bicategorical structure of
  open games is genuine and it is verified here, but so far it mostly buys
  well-typed composition and sound string-diagram reasoning. No economic
  prediction in this repository depends on a 2-cell. Claims that economics needs
  `(infinity,1)`-categories should be treated as unsupported - the honest
  statement is that one level up from categories is currently doing real but
  modest work.
- **The St. Louis numbers are proxies.** Floor space from OSM heights, access
  from 83 transit vehicles and 83 incidents. These are demonstration indices,
  not prices, and nothing in `economy-feed.json` is a forecast. The mathematics
  is what is being demonstrated; the calibration is not serious.

## 5. What would make it serious

Assessor valuations and recorded transaction prices in place of the floor-space
proxy; observed rents per district as the sheaf's local readings and actual
cross-boundary trade or commute flows as the link data; census tract or ward
boundaries instead of a grid; and a production sector, which is where
multiplicity and coordination failure actually tend to live.

---

## Running it

```sh
npm run econ        # build public/data/economy-feed.json
npm run test:econ   # 63 checks: closed forms, theorems, category laws
```

## Files

| File | What it does |
| --- | --- |
| `src/econ/polynomial.mjs` | Complex arithmetic, multivariate polynomials, monomial stripping |
| `src/econ/univariate.mjs` | Aberth-Ehrlich: all roots of a univariate polynomial |
| `src/econ/homotopy.mjs` | Total-degree homotopy continuation for multivariate systems |
| `src/econ/exchange-economy.mjs` | CES economies, the semi-algebraic reduction, equilibrium index |
| `src/econ/linalg.mjs` | Rank, kernel, least squares, symmetric spectra |
| `src/econ/sheaf.mjs` | Cellular sheaves, coboundary, Laplacian, cohomology, obstructions |
| `src/econ/open-games.mjs` | Open games, composition, 2-cells, coherence laws |
| `scripts/build-economic-layer.mjs` | The pipeline over St. Louis data |
| `scripts/test-econ.mjs` | The test suite |

## References

- Abramsky, S. & Brandenburger, A. (2011). The sheaf-theoretic structure of
  non-locality and contextuality. *New Journal of Physics* 13.
- Baldwin, E. & Klemperer, P. (2019). Understanding preferences: "demand types",
  and the existence of equilibrium with indivisibilities. *Econometrica* 87.
- Balasko, Y. (1988). *Foundations of the Theory of General Equilibrium*.
- Bolt, J., Hedges, J. & Zahn, P. (2019). Bayesian open games.
  arXiv:1910.03656.
- Datta, R. S. (2003). Universality of Nash equilibria. *Mathematics of
  Operations Research* 28(3), 424-432.
- Debreu, G. (1970). Economies with a finite set of equilibria.
  *Econometrica* 38.
- Dierker, E. (1972). Two remarks on the number of equilibria of an economy.
  *Econometrica* 40.
- Ghani, N., Hedges, J., Winschel, V. & Zahn, P. (2018). Compositional game
  theory. *LICS '18*, 472-481.
- Hansen, J. & Ghrist, R. (2019). Toward a spectral theory of cellular sheaves.
  *Journal of Applied and Computational Topology* 3.
- Hansen, J. & Ghrist, R. (2021). Opinion dynamics on discourse sheaves.
  arXiv:2005.12798.
- Kubler, F. & Schmedders, K. (2010). Competitive equilibria in semi-algebraic
  economies. *Journal of Economic Theory* 145(1), 301-330.
- Mas-Colell, A. (1985). *The Theory of General Economic Equilibrium: A
  Differentiable Approach*.
- Sarfo, E. A. (2025). Sheaf-Theoretic General Equilibrium. SSRN 5340069.
- Tran, N. M. & Yu, J. (2019). Product-mix auctions and tropical geometry.
  *Mathematics of Operations Research* 44.
