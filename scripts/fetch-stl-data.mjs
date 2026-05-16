import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const dataDir = resolve(projectRoot, "public/data");

const BOUNDS = {
  core: {
    south: 38.585,
    west: -90.305,
    north: 38.675,
    east: -90.155,
  },
  city: {
    south: 38.53,
    west: -90.36,
    north: 38.79,
    east: -90.11,
  },
  county: {
    south: 38.43,
    west: -90.76,
    north: 38.94,
    east: -89.93,
  },
};

const requested = process.argv.includes("--county")
  ? "county"
  : process.argv.includes("--city")
    ? "city"
    : "core";
const bounds = BOUNDS[requested];
const gridIndex = process.argv.indexOf("--grid");
const gridSize = gridIndex >= 0 ? Number.parseInt(process.argv[gridIndex + 1] ?? "4", 10) : 4;

function overpassQueryForBounds(tileBounds) {
  return `
[out:json][timeout:180];
(
  way["building"](${tileBounds.south},${tileBounds.west},${tileBounds.north},${tileBounds.east});
);
out tags geom;
`;
}

function closeRing(ring) {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  return ring;
}

function elementToFeature(element) {
  if (!Array.isArray(element.geometry) || element.geometry.length < 4) return null;

  const ring = closeRing(element.geometry.map((point) => [point.lon, point.lat]));
  return {
    type: "Feature",
    properties: {
      osm_id: element.id,
      name: element.tags?.name ?? null,
      building: element.tags?.building ?? "yes",
      height: element.tags?.height ?? null,
      "building:levels": element.tags?.["building:levels"] ?? null,
      source: "OpenStreetMap Overpass API",
    },
    geometry: {
      type: "Polygon",
      coordinates: [ring],
    },
  };
}

async function main() {
  await mkdir(dataDir, { recursive: true });
  const tiles = requested === "county" ? splitBounds(bounds, gridSize) : [bounds];
  const featuresById = new Map();

  for (const [index, tileBounds] of tiles.entries()) {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "user-agent": "StLouis3DWorld/0.1 local prototype",
      },
      body: new URLSearchParams({ data: overpassQueryForBounds(tileBounds) }),
    });

    if (!response.ok) {
      throw new Error(`Overpass failed on tile ${index + 1}: ${response.status} ${response.statusText}`);
    }

    const overpass = await response.json();
    for (const feature of overpass.elements.map(elementToFeature).filter(Boolean)) {
      featuresById.set(feature.properties.osm_id, feature);
    }

    console.log(
      `Tile ${index + 1}/${tiles.length}: ${featuresById.size.toLocaleString()} unique buildings`,
    );
  }

  const features = [...featuresById.values()];

  const geojson = {
    type: "FeatureCollection",
    metadata: {
      generatedAt: new Date().toISOString(),
      area: requested,
      bounds,
      gridSize: requested === "county" ? gridSize : 1,
      source: "OpenStreetMap via Overpass API",
      featureCount: features.length,
    },
    features,
  };

  const output = resolve(
    dataDir,
    requested === "county" ? "stl-buildings-county.geojson" : "stl-buildings.geojson",
  );
  await writeFile(output, `${JSON.stringify(geojson)}\n`);
  console.log(`Wrote ${features.length.toLocaleString()} buildings to ${output}`);
}

function splitBounds(sourceBounds, divisions) {
  const safeDivisions = Math.max(1, Math.min(divisions || 4, 10));
  const latStep = (sourceBounds.north - sourceBounds.south) / safeDivisions;
  const lonStep = (sourceBounds.east - sourceBounds.west) / safeDivisions;
  const tiles = [];

  for (let row = 0; row < safeDivisions; row += 1) {
    for (let column = 0; column < safeDivisions; column += 1) {
      tiles.push({
        south: sourceBounds.south + row * latStep,
        west: sourceBounds.west + column * lonStep,
        north: sourceBounds.south + (row + 1) * latStep,
        east: sourceBounds.west + (column + 1) * lonStep,
      });
    }
  }

  return tiles;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
