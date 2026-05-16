import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const dataDir = resolve(projectRoot, "public/data");
const watchMode = process.argv.includes("--watch");

const STL = {
  lat: 38.627,
  lon: -90.1994,
  aircraftRadiusNm: 95,
  bbox: "-90.76,38.43,-89.93,38.94",
};

const MODOT_LAYERS = [
  [24, "Incident High Point"],
  [25, "Incident Medium Point"],
  [26, "Work Zone High Point"],
  [27, "Work Zone Medium Point"],
  [31, "Incident High Line"],
  [32, "Incident Medium Line"],
  [33, "Work Zone High Line"],
  [34, "Work Zone Medium Line"],
];

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "user-agent": "StLouis3DWorld/0.1 local digital twin",
      accept: "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }

  return response.json();
}

function feetToMeters(feet) {
  return Number.isFinite(feet) ? feet * 0.3048 : 0;
}

async function fetchAircraft() {
  const url = `https://api.adsb.lol/v2/lat/${STL.lat}/lon/${STL.lon}/dist/${STL.aircraftRadiusNm}`;
  const data = await fetchJson(url);
  const aircraft = (data.ac ?? [])
    .filter((aircraft) => Number.isFinite(aircraft.lat) && Number.isFinite(aircraft.lon))
    .map((aircraft) => {
      const altFeet = Number.isFinite(aircraft.alt_baro) ? aircraft.alt_baro : 0;
      return {
        id: aircraft.hex,
        callsign: String(aircraft.flight ?? aircraft.r ?? aircraft.hex).trim(),
        registration: aircraft.r ?? null,
        aircraftType: aircraft.t ?? null,
        lat: aircraft.lat,
        lon: aircraft.lon,
        trackDeg: Number.isFinite(aircraft.track) ? aircraft.track : 0,
        speedKt: Number.isFinite(aircraft.gs) ? aircraft.gs : 0,
        altitudeFeet: altFeet,
        altitudeMeters: feetToMeters(altFeet),
        renderAltitudeMeters: Math.min(Math.max(feetToMeters(altFeet) * 0.28, 280), 4200),
        seenSeconds: aircraft.seen ?? aircraft.seen_pos ?? null,
      };
    });

  await writeData("aircraft-feed.json", {
    updatedAt: new Date().toISOString(),
    source: "adsb.lol",
    aircraft,
  });

  return aircraft.length;
}

async function fetchTraffic() {
  const features = [];

  for (const [layerId, layerName] of MODOT_LAYERS) {
    const url =
      `https://mapping.modot.org/arcgis/rest/services/TravelerInformation/TravelerInformationData/MapServer/${layerId}/query` +
      `?where=1%3D1&outFields=*&f=geojson&geometry=${STL.bbox}` +
      "&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects";

    const geojson = await fetchJson(url);
    for (const feature of geojson.features ?? []) {
      features.push({
        ...feature,
        properties: {
          ...(feature.properties ?? {}),
          layerId,
          layerName,
          severity: layerName.includes("High") ? "high" : "medium",
        },
      });
    }
  }

  await writeData("traffic-feed.geojson", {
    type: "FeatureCollection",
    metadata: {
      updatedAt: new Date().toISOString(),
      source: "MoDOT TravelerInformation ArcGIS REST",
      featureCount: features.length,
    },
    features,
  });

  return features.length;
}

async function fetchWeather() {
  const observation = await fetchJson("https://api.weather.gov/stations/KSTL/observations/latest");
  const properties = observation.properties ?? {};
  const weather = {
    updatedAt: new Date().toISOString(),
    source: "NOAA/NWS KSTL latest observation",
    station: "KSTL",
    description: properties.textDescription ?? "Unknown",
    temperatureC: properties.temperature?.value ?? null,
    windSpeedMps: properties.windSpeed?.value ?? null,
    windDirectionDeg: properties.windDirection?.value ?? 260,
    visibilityMeters: properties.visibility?.value ?? null,
    rawTimestamp: properties.timestamp ?? null,
  };

  await writeData("weather-feed.json", weather);
  return weather.description;
}

async function fetchTransit() {
  const response = await fetch("https://www.metrostlouis.org/RealTimeData/StlRealTimeVehicles.pb", {
    headers: {
      "user-agent": "StLouis3DWorld/0.1 local digital twin",
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: Metro realtime vehicles`);
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);
  const vehicles = feed.entity
    .map((entity) => entity.vehicle)
    .filter((vehicle) => vehicle?.position?.latitude && vehicle?.position?.longitude)
    .map((vehicle) => {
      const label = vehicle.vehicle?.label ?? vehicle.trip?.routeId ?? "Metro vehicle";
      const isRail = /red|blue|metrolink/i.test(label);
      return {
        id: vehicle.vehicle?.id ?? `${vehicle.trip?.routeId}-${vehicle.timestamp}`,
        label,
        routeId: vehicle.trip?.routeId ?? null,
        tripId: vehicle.trip?.tripId ?? null,
        lat: vehicle.position.latitude,
        lon: vehicle.position.longitude,
        bearingDeg: vehicle.position.bearing ?? 0,
        speedMps: vehicle.position.speed ?? null,
        timestamp: vehicle.timestamp ? Number(vehicle.timestamp) : null,
        mode: isRail ? "rail" : "bus",
      };
    });

  await writeData("transit-feed.json", {
    updatedAt: new Date().toISOString(),
    source: "Metro St. Louis GTFS-Realtime vehicles",
    vehicles,
  });

  return vehicles.length;
}

async function writeData(filename, data) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(resolve(dataDir, filename), `${JSON.stringify(data, null, 2)}\n`);
}

async function updateOnce() {
  const results = await Promise.allSettled([
    fetchAircraft(),
    fetchTraffic(),
    fetchWeather(),
    fetchTransit(),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      console.error(result.reason);
    }
  }

  const summary = results.map((result) =>
    result.status === "fulfilled" ? result.value : "failed",
  );
  console.log(
    `[${new Date().toLocaleTimeString()}] aircraft=${summary[0]} traffic=${summary[1]} weather=${summary[2]} transit=${summary[3]}`,
  );
}

await updateOnce();

if (watchMode) {
  setInterval(updateOnce, 30_000);
}
