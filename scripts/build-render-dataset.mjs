import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const dataDir = resolve(projectRoot, "public/data");

const source = resolve(dataDir, process.argv[2] ?? "stl-buildings-county.geojson");
const output = resolve(dataDir, process.argv[3] ?? "stl-buildings-county-render.geojson");
const limit = Number.parseInt(process.argv[4] ?? "30000", 10);

function parseLengthMeters(value) {
  if (value === null || value === undefined) return Number.NaN;
  const text = String(value).trim().toLowerCase();
  const number = Number.parseFloat(text.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(number) || number <= 0) return Number.NaN;
  if (text.includes("ft") || text.includes("feet") || text.includes("'")) return number * 0.3048;
  return number;
}

function featureHeight(feature) {
  const height = parseLengthMeters(feature.properties?.height);
  const levels = Number.parseFloat(String(feature.properties?.["building:levels"] ?? ""));
  if (Number.isFinite(height) && height > 0) return height;
  if (Number.isFinite(levels) && levels > 0) return levels * 3.2;
  return 8;
}

function centroid(feature) {
  const ring = feature.geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length === 0) return [-90.1994, 38.627];
  const sum = ring.reduce(
    (accumulator, coordinate) => {
      accumulator.lon += coordinate[0];
      accumulator.lat += coordinate[1];
      return accumulator;
    },
    { lon: 0, lat: 0 },
  );
  return [sum.lon / ring.length, sum.lat / ring.length];
}

function score(feature) {
  const [lon, lat] = centroid(feature);
  const anchors = [
    [-90.1945, 38.6297],
    [-90.2518, 38.6354],
    [-90.3701, 38.7487],
    [-90.4329, 38.627],
    [-90.493, 38.6609],
  ];
  const distance = Math.min(...anchors.map(([anchorLon, anchorLat]) => Math.hypot(lon - anchorLon, lat - anchorLat)));
  const namedBoost = feature.properties?.name ? 120 : 0;
  const heightBoost = featureHeight(feature) * 9;
  const locationBoost = 1 / Math.max(distance, 0.0012);
  const id = String(feature.properties?.osm_id ?? "");
  const jitter = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 23;
  return namedBoost + heightBoost + locationBoost + jitter;
}

const geojson = JSON.parse(await readFile(source, "utf8"));
const features = [...geojson.features].sort((a, b) => score(b) - score(a)).slice(0, limit);

await writeFile(
  output,
  `${JSON.stringify({
    type: "FeatureCollection",
    metadata: {
      ...(geojson.metadata ?? {}),
      sourceFile: source,
      sourceFeatureCount: geojson.features.length,
      renderedFeatureCount: features.length,
      generatedAt: new Date().toISOString(),
    },
    features,
  })}\n`,
);

console.log(`Wrote ${features.length.toLocaleString()} render buildings to ${output}`);
