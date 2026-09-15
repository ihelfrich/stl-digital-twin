# Grounded quantities

A way to state a quantitative relationship between two real things and then find
out whether to believe it.

The previous layer in this repository had the opposite balance: exact
mathematics resting on invented indices. Its "floor space" was computed for
38,570 buildings from a height field that 165 of them actually carry, and
nothing in the output said so. This layer exists so that cannot happen quietly
again.

Nothing here is novel statistics. What it adds is that the checks are *attached
to the claim* and run every time, and that a claim which fails them is published
with the failure rather than dropped.

---

## The shape of a claim

A relation names two observables, a functional form, the dimension its
coefficient must carry, and the value of that coefficient that would mean
"nothing is going on":

```js
relation({
  id: "storey-height",
  statement: "Building height rises linearly with storey count.",
  form: "linear",                  // or "log-linear", "log-log"
  response: heightObservable,      // metres, from properties.height
  predictor: levelsObservable,     // dimensionless, from building:levels
  nullSlope: 0,
  comparisons: [{ label: "the 3.2 m/storey constant in this repo", value: 3.2 }],
});
```

`ground()` then runs seven checks and returns `grounded`, `qualified` or
`rejected` along with every check's result. The middle verdict matters: an
effect can be decisively real and still explain almost nothing, and collapsing
that into "rejected" throws away a finding.

### The checks

| Check | What it catches |
| --- | --- |
| dimensional-coherence | Units that do not balance; logs of dimensioned quantities |
| provenance-coverage | Relationships that describe an imputation rule rather than the world |
| sample-size | Too little data to say anything |
| out-of-sample-skill | Curves fitted to points they have already seen |
| null-rejected | Patterns no better than shuffled data |
| interval-excludes-null | Effects whose interval contains "no effect" |
| residual-independence | Ordered data faking precision through autocorrelation |

Fatal failures are: the null not rejected, the interval containing the null, too
few points, or predicting worse than the mean. Everything else qualifies a
result rather than killing it.

### Dimensions are checked, not assumed

`src/quant/dimension.mjs` carries the seven SI base dimensions plus currency,
which economics needs and which is genuinely independent of the rest. Adding a
length to a time throws. Scaling a temperature in degrees Celsius throws,
because 20 degC times two is not a temperature.

The check that earns its keep in empirical work is narrower: **you may only take
the logarithm of a pure number.** `log(area)` is not a quantity. What is meant
is `log(area / A0)`, and the `A0` you chose silently ends up inside the
intercept. So a logged relation must name its reference scale, and the
coefficient's dimension is then derived from the form rather than asserted - a
log-linear slope carries inverse length, a log-log slope is dimensionless, and
a linear slope carries response over predictor.

### Provenance travels with the numbers

An observable records, per record, whether each value was read from the source
or produced by a rule, and reports coverage. A relation over imputed values is
not thereby wrong, but it is a statement about the imputation, and the gate says
so. The test suite includes a perfectly-fitting relationship built entirely from
imputed values; it is not grounded.

---

## What the St. Louis data actually supports

`npm run relations` writes `public/data/relations-feed.json`. Footprint polygons
are real surveyed geometry for all 38,570 buildings, so areas and positions are
measurements. Height is tagged on 0.43% and storey count on 7.73%, so relations
involving those run on that subset and say which.

### GROUNDED: 3.85 metres per storey

```
slope 3.846 m/storey   95% CI [3.512, 4.284]   n = 99   out-of-sample R2 = 0.907
```

Fitted on the buildings carrying both a tagged height and a tagged storey count.
Every check passes.

**This repository hard-codes 3.2 m/storey, which is outside the interval.**
`scripts/build-economic-layer.mjs` now uses the estimated value and records the
interval; `src/app.js` and `scripts/build-render-dataset.mjs` still use 3.2 and
were left alone, because changing them changes what the map looks like and that
should be a deliberate decision rather than a side effect.

The caveat is selection, not statistics: buildings tagged with both fields are
disproportionately large and notable, so this is a calibration for that subset.
A residential-only estimate would likely be lower.

### QUALIFIED: the density gradient, and a result that was not real

The first version of this analysis found Clark's exponential density gradient at
0.324 per km with R2 = 0.90 - a textbook result, and wrong. The building extract
is a rectangle, so annuli past about 2.6 km from the centre are clipped by the
bounding box. Dividing built area by the full annulus area understates density
at large radius and manufactures a decline that is a property of the download.

Correcting each ring for the fraction of it inside the bounding box:

| Method | Gradient per km | R2 |
| --- | --- | --- |
| Not corrected for clipping | 0.324 | 0.902 |
| Coverage-corrected, full circle | 0.150 | 0.350 |
| Coverage-corrected, western half only | 0.110 | 0.568 |

Most of the effect was the artefact. What survives is real - the interval
excludes zero and the permutation null is rejected - but it fails the
residual-independence check (lag-1 autocorrelation 0.69), so the interval is
narrower than it should be.

Splitting the profile shows why an exponential fits poorly:

| Range | Gradient per km | R2 |
| --- | --- | --- |
| 0 - 1.5 km | 1.077 | 0.835 |
| 1.5 - 6 km | -0.030 | 0.075 |

St. Louis has a dense core and then a **plateau**, not an exponential decline.
An exponential fitted across both averages two regimes.

The centre is a modelling choice rather than a measurement, and it matters:

| Centre | Gradient per km | R2 |
| --- | --- | --- |
| Old Courthouse | 0.150 | 0.350 |
| Gateway Arch | -0.063 | 0.056 |
| Built-area centroid within 3 km | 0.188 | 0.622 |

The Arch sits on the riverfront, so rings around it are half water and half
Illinois. A gradient that changes sign with a 900 m shift in an arbitrary
reference point should not be reported as a single number, and the feed reports
all three.

### QUALIFIED: storey count against footprint area

```
exponent 0.197   95% CI [0.180, 0.214]   n = 2971   out-of-sample R2 = 0.166
```

Real - the null is rejected decisively - and weak. Footprint area explains about
a sixth of the variation in storey count. Worth recording, not worth predicting
from.

### REJECTED: the negative control

Footprint area against a seeded pseudo-random number, run through exactly the
same machinery: out-of-sample R2 of -0.000, permutation p = 0.39, interval
spanning zero. It has to come out this way for any of the above to mean
anything, which is why it is in the feed rather than only in the tests.

### The footprint area tail

A rank-size regression on these areas returns R2 = 0.97. That number is close to
meaningless: ranks are a monotone transform of the sorted values, so the log-log
plot is smooth whatever the distribution. Maximum likelihood after Clauset,
Shalizi and Newman instead:

```
alpha = 1.98 above 184 m^2   tail n = 10,223   KS goodness-of-fit p = 0.00
versus exponential: favours the power law (z = 22.2)
```

So: much more power-law-like than exponential, but the goodness-of-fit test
rejects a pure power law outright. The honest description is a heavy right tail
that is not a clean power law - which is the usual finding, and is invisible to
the rank-size regression that started at R2 = 0.97.

Note the two p-values run in opposite directions. The permutation p is small
when there *is* something; the KS goodness-of-fit p is small when the model is
*rejected*. Both are in the feed and both are labelled.

---

## What this does not do

- **Two variables at a time.** No multiple regression, so no controlling for a
  confounder. The centre-sensitivity table is a stand-in for that and a weak
  one.
- **Association, not causation.** Nothing here identifies a causal effect. There
  is no instrument, no discontinuity, no panel. "Grounded" means the association
  survives the checks, which is a much smaller claim.
- **Independence is assumed where it is not true.** Buildings near each other
  are not independent draws, so the bootstrap intervals on the building-level
  relations are too narrow. The residual-independence check catches this for
  ordered data only; there is no spatial block bootstrap.
- **One city, one snapshot.** Cross-city scaling laws need many cities. The
  transit and incident feeds are single instants, which is why no relation here
  uses them - 83 vehicles at one moment is not a measurement of a transport
  system.
- **OpenStreetMap is not a survey.** Coverage is uneven and tagging is
  voluntary. The 0.43% height coverage is the visible part of that; the
  invisible part is that which buildings get tagged is not random.

## Running it

```sh
npm run relations    # writes public/data/relations-feed.json
npm run test:quant   # 69 checks
npm test             # both suites
```

## Files

| File | What it does |
| --- | --- |
| `src/quant/dimension.mjs` | Base dimensions, units, dimensional algebra |
| `src/quant/quantity.mjs` | Values with units and uncertainty; the log-of-a-ratio gate |
| `src/quant/observable.mjs` | Measured series that carry provenance and coverage |
| `src/quant/estimate.mjs` | OLS, bootstrap, cross-validation, permutation, power-law MLE, Vuong |
| `src/quant/relation.mjs` | Relation specs and the grounding gate |
| `scripts/build-relations.mjs` | The pipeline over St. Louis buildings |
| `scripts/test-quant.mjs` | The test suite, including the gate's negative controls |

## References

- Clark, C. (1951). Urban population densities. *Journal of the Royal
  Statistical Society A* 114.
- Clauset, A., Shalizi, C. R. & Newman, M. E. J. (2009). Power-law distributions
  in empirical data. *SIAM Review* 51(4), 661-703.
- Vuong, Q. H. (1989). Likelihood ratio tests for model selection and
  non-nested hypotheses. *Econometrica* 57(2), 307-333.
