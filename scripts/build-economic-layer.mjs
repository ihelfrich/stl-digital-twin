// Build the economic layer of the digital twin.
//
// Three passes over the city, each using a different piece of mathematics for
// a question the others cannot answer:
//
//  1. Algebraic geometry. Treat the districts as agents in an exchange economy
//     over built space and access, reduce equilibrium to a polynomial system
//     and solve it completely. This finds *every* equilibrium, so it can tell
//     the difference between a city with one resting point and a city whose
//     same fundamentals support several.
//
//  2. Sheaf cohomology. Local readings per district plus measured differentials
//     per link. H^0 says how much a global price system is pinned down, H^1
//     and the harmonic residual say how much of what we observe cannot be
//     explained by any district-level assignment at all.
//
//  3. Compositional game theory. Build a development game out of open games so
//     that its equilibria are computed from the parts, and read off how much of
//     the outcome depends on commitment rather than payoffs.
//
// The economics is a demonstration on proxy indices derived from OpenStreetMap
// building stock and live transit and incident feeds. The indices are not
// market prices and nothing here is a forecast; what is being demonstrated is
// the machinery and the questions it makes askable.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { solveEconomy } from "../src/econ/exchange-economy.mjs";
import { cohomology, createSheaf, decompose, obstructionByEdge, spectrum } from "../src/econ/sheaf.mjs";
import { decision, equilibria, sequential, sequentialPerfect } from "../src/econ/open-games.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const dataDir = resolve(projectRoot, "public/data");

// Estimated from the buildings carrying both a height and a storey count:
// 3.85 m/storey, 95% CI [3.51, 4.28]. See scripts/build-relations.mjs. The
// value previously used here, 3.2, lies outside that interval.
const METRES_PER_STOREY = 3.85;
const DEFAULT_HEIGHT_METRES = 8;

const GRID_COLUMNS = 4;
const GRID_ROWS = 3;
const MIN_BUILDINGS = 60;
const METERS_PER_DEGREE_LAT = 111_320;

function parseLengthMeters(value) {
  if (value === null || value === undefined) return Number.NaN;
  const text = String(value).trim().toLowerCase();
  const number = Number.parseFloat(text.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(number) || number <= 0) return Number.NaN;
  if (text.includes("ft") || text.includes("feet") || text.includes("'")) return number * 0.3048;
  return number;
}

// Heights are tagged on a small minority of buildings. The tally records which
// branch each building took, because "floor space" computed mostly from the
// fallback is a restatement of footprint area and the feed has to say so.
const heightProvenance = { tagged: 0, fromLevels: 0, defaulted: 0 };

function featureHeight(feature) {
  const height = parseLengthMeters(feature.properties?.height);
  const levels = Number.parseFloat(String(feature.properties?.["building:levels"] ?? ""));
  if (Number.isFinite(height) && height > 0) {
    heightProvenance.tagged += 1;
    return height;
  }
  if (Number.isFinite(levels) && levels > 0) {
    heightProvenance.fromLevels += 1;
    return levels * METRES_PER_STOREY;
  }
  heightProvenance.defaulted += 1;
  return DEFAULT_HEIGHT_METRES;
}

/** Shoelace area in square metres, with a local equirectangular projection. */
function footprintArea(ring, referenceLat) {
  const scaleX = METERS_PER_DEGREE_LAT * Math.cos((referenceLat * Math.PI) / 180);
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    sum += (x1 * scaleX) * (y2 * METERS_PER_DEGREE_LAT) - (x2 * scaleX) * (y1 * METERS_PER_DEGREE_LAT);
  }
  return Math.abs(sum) / 2;
}

function centroid(feature) {
  const ring = feature.geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let lon = 0;
  let lat = 0;
  for (const coordinate of ring) {
    lon += coordinate[0];
    lat += coordinate[1];
  }
  return [lon / ring.length, lat / ring.length];
}

function buildDistricts(buildings, bounds) {
  const width = (bounds.east - bounds.west) / GRID_COLUMNS;
  const height = (bounds.north - bounds.south) / GRID_ROWS;
  const cells = new Map();
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let column = 0; column < GRID_COLUMNS; column += 1) {
      cells.set(`d${column}-${row}`, {
        id: `d${column}-${row}`,
        column,
        row,
        lon: bounds.west + width * (column + 0.5),
        lat: bounds.south + height * (row + 0.5),
        buildings: 0,
        floorSpace: 0,
        footprint: 0,
        tallest: 0,
      });
    }
  }
  for (const feature of buildings.features) {
    const point = centroid(feature);
    if (!point) continue;
    const column = Math.floor((point[0] - bounds.west) / width);
    const row = Math.floor((point[1] - bounds.south) / height);
    const cell = cells.get(`d${Math.min(Math.max(column, 0), GRID_COLUMNS - 1)}-${Math.min(Math.max(row, 0), GRID_ROWS - 1)}`);
    if (!cell) continue;
    const buildingHeight = featureHeight(feature);
    const area = footprintArea(feature.geometry.coordinates[0], point[1]);
    cell.buildings += 1;
    cell.footprint += area;
    cell.floorSpace += (area * buildingHeight) / 3.2; // ~floors of usable space
    cell.tallest = Math.max(cell.tallest, buildingHeight);
  }
  return [...cells.values()].filter((cell) => cell.buildings >= MIN_BUILDINGS);
}

function attachAccess(districts, transit, traffic, bounds) {
  const width = (bounds.east - bounds.west) / GRID_COLUMNS;
  const height = (bounds.north - bounds.south) / GRID_ROWS;
  const locate = (lon, lat) => {
    const column = Math.floor((lon - bounds.west) / width);
    const row = Math.floor((lat - bounds.south) / height);
    if (column < 0 || row < 0 || column >= GRID_COLUMNS || row >= GRID_ROWS) return null;
    return `d${column}-${row}`;
  };
  const index = new Map(districts.map((district) => [district.id, district]));
  for (const district of districts) {
    district.vehicles = 0;
    district.movingVehicles = 0;
    district.incidentLoad = 0;
  }
  for (const vehicle of transit.vehicles ?? []) {
    const district = index.get(locate(vehicle.lon, vehicle.lat) ?? "");
    if (!district) continue;
    district.vehicles += 1;
    if ((vehicle.speedMps ?? 0) > 1) district.movingVehicles += 1;
  }
  const weights = { high: 3, medium: 2, low: 1 };
  for (const feature of traffic.features ?? []) {
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    if (lon === undefined) continue;
    const district = index.get(locate(lon, lat) ?? "");
    if (!district) continue;
    district.incidentLoad += weights[feature.properties?.severity] ?? 1;
  }
  for (const district of districts) {
    // Access endowment: service present, discounted by how congested it is.
    district.access = (1 + district.vehicles + 0.5 * district.movingVehicles) / (1 + 0.35 * district.incidentLoad);
  }
  return districts;
}

/**
 * Two goods: built space and access. Each district is an agent endowed with
 * what it physically has and wanting a mix of both. Districts that are already
 * dense weight access more heavily, which is what makes the economy non-trivial
 * rather than a symmetric toy.
 */
function buildEconomy(districts, elasticity) {
  const totalSpace = districts.reduce((sum, district) => sum + district.floorSpace, 0);
  const totalAccess = districts.reduce((sum, district) => sum + district.access, 0);
  return {
    goods: 2,
    agents: districts.map((district) => {
      const spaceShare = district.floorSpace / totalSpace;
      const accessShare = district.access / totalAccess;
      // Dense districts already hold space, so they value access at the margin.
      const weightOnAccess = Math.min(0.9, Math.max(0.1, spaceShare / (spaceShare + accessShare)));
      return {
        id: district.id,
        shares: [1 - weightOnAccess, weightOnAccess],
        elasticity,
        endowment: [
          Math.max(1e-3, (district.floorSpace / totalSpace) * districts.length),
          Math.max(1e-3, (district.access / totalAccess) * districts.length),
        ],
      };
    }),
  };
}

/**
 * Sweep the elasticity of substitution downward and record where the number of
 * equilibria changes. Crossing from one equilibrium to three means the same
 * building stock and the same transit service support more than one internally
 * consistent configuration of the city: the outcome is then a matter of which
 * one the city has coordinated on, not of fundamentals.
 */
function sweepElasticity(districts, values) {
  const results = [];
  for (const elasticity of values) {
    try {
      const solved = solveEconomy(buildEconomy(districts, elasticity), { attempts: 2 });
      results.push({
        elasticity,
        equilibria: solved.equilibria.length,
        indexSum: solved.indexSum,
        complete: solved.diagnostics.complete,
        relativePriceOfSpace: solved.equilibria.map((point) => point.prices[0]),
      });
    } catch (error) {
      results.push({ elasticity, error: String(error.message ?? error) });
    }
  }
  return results;
}

/**
 * Price sheaf over the district grid.
 *
 * Each district carries a two-dimensional local reading - a log space index and
 * a log access index - but it reads them in its own frame: how much built space
 * substitutes for access locally depends on how congested that district is, and
 * how a unit of access converts into comparable terms depends on how much
 * service it actually has. The restriction map on a link is that district's
 * frame, so a link compares the two sides only after converting through both.
 *
 * A global section is a price assignment every link agrees with simultaneously.
 * Going around a loop of districts composes the frame changes, and when that
 * holonomy is not the identity there is no nonzero assignment the whole loop
 * accepts. That is the sheaf-theoretic form of an arbitrage loop: locally
 * everything reconciles, globally nothing does, and H^1 counts the ways.
 */
function districtFrame(district) {
  // Congestion makes space and access substitute locally; service level sets
  // the scale at which access is quoted. Both are bounded away from degeneracy
  // so that the frame stays invertible.
  const shear = Math.min(0.6, 0.12 * district.incidentLoad);
  const scale = Math.min(1.8, Math.max(0.55, 0.6 + 0.35 * Math.log1p(district.vehicles)));
  return [[1, shear], [0, scale]];
}

function buildPriceSheaf(districts) {
  const byPosition = new Map(districts.map((district) => [`${district.column}-${district.row}`, district]));
  const frames = new Map(districts.map((district) => [district.id, districtFrame(district)]));
  const edges = [];
  for (const district of districts) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const neighbour = byPosition.get(`${district.column + dx}-${district.row + dy}`);
      if (!neighbour) continue;
      edges.push({
        source: district.id,
        target: neighbour.id,
        dim: 2,
        source_map: frames.get(district.id),
        target_map: frames.get(neighbour.id),
        axis: dx === 1 ? "lon" : "lat",
        sourceDistrict: district,
        targetDistrict: neighbour,
      });
    }
  }
  const vertices = districts.map((district) => ({ id: district.id, dim: 2 }));
  return { sheaf: createSheaf(vertices, edges), edges, frames };
}

/**
 * The observed differentials have to be measured somewhere other than at the
 * district readings, or the cochain is a coboundary by construction and the
 * obstruction comes out zero for reasons that have nothing to do with the city.
 * So each link is measured on its own boundary: the transit moving across that
 * boundary, and the incidents sitting on it. Both are read from a band around
 * the shared edge and are not recoverable from the district aggregates.
 */
function observedCochain(edges, transit, traffic, bounds) {
  const width = (bounds.east - bounds.west) / GRID_COLUMNS;
  const height = (bounds.north - bounds.south) / GRID_ROWS;
  const vehicles = (transit.vehicles ?? []).filter((vehicle) => Number.isFinite(vehicle.lon));
  const incidents = (traffic.features ?? []).filter((feature) => Array.isArray(feature.geometry?.coordinates));
  const severityWeight = { high: 3, medium: 2, low: 1 };

  const cochain = [];
  for (const edge of edges) {
    const source = edge.sourceDistrict;
    const target = edge.targetDistrict;
    const horizontal = edge.axis === "lon";
    const boundaryLon = horizontal ? bounds.west + width * (source.column + 1) : null;
    const boundaryLat = horizontal ? null : bounds.south + height * (source.row + 1);
    const inBand = (lon, lat) => {
      if (horizontal) {
        return Math.abs(lon - boundaryLon) < width * 0.35
          && Math.abs(lat - source.lat) < height * 0.5;
      }
      return Math.abs(lat - boundaryLat) < height * 0.35
        && Math.abs(lon - source.lon) < width * 0.5;
    };

    let toward = 0;
    let away = 0;
    for (const vehicle of vehicles) {
      if (!inBand(vehicle.lon, vehicle.lat)) continue;
      const speed = vehicle.speedMps ?? 0;
      // Component of travel along the boundary normal, pointing source->target.
      const bearing = ((vehicle.bearingDeg ?? 0) * Math.PI) / 180;
      const alongNormal = horizontal ? Math.sin(bearing) : Math.cos(bearing);
      const magnitude = 1 + speed;
      if (alongNormal >= 0) toward += magnitude;
      else away += magnitude;
    }
    let boundaryIncidents = 0;
    for (const incident of incidents) {
      const [lon, lat] = incident.geometry.coordinates;
      if (!inBand(lon, lat)) continue;
      boundaryIncidents += severityWeight[incident.properties?.severity] ?? 1;
    }
    // Component 1: directional imbalance of service across the boundary.
    // Component 2: the friction wedge the boundary itself imposes.
    cochain.push(Math.log((1 + toward) / (1 + away)));
    cochain.push(-Math.log1p(boundaryIncidents));
  }
  return cochain;
}

/**
 * A development game, with the equilibrium price of space from pass 1 setting
 * the stakes. The developer moves first; the city observes and responds.
 *
 * Running it as a plain sequential composite gives the Nash equilibria, which
 * include outcomes sustained by a response the city would not actually want to
 * carry out. Demanding optimality at every observation - subgame perfection -
 * removes those. The gap between the two is the part of the outcome that rests
 * on commitment rather than on payoffs, and it is visible here as a difference
 * in which contexts the equilibrium predicate quantifies over.
 */
function developmentGame(priceOfSpace) {
  const value = Math.max(0.5, Math.min(4, priceOfSpace));
  const payoffs = {
    "Build,Upzone": [2 * value - 1, 2],
    "Build,Hold": [value - 2, 1],
    "Wait,Upzone": [0, -1],
    "Wait,Hold": [0, 0],
  };
  const continuation = ([move, response]) => payoffs[`${move},${response}`];
  const developer = decision({ name: "Developer", moves: ["Build", "Wait"] });
  const city = decision({
    name: "City",
    moves: ["Upzone", "Hold"],
    observations: ["Build", "Wait"],
    emit: (observation, move) => [observation, move],
    backward: (_observation, utility) => utility[0],
    payoff: (utility) => utility[1],
  });
  const describe = (profiles) => profiles.map(([developerStrategy, cityStrategy]) => ({
    developer: developerStrategy[0],
    cityIfBuild: cityStrategy[0],
    cityIfWait: cityStrategy[1],
  }));
  return {
    priceOfSpace: value,
    payoffs,
    nash: describe(equilibria(sequential(developer, city), null, continuation)),
    subgamePerfect: describe(
      equilibria(sequentialPerfect(developer, city, ["Build", "Wait"]), null, continuation),
    ),
  };
}

async function main() {
  const buildings = JSON.parse(await readFile(resolve(dataDir, "stl-buildings.geojson"), "utf8"));
  const transit = JSON.parse(await readFile(resolve(dataDir, "transit-feed.json"), "utf8"));
  const traffic = JSON.parse(await readFile(resolve(dataDir, "traffic-feed.geojson"), "utf8"));
  const bounds = buildings.metadata?.bounds ?? { south: 38.585, west: -90.305, north: 38.675, east: -90.155 };

  const districts = attachAccess(buildDistricts(buildings, bounds), transit, traffic, bounds);
  if (districts.length < 3) throw new Error("build-economic-layer: not enough populated districts");

  // Pass 1: every competitive equilibrium, at a baseline elasticity and across
  // a sweep that looks for the onset of multiplicity.
  const baseline = solveEconomy(buildEconomy(districts, 0.5));
  const sweep = sweepElasticity(districts, [1, 0.5, 1 / 3, 0.25, 0.2, 0.125, 0.1]);

  // Pass 2: how much of the observed link data no district-level price system
  // can account for.
  const { sheaf, edges } = buildPriceSheaf(districts);
  const cochain = observedCochain(edges, transit, traffic, bounds);
  const homology = cohomology(sheaf);
  const split = decompose(sheaf, cochain);
  const laplacian = spectrum(sheaf);
  const worstLinks = obstructionByEdge(sheaf, cochain).slice(0, 5);

  // Pass 3: the compositional game, priced by pass 1.
  const game = developmentGame(baseline.equilibria[0]?.prices[0] ?? 1);

  const feed = {
    updatedAt: new Date().toISOString(),
    source: "derived from stl-buildings.geojson, transit-feed.json, traffic-feed.geojson",
    note: "Demonstration indices, not market prices. See docs/ALGEBRAIC-ECONOMICS.md.",
    provenance: {
      warning: "floorSpaceSqm is largely imputed, not measured. Footprint geometry is "
        + "real for every building, but height is tagged on very few, so for most "
        + "buildings floor space is footprint area times a default height. Treat it as "
        + "a rescaled footprint area rather than as a measurement of built volume.",
      buildingHeights: {
        ...heightProvenance,
        total: heightProvenance.tagged + heightProvenance.fromLevels + heightProvenance.defaulted,
        measuredFraction: (heightProvenance.tagged + heightProvenance.fromLevels)
          / Math.max(1, heightProvenance.tagged + heightProvenance.fromLevels + heightProvenance.defaulted),
      },
      metresPerStorey: {
        value: METRES_PER_STOREY,
        interval: [3.51, 4.28],
        basis: "estimated from buildings tagged with both height and storey count "
          + "(n = 99); see public/data/relations-feed.json",
      },
      accessIndex: "Constructed from a single snapshot of 83 transit vehicles and 83 "
        + "incidents. It is an index, not a measured quantity.",
    },
    districts: districts.map((district) => ({
      id: district.id,
      lon: Number(district.lon.toFixed(6)),
      lat: Number(district.lat.toFixed(6)),
      buildings: district.buildings,
      floorSpaceSqm: Math.round(district.floorSpace),
      tallestMeters: Math.round(district.tallest),
      vehicles: district.vehicles,
      incidentLoad: district.incidentLoad,
      access: Number(district.access.toFixed(4)),
    })),
    equilibrium: {
      goods: ["built space", "access (numeraire)"],
      elasticity: 0.5,
      count: baseline.equilibria.length,
      prices: baseline.equilibria.map((point) => point.prices.map((price) => Number(price.toFixed(6)))),
      indices: baseline.equilibria.map((point) => point.index),
      indexSum: baseline.indexSum,
      indexTheoremHolds: baseline.indexSum === 1,
      diagnostics: baseline.diagnostics,
      sweep,
    },
    sheaf: {
      districts: sheaf.vertices.length,
      links: sheaf.edges.length,
      dimC0: homology.dimC0,
      dimC1: homology.dimC1,
      h0: homology.h0,
      h1: homology.h1,
      spectralGap: Number(laplacian.spectralGap.toFixed(6)),
      obstructionNorm: Number(split.obstructionNorm.toFixed(6)),
      inconsistency: Number(split.inconsistency.toFixed(6)),
      consistent: split.consistent,
      mostObstructedLinks: worstLinks.map((link) => ({
        source: link.source,
        target: link.target,
        magnitude: Number(link.magnitude.toFixed(6)),
      })),
    },
    game,
  };

  const output = resolve(dataDir, "economy-feed.json");
  await writeFile(output, `${JSON.stringify(feed, null, 2)}\n`);

  console.log(`Districts: ${districts.length} (${sheaf.edges.length} links)`);
  console.log(`Equilibria at sigma=0.5: ${baseline.equilibria.length}, indices sum to ${baseline.indexSum}` +
    ` (${baseline.diagnostics.paths} paths, complete=${baseline.diagnostics.complete})`);
  for (const step of sweep) {
    console.log(`  sigma=${step.elasticity.toFixed(3)} -> ${step.equilibria ?? "?"} equilibria` +
      `${step.error ? ` (${step.error})` : ""}`);
  }
  console.log(`Sheaf: H^0 = ${homology.h0}, H^1 = ${homology.h1}, spectral gap ${laplacian.spectralGap.toFixed(4)}`);
  console.log(`Observed link data is ${(split.inconsistency * 100).toFixed(1)}% unexplainable by district prices`);
  console.log(`Game: ${game.nash.length} Nash, ${game.subgamePerfect.length} subgame perfect`);
  console.log(`Wrote ${output}`);
}

await main();
