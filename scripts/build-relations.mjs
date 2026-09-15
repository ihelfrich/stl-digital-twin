// Estimate quantitative relationships in the St. Louis data, and report for
// each one whether it survives the grounding checks.
//
// Only relationships between things actually measured in the source data are
// attempted. The building footprint polygons are real surveyed geometry for all
// 38,570 records, so areas and positions are measurements. Heights and storey
// counts are tagged for a small minority, so relations involving them run on
// that subset and say so. Nothing here imputes a value and then treats it as
// data - which is what the first economic layer did.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { UNITS } from "../src/quant/dimension.mjs";
import { quantity } from "../src/quant/quantity.mjs";
import { derived, extract, measuredOnly, summarize, values } from "../src/quant/observable.mjs";
import { ground, relation } from "../src/quant/relation.mjs";
import { compareTailModels, powerLawTail, seededRandom } from "../src/quant/estimate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const dataDir = resolve(projectRoot, "public/data");

const METRES_PER_DEGREE_LAT = 111_320;
const SOURCE = "public/data/stl-buildings.geojson (OpenStreetMap via Overpass)";

function metresPerDegreeLon(latitude) {
  return METRES_PER_DEGREE_LAT * Math.cos((latitude * Math.PI) / 180);
}

function ringArea(ring, referenceLat) {
  const scaleX = metresPerDegreeLon(referenceLat);
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    sum += (x1 * scaleX) * (y2 * METRES_PER_DEGREE_LAT) - (x2 * scaleX) * (y1 * METRES_PER_DEGREE_LAT);
  }
  return Math.abs(sum) / 2;
}

function ringCentroid(ring) {
  let lon = 0;
  let lat = 0;
  for (const coordinate of ring) {
    lon += coordinate[0];
    lat += coordinate[1];
  }
  return [lon / ring.length, lat / ring.length];
}

function parseHeightMetres(value) {
  if (value === null || value === undefined) return Number.NaN;
  const text = String(value).trim().toLowerCase();
  const number = Number.parseFloat(text.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(number) || number <= 0) return Number.NaN;
  if (text.includes("ft") || text.includes("feet") || text.includes("'")) return number * 0.3048;
  return number;
}

function loadBuildings(geojson) {
  const rows = [];
  for (const feature of geojson.features) {
    const ring = feature.geometry?.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length < 4) continue;
    const [lon, lat] = ringCentroid(ring);
    const area = ringArea(ring, lat);
    if (!Number.isFinite(area) || area <= 1) continue;
    rows.push({
      id: feature.properties?.osm_id,
      lon,
      lat,
      area,
      height: parseHeightMetres(feature.properties?.height),
      levels: Number.parseFloat(String(feature.properties?.["building:levels"] ?? "")),
      type: feature.properties?.building ?? "yes",
    });
  }
  return rows;
}

/**
 * Fraction of an annulus that lies inside the data bounding box.
 *
 * Without this the density gradient is mostly an artefact: the building extract
 * is a rectangle, so rings past about 2.6 km are clipped, and dividing built
 * area by the full annulus area manufactures a decline that is a property of
 * the download rather than of the city. Estimated on a deterministic polar
 * grid, which is exact enough at this resolution and does not add noise the way
 * Monte Carlo would.
 */
function annulusCoverage(centre, inner, outer, bounds, radialSteps = 24, angularSteps = 360, sector = null) {
  const [centreLon, centreLat] = centre;
  const [sectorStart, sectorEnd] = sector ?? [-Math.PI, Math.PI];
  let inside = 0;
  let total = 0;
  for (let radialStep = 0; radialStep < radialSteps; radialStep += 1) {
    const radius = inner + ((outer - inner) * (radialStep + 0.5)) / radialSteps;
    // Weight by radius: equal-angle cells at larger radius cover more area.
    const weight = radius;
    for (let angularStep = 0; angularStep < angularSteps; angularStep += 1) {
      const angle = sectorStart + ((sectorEnd - sectorStart) * angularStep) / angularSteps;
      const lat = centreLat + (radius * Math.sin(angle)) / METRES_PER_DEGREE_LAT;
      const lon = centreLon + (radius * Math.cos(angle)) / metresPerDegreeLon(centreLat);
      total += weight;
      if (lon >= bounds.west && lon <= bounds.east && lat >= bounds.south && lat <= bounds.north) {
        inside += weight;
      }
    }
  }
  return total === 0 ? 0 : inside / total;
}

/**
 * Built footprint area per unit of land, by distance from a chosen centre,
 * corrected for the bounding box. Rings whose coverage is too low are dropped
 * rather than rescaled: a ring seen through a 20% window is not a measurement
 * of that ring.
 */
function densityProfile(rows, centre, bounds, options = {}) {
  const {
    ringWidth = 250, maxRadius = 6000, minCoverage = 0.35,
    // A half-plane away from the river, for when the bounding-box correction's
    // assumption - that unobserved area resembles observed area - would
    // otherwise be applied across the Mississippi.
    sector = null,
    correctCoverage = true,
  } = options;
  const [centreLon, centreLat] = centre;
  const scaleX = metresPerDegreeLon(centreLat);
  const [sectorStart, sectorEnd] = sector ?? [-Math.PI, Math.PI];
  const sectorSpan = sectorEnd - sectorStart;
  const totals = new Map();
  for (const row of rows) {
    const dx = (row.lon - centreLon) * scaleX;
    const dy = (row.lat - centreLat) * METRES_PER_DEGREE_LAT;
    const distance = Math.hypot(dx, dy);
    if (distance > maxRadius) continue;
    if (sector) {
      let angle = Math.atan2(dy, dx);
      if (angle < sectorStart) angle += 2 * Math.PI;
      if (angle < sectorStart || angle > sectorEnd) continue;
    }
    const index = Math.floor(distance / ringWidth);
    totals.set(index, (totals.get(index) ?? 0) + row.area);
  }
  const profile = [];
  for (const [index, built] of [...totals.entries()].sort((a, b) => a[0] - b[0])) {
    const inner = index * ringWidth;
    const outer = inner + ringWidth;
    const coverage = correctCoverage
      ? annulusCoverage(centre, inner, outer, bounds, 24, 360, sector)
      : 1;
    if (coverage < minCoverage) continue;
    const land = (sectorSpan / 2) * (outer ** 2 - inner ** 2) * coverage;
    if (land <= 0 || built <= 0) continue;
    profile.push({
      midpoint: (inner + outer) / 2,
      builtArea: built,
      landArea: land,
      coverage,
      density: built / land,
    });
  }
  return profile;
}

/** Slope of log(density) on radius, in units of per kilometre (sign flipped). */
function gradientPerKm(profile) {
  if (profile.length < 4) return null;
  const xs = profile.map((ring) => ring.midpoint);
  const ys = profile.map((ring) => Math.log(ring.density));
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let index = 0; index < xs.length; index += 1) {
    sxy += (xs[index] - meanX) * (ys[index] - meanY);
    sxx += (xs[index] - meanX) ** 2;
  }
  const slope = sxy / sxx;
  let sse = 0;
  let sst = 0;
  for (let index = 0; index < xs.length; index += 1) {
    sse += (ys[index] - (meanY - slope * meanX) - slope * xs[index]) ** 2;
    sst += (ys[index] - meanY) ** 2;
  }
  return { gradientPerKm: -slope * 1000, r2: sst === 0 ? 0 : 1 - sse / sst, rings: xs.length };
}

function report(result) {
  const mark = { grounded: "GROUNDED", qualified: "QUALIFIED", rejected: "REJECTED" }[result.verdict];
  console.log(`\n[${mark}] ${result.id}`);
  console.log(`  ${result.statement}`);
  if (result.estimate) {
    const { slope, slopeCI, slopeUnit, outOfSampleR2, n } = result.estimate;
    console.log(`  slope ${slope.toPrecision(4)} [${slopeCI[0].toPrecision(4)}, ${slopeCI[1].toPrecision(4)}] `
      + `${slopeUnit}   n=${n}  out-of-sample R2=${Number.isFinite(outOfSampleR2) ? outOfSampleR2.toFixed(3) : "n/a"}`);
  }
  for (const check of result.checks ?? []) {
    console.log(`    ${check.passed ? "pass" : "FAIL"}  ${check.name}: ${check.detail}`);
  }
  for (const comparison of result.comparisons ?? []) {
    console.log(`    note  ${comparison.label} = ${comparison.value}: `
      + `${comparison.insideInterval ? "inside" : "OUTSIDE"} the interval`);
  }
}

async function main() {
  const geojson = JSON.parse(await readFile(resolve(dataDir, "stl-buildings.geojson"), "utf8"));
  const bounds = geojson.metadata?.bounds
    ?? { south: 38.585, west: -90.305, north: 38.675, east: -90.155 };
  const rows = loadBuildings(geojson);

  // Downtown St. Louis, near the Old Courthouse. The gradient is re-estimated
  // from other plausible centres below, because "distance from the centre"
  // is only as well defined as the centre is.
  const centre = [-90.1928, 38.627];

  const results = [];

  // --- 1. Storey height -------------------------------------------------
  // Both fields are tagged rather than derived, so this is a calibration of
  // one measurement against another, on the records that carry both.
  const paired = rows.filter((row) => Number.isFinite(row.height) && Number.isFinite(row.levels)
    && row.height > 0 && row.levels > 0 && row.levels <= 60);
  const heightObservable = extract({
    name: "building height",
    symbol: "h",
    unit: UNITS.metre,
    source: SOURCE,
    field: "properties.height",
    method: "tagged height, feet converted to metres",
    records: paired,
    read: (row) => ({ value: row.height, measured: true, id: row.id }),
  });
  const levelsObservable = extract({
    name: "storey count",
    symbol: "L",
    unit: UNITS.one,
    source: SOURCE,
    field: "properties.building:levels",
    method: "tagged storey count",
    records: paired,
    read: (row) => ({ value: row.levels, measured: true, id: row.id }),
  });
  results.push(ground(relation({
    id: "storey-height",
    statement: "Building height rises linearly with storey count; the slope is metres per storey.",
    form: "linear",
    response: heightObservable,
    predictor: levelsObservable,
    nullSlope: 0,
    ordered: false,
    note: "Buildings carrying both tags are disproportionately large and notable, "
      + "so this is a calibration for that subset rather than for the whole stock.",
    comparisons: [{ label: "the 3.2 m/storey constant hard-coded in this repository", value: 3.2 }],
  })));

  // --- 2. Clark's density gradient --------------------------------------
  const profile = densityProfile(rows, centre, bounds);
  const densityObservable = derived({
    name: "built footprint density",
    symbol: "D",
    unit: UNITS.one,
    source: SOURCE,
    method: "footprint area summed over 250 m rings out to 6 km, divided by annulus "
      + "land area corrected for bounding-box coverage; rings below 35% coverage dropped",
    values: profile.map((ring) => ring.density),
  });
  const radiusObservable = derived({
    name: "distance from centre",
    symbol: "r",
    unit: UNITS.metre,
    source: "ring midpoints, centre at 38.6270 N 90.1928 W",
    method: "geometric",
    values: profile.map((ring) => ring.midpoint),
  });
  results.push(ground(relation({
    id: "clark-density-gradient",
    statement: "Built footprint density declines exponentially with distance from the centre "
      + "(Clark 1951). The slope is the gradient in inverse metres.",
    form: "log-linear",
    response: densityObservable,
    predictor: radiusObservable,
    responseReference: quantity(1, UNITS.one),
    nullSlope: 0,
    ordered: true,
    note: "The profile is not actually exponential: density falls sharply inside about "
      + "1.5 km and is roughly flat from there out to 6 km. An exponential fitted across "
      + "the whole range averages two different regimes, which is why it predicts poorly. "
      + "See profileStructure.",
  })));

  // The correction matters more than the fit does, so it is reported
  // explicitly: the uncorrected version of this gradient looks far better and
  // is an artefact of the extract's rectangular bounding box.
  const methodSensitivity = [
    { method: "coverage-corrected, full circle (used above)", ...gradientPerKm(profile) },
    {
      method: "NOT corrected for bounding-box clipping",
      ...gradientPerKm(densityProfile(rows, centre, bounds,
        { correctCoverage: false, maxRadius: 9000, minCoverage: 0 })),
      warning: "Rings past about 2.6 km are clipped by the extract's rectangle, so their "
        + "land area is overstated and most of the apparent decline is manufactured.",
    },
    {
      method: "coverage-corrected, western half only (avoids the river)",
      ...gradientPerKm(densityProfile(rows, centre, bounds,
        { sector: [Math.PI / 2, (3 * Math.PI) / 2], minCoverage: 0.5, maxRadius: 7000 })),
    },
  ];

  // Core and plateau fitted separately, which is what the profile looks like.
  const profileStructure = {
    inner: { range: "0-1.5 km", ...gradientPerKm(profile.filter((ring) => ring.midpoint < 1500)) },
    outer: { range: "1.5-6 km", ...gradientPerKm(profile.filter((ring) => ring.midpoint >= 1500)) },
  };

  // Centre choice is a modelling decision, not a measurement, so vary it.
  const innerRows = rows.filter((row) => {
    const dx = (row.lon - centre[0]) * metresPerDegreeLon(centre[1]);
    const dy = (row.lat - centre[1]) * METRES_PER_DEGREE_LAT;
    return Math.hypot(dx, dy) < 3000;
  });
  const builtWeight = innerRows.reduce((sum, row) => sum + row.area, 0);
  const builtCentroid = [
    innerRows.reduce((sum, row) => sum + row.lon * row.area, 0) / builtWeight,
    innerRows.reduce((sum, row) => sum + row.lat * row.area, 0) / builtWeight,
  ];
  const centreSensitivity = [
    { centre: "Old Courthouse", ...gradientPerKm(profile) },
    { centre: "Gateway Arch", ...gradientPerKm(densityProfile(rows, [-90.1848, 38.6247], bounds)) },
    {
      centre: "built-area centroid within 3 km",
      ...gradientPerKm(densityProfile(rows, builtCentroid, bounds)),
    },
  ];

  // --- 3. Building allometry --------------------------------------------
  const allometry = rows.filter((row) => Number.isFinite(row.levels) && row.levels > 0 && row.area > 5);
  results.push(ground(relation({
    id: "storey-footprint-allometry",
    statement: "Storey count scales as a power of footprint area: taller buildings sit on larger plots.",
    form: "log-log",
    response: extract({
      name: "storey count",
      symbol: "L",
      unit: UNITS.one,
      source: SOURCE,
      field: "properties.building:levels",
      method: "tagged storey count",
      records: allometry,
      read: (row) => ({ value: row.levels, measured: true, id: row.id }),
    }),
    predictor: extract({
      name: "footprint area",
      symbol: "A",
      unit: UNITS.squareMetre,
      source: SOURCE,
      field: "geometry.coordinates",
      method: "shoelace area on a local equirectangular projection",
      records: allometry,
      read: (row) => ({ value: row.area, measured: true, id: row.id }),
    }),
    responseReference: quantity(1, UNITS.one),
    predictorReference: quantity(1, UNITS.squareMetre),
    nullSlope: 0,
  })));

  // --- 4. Negative control ----------------------------------------------
  // The same machinery against a predictor that cannot possibly explain
  // anything. If this comes back grounded, none of the above means a thing.
  const random = seededRandom(20260915);
  results.push(ground(relation({
    id: "negative-control",
    statement: "NEGATIVE CONTROL: footprint area against a pseudo-random number. "
      + "This must be rejected for the other verdicts to carry weight.",
    form: "log-log",
    response: extract({
      name: "footprint area",
      symbol: "A",
      unit: UNITS.squareMetre,
      source: SOURCE,
      field: "geometry.coordinates",
      method: "shoelace area",
      records: allometry,
      read: (row) => ({ value: row.area, measured: true, id: row.id }),
    }),
    predictor: derived({
      name: "pseudo-random control",
      symbol: "z",
      unit: UNITS.one,
      source: "seeded generator, no relation to the city",
      method: "deterministic PRNG",
      values: allometry.map(() => 0.5 + random()),
    }),
    responseReference: quantity(1, UNITS.squareMetre),
    predictorReference: quantity(1, UNITS.one),
    nullSlope: 0,
  })));

  // --- 5. Footprint area tail -------------------------------------------
  // A rank-size regression on these data returns R^2 = 0.97, which is close to
  // meaningless: ranks are a monotone transform of the sorted values, so the
  // plot is smooth whatever the distribution. The maximum-likelihood fit plus a
  // comparison against an exponential is the test that can actually fail.
  const areas = rows.map((row) => row.area);
  const tail = powerLawTail(areas, { syntheticSamples: 200 });
  const comparison = tail.ok ? compareTailModels(areas, tail.xmin) : { ok: false };

  const feed = {
    updatedAt: new Date().toISOString(),
    source: SOURCE,
    buildings: rows.length,
    boundingBox: bounds,
    centre: { lon: centre[0], lat: centre[1], label: "Old Courthouse, downtown St. Louis" },
    fieldCoverage: {
      footprintGeometry: 1,
      taggedHeight: rows.filter((row) => Number.isFinite(row.height)).length / rows.length,
      taggedLevels: rows.filter((row) => Number.isFinite(row.levels)).length / rows.length,
      bothHeightAndLevels: paired.length / rows.length,
    },
    observables: {
      footprintArea: summarize(derived({
        name: "footprint area", symbol: "A", unit: UNITS.squareMetre,
        source: SOURCE, method: "shoelace", values: areas,
      })),
      storeyHeight: summarize(heightObservable),
      storeyCount: summarize(levelsObservable),
    },
    relations: results,
    densityProfile: profile.map((ring) => ({
      midpointMetres: ring.midpoint,
      coverage: Number(ring.coverage.toFixed(3)),
      builtAreaFraction: Number(ring.density.toFixed(5)),
    })),
    profileStructure,
    methodSensitivity,
    centreSensitivity,
    footprintAreaTail: {
      note: "Maximum likelihood after Clauset, Shalizi & Newman, then a Vuong "
        + "likelihood-ratio test against an exponential on the same tail.",
      ...tail,
      versusExponential: comparison,
    },
  };

  const output = resolve(dataDir, "relations-feed.json");
  await writeFile(output, `${JSON.stringify(feed, null, 2)}\n`);

  console.log(`${rows.length.toLocaleString()} buildings; `
    + `height tagged on ${(feed.fieldCoverage.taggedHeight * 100).toFixed(2)}%, `
    + `storeys on ${(feed.fieldCoverage.taggedLevels * 100).toFixed(2)}%`);
  for (const result of results) report(result);
  console.log("\nDensity profile structure:");
  for (const [label, entry] of Object.entries(profileStructure)) {
    console.log(`  ${label.padEnd(6)} ${entry.range.padEnd(10)} gradient `
      + `${entry.gradientPerKm.toFixed(4)}/km  R2 ${entry.r2.toFixed(3)}  (${entry.rings} rings)`);
  }
  console.log("\nMethod sensitivity (gradient per km):");
  for (const entry of methodSensitivity) {
    console.log(`  ${entry.gradientPerKm.toFixed(4)}  R2 ${entry.r2.toFixed(3)}  ${entry.method}`);
    if (entry.warning) console.log(`      ${entry.warning}`);
  }
  console.log("\nCentre sensitivity (gradient per km):");
  for (const entry of centreSensitivity) {
    console.log(`  ${entry.gradientPerKm.toFixed(4)}  R2 ${entry.r2.toFixed(3)}  ${entry.centre}`);
  }
  if (tail.ok) {
    console.log(`\nFootprint area tail: alpha = ${tail.alpha.toFixed(3)} above `
      + `${tail.xmin.toFixed(0)} m^2 (n = ${tail.tailSize}), KS goodness-of-fit p = ${tail.gofPValue}`);
    console.log(`  versus exponential: ${comparison.ok ? comparison.favours : comparison.reason}`
      + `${comparison.ok ? ` (z = ${comparison.statistic.toFixed(2)}, p = ${comparison.pValue.toPrecision(3)})` : ""}`);
  }
  console.log(`\nWrote ${output}`);
}

await main();
