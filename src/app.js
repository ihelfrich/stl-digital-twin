const ST_LOUIS = {
  lon: -90.1994,
  lat: 38.627,
};

const params = new URLSearchParams(window.location.search);
const MAX_RENDERED_BUILDINGS = Math.max(
  1000,
  Number.parseInt(params.get("maxBuildings") ?? "2500", 10),
);
const HEIGHT_SCALE = Math.max(1, Number.parseFloat(params.get("heightScale") ?? "1.8"));
const BUILDING_DATA_CANDIDATES =
  params.get("buildings") === "core"
    ? ["./public/data/stl-buildings.geojson"]
    : [
        "./public/data/stl-buildings-county-render.geojson",
        "./public/data/stl-buildings.geojson",
      ];

const CAMERA_PRESETS = {
  arch: {
    lon: -90.1848,
    lat: 38.6247,
    range: 950,
    heading: 5.62,
    pitch: -0.58,
  },
  downtown: {
    lon: -90.1945,
    lat: 38.6297,
    range: 1250,
    heading: 5.42,
    pitch: -0.62,
  },
  cortex: {
    lon: -90.2518,
    lat: 38.6354,
    range: 1350,
    heading: 5.95,
    pitch: -0.6,
  },
  airport: {
    lon: -90.3701,
    lat: 38.7487,
    range: 2600,
    heading: 3.04,
    pitch: -0.66,
  },
};

const COLORS = {
  building: Cesium.Color.fromCssColorString("#35c2cf").withAlpha(0.58),
  tall: Cesium.Color.fromCssColorString("#f4d35e").withAlpha(0.9),
  site: Cesium.Color.fromCssColorString("#ff6b6b"),
  river: Cesium.Color.fromCssColorString("#4cc9f0"),
  civic: Cesium.Color.fromCssColorString("#7bd88f"),
  freight: Cesium.Color.fromCssColorString("#f4a261"),
  trafficHigh: Cesium.Color.fromCssColorString("#ff3b30").withAlpha(0.92),
  trafficMedium: Cesium.Color.fromCssColorString("#ffb703").withAlpha(0.9),
  aircraft: Cesium.Color.fromCssColorString("#8bd3ff"),
  rail: Cesium.Color.fromCssColorString("#c77dff"),
  bus: Cesium.Color.fromCssColorString("#62d2a2"),
};

const elements = {
  buildingCount: document.querySelector("#buildingCount"),
  liveCount: document.querySelector("#liveCount"),
  trafficCount: document.querySelector("#trafficCount"),
  aircraftCount: document.querySelector("#aircraftCount"),
  transitCount: document.querySelector("#transitCount"),
  weatherStatus: document.querySelector("#weatherStatus"),
  tileMode: document.querySelector("#tileMode"),
  status: document.querySelector("#renderStatus"),
  liveFeed: document.querySelector("#liveFeed"),
  feedClock: document.querySelector("#feedClock"),
  commandInput: document.querySelector("#commandInput"),
  googleKey: document.querySelector("#googleKey"),
};

const viewer = new Cesium.Viewer("cesiumContainer", {
  animation: false,
  baseLayerPicker: false,
  baseLayer: new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      credit: "OpenStreetMap contributors",
      maximumLevel: 19,
    }),
  ),
  fullscreenButton: false,
  geocoder: false,
  homeButton: false,
  infoBox: true,
  navigationHelpButton: false,
  sceneModePicker: false,
  selectionIndicator: true,
  timeline: false,
  terrainProvider: new Cesium.EllipsoidTerrainProvider(),
});

viewer.scene.globe.depthTestAgainstTerrain = false;
viewer.scene.skyAtmosphere.show = true;
viewer.scene.requestRenderMode = false;
viewer.scene.fog.enabled = true;
viewer.scene.fog.density = 0.00012;
viewer.scene.sun.show = true;
viewer.scene.moon.show = false;
viewer.scene.highDynamicRange = false;
viewer.scene.shadowMap.enabled = false;
viewer.resolutionScale = window.devicePixelRatio > 1 ? 0.9 : 1;

let buildingPrimitive;
let siteSource;
let trafficSource;
let googleTileset;
let activeTrackId = null;
let localLiveMode = true;
let latestLiveObjects = [];
let latestAircraft = [];
let latestTransit = [];
let latestTraffic = [];
let latestWeather = null;

const liveEntities = new Map();
const aircraftEntities = new Map();
const transitEntities = new Map();
const liveObjects = [
  {
    id: "river-1",
    label: "River unit",
    type: "river",
    color: COLORS.river,
    path: [
      [-90.1832, 38.6042],
      [-90.1815, 38.6191],
      [-90.1772, 38.6391],
      [-90.1714, 38.6624],
    ],
    phase: 0.05,
    speed: 0.018,
  },
  {
    id: "civic-2",
    label: "Civic field team",
    type: "civic",
    color: COLORS.civic,
    path: [
      [-90.2332, 38.6359],
      [-90.2194, 38.6354],
      [-90.2028, 38.6314],
      [-90.1916, 38.6286],
    ],
    phase: 0.34,
    speed: 0.011,
  },
  {
    id: "freight-7",
    label: "Freight check",
    type: "freight",
    color: COLORS.freight,
    path: [
      [-90.3065, 38.6221],
      [-90.2764, 38.6207],
      [-90.2401, 38.6195],
      [-90.2054, 38.6164],
    ],
    phase: 0.66,
    speed: 0.014,
  },
];

window.stlWorld = {
  viewer,
  flyToPreset,
  liveEntities,
  aircraftEntities,
  transitEntities,
};

function setStatus(text) {
  elements.status.textContent = text;
}

function flyToPreset(name) {
  const preset = CAMERA_PRESETS[name] ?? CAMERA_PRESETS.downtown;
  const target = Cesium.Cartesian3.fromDegrees(preset.lon, preset.lat, 0);
  viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 320), {
    offset: new Cesium.HeadingPitchRange(preset.heading, preset.pitch, preset.range),
    duration: 1.4,
  });
}

function parseLengthMeters(value) {
  if (value === null || value === undefined) return Number.NaN;

  const text = String(value).trim().toLowerCase();
  const number = Number.parseFloat(text.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(number) || number <= 0) return Number.NaN;

  if (text.includes("ft") || text.includes("feet") || text.includes("'")) {
    return number * 0.3048;
  }

  return number;
}

function featureHeight(feature) {
  const rawHeight = feature.properties?.height;
  const rawLevels = feature.properties?.["building:levels"];
  const parsedHeight = parseLengthMeters(rawHeight);
  const parsedLevels = Number.parseFloat(String(rawLevels ?? ""));

  if (Number.isFinite(parsedHeight) && parsedHeight > 0) return parsedHeight;
  if (Number.isFinite(parsedLevels) && parsedLevels > 0) return parsedLevels * 3.2;
  return 8;
}

function featureColor(feature) {
  return featureHeight(feature) >= 45 ? COLORS.tall : COLORS.building;
}

function featureCentroid(feature) {
  const ring = feature.geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length === 0) return [ST_LOUIS.lon, ST_LOUIS.lat];

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

function rankBuildingFeature(feature) {
  const [lon, lat] = featureCentroid(feature);
  const downtownDistance = Math.hypot(lon + 90.1945, lat - 38.6297);
  const cortexDistance = Math.hypot(lon + 90.2518, lat - 38.6354);
  const namedBoost = feature.properties?.name ? 80 : 0;
  const heightBoost = featureHeight(feature) * 7;
  const locationBoost = 1 / Math.max(Math.min(downtownDistance, cortexDistance), 0.0008);
  const id = String(feature.properties?.osm_id ?? "");
  const stableJitter = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 17;
  return namedBoost + heightBoost + locationBoost + stableJitter;
}

function selectRenderableBuildings(geojson) {
  if (!Array.isArray(geojson.features)) return geojson;
  if (geojson.features.length <= MAX_RENDERED_BUILDINGS) return geojson;

  const selected = [...geojson.features]
    .sort((a, b) => rankBuildingFeature(b) - rankBuildingFeature(a))
    .slice(0, MAX_RENDERED_BUILDINGS);

  return {
    ...geojson,
    metadata: {
      ...geojson.metadata,
      sourceFeatureCount: geojson.features.length,
      renderedFeatureCount: selected.length,
    },
    features: selected,
  };
}

async function fetchFirstJson(urls) {
  let lastError;

  for (const url of urls) {
    try {
      const response = await fetch(`${url}?ts=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status}: ${url}`);
      return response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function loadBuildings() {
  const sourceGeojson = await fetchFirstJson(BUILDING_DATA_CANDIDATES);
  const geojson = selectRenderableBuildings(sourceGeojson);
  const instances = [];

  for (const feature of geojson.features) {
    const ring = feature.geometry?.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length < 4) continue;

    const degrees = [];
    for (const coordinate of ring) {
      const lon = Number(coordinate[0]);
      const lat = Number(coordinate[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        degrees.push(lon, lat);
      }
    }

    if (degrees.length < 8) continue;

    try {
      const height = featureHeight(feature);
      const geometry = Cesium.PolygonGeometry.fromPositions({
        positions: Cesium.Cartesian3.fromDegreesArray(degrees),
        height: Math.min(Math.max(height * HEIGHT_SCALE, 10), 280),
        extrudedHeight: 0,
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      });

      instances.push(
        new Cesium.GeometryInstance({
          id: feature.properties?.osm_id,
          geometry,
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(featureColor(feature)),
          },
        }),
      );
    } catch {
      // Skip malformed OSM footprints without failing the whole city layer.
    }
  }

  buildingPrimitive = viewer.scene.primitives.add(
    new Cesium.Primitive({
      geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({
        closed: true,
        translucent: true,
      }),
      asynchronous: false,
      releaseGeometryInstances: true,
    }),
  );
  window.stlWorld.buildingPrimitive = buildingPrimitive;

  const sourceCount = geojson.metadata?.sourceFeatureCount;
  elements.buildingCount.textContent = sourceCount
    ? `${new Intl.NumberFormat().format(instances.length)} / ${new Intl.NumberFormat().format(sourceCount)}`
    : new Intl.NumberFormat().format(instances.length);
}

async function loadSites() {
  const geojson = await fetch("./public/data/stl-sites.geojson").then((response) => response.json());
  siteSource = await Cesium.GeoJsonDataSource.load(geojson, {
    markerColor: COLORS.site,
    markerSize: 40,
    clampToGround: true,
  });
  viewer.dataSources.add(siteSource);

  for (const entity of siteSource.entities.values) {
    entity.billboard = undefined;
    entity.point = new Cesium.PointGraphics({
      pixelSize: 10,
      color: COLORS.site,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 1.5,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    });
    entity.label = new Cesium.LabelGraphics({
      text: entity.properties?.name?.getValue?.() ?? "Site",
      font: "600 13px Inter, sans-serif",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -18),
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 9000),
    });
  }
}

function interpolatePath(path, amount) {
  const total = path.length - 1;
  const scaled = (amount % 1) * total;
  const index = Math.floor(scaled);
  const nextIndex = Math.min(index + 1, path.length - 1);
  const local = scaled - index;
  const start = path[index];
  const end = path[nextIndex];
  return [
    start[0] + (end[0] - start[0]) * local,
    start[1] + (end[1] - start[1]) * local,
  ];
}

function upsertLiveEntity(object) {
  let entity = liveEntities.get(object.id);
  const color = object.color ?? COLORS.civic;

  if (!entity) {
    entity = viewer.entities.add({
      id: object.id,
      name: object.label,
      point: {
        pixelSize: 12,
        color,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: object.id,
        font: "700 12px Inter, sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 12000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    liveEntities.set(object.id, entity);
  }

  entity.position = Cesium.Cartesian3.fromDegrees(object.lon, object.lat, object.alt ?? 12);
  entity.show = document.querySelector("#liveToggle").checked;
  return entity;
}

function updateLocalLiveLayer() {
  if (!localLiveMode) return;

  const nowSeconds = Date.now() / 1000;
  const feed = liveObjects.map((object) => {
    const position = interpolatePath(object.path, object.phase + nowSeconds * object.speed);
    return {
      ...object,
      lon: position[0],
      lat: position[1],
      alt: 12,
      status: activeTrackId === object.id ? "tracking" : "active",
    };
  });

  applyLiveFeed(feed);
}

function applyLiveFeed(objects) {
  latestLiveObjects = objects;

  for (const object of objects) {
    upsertLiveEntity(object);
  }

  for (const [id, entity] of liveEntities) {
    if (!objects.some((object) => object.id === id)) {
      entity.show = false;
    }
  }

  elements.liveCount.textContent = String(objects.length);
  elements.feedClock.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  elements.liveFeed.replaceChildren(
    ...buildFeedItems().map((object) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      const detail = document.createElement("small");
      name.textContent = object.label ?? object.id;
      detail.textContent = object.status ?? "active";
      li.append(name, detail);
      return li;
    }),
  );

  if (activeTrackId) {
    const tracked = objects.find((object) => object.id === activeTrackId);
    if (tracked) {
      viewer.camera.lookAt(
        Cesium.Cartesian3.fromDegrees(tracked.lon, tracked.lat, 160),
        new Cesium.Cartesian3(0, -420, 260),
      );
    }
  }
}

function buildFeedItems() {
  return [
    ...latestLiveObjects.slice(0, 4),
    ...latestAircraft.slice(0, 5).map((aircraft) => ({
      label: aircraft.callsign || aircraft.id,
      status: `${Math.round(aircraft.altitudeFeet ?? 0).toLocaleString()} ft`,
    })),
    ...latestTransit
      .filter((vehicle) => vehicle.mode === "rail")
      .slice(0, 4)
      .map((vehicle) => ({
        label: vehicle.label,
        status: "rail",
      })),
    ...latestTraffic.slice(0, 4).map((feature) => ({
      label: feature.properties?.TYPE_CODE ?? feature.properties?.layerName ?? "Traffic",
      status: feature.properties?.severity ?? "active",
    })),
  ].slice(0, 14);
}

function refreshFeedList() {
  elements.liveFeed.replaceChildren(
    ...buildFeedItems().map((object) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      const detail = document.createElement("small");
      name.textContent = object.label ?? object.id ?? "Feed";
      detail.textContent = object.status ?? "active";
      li.append(name, detail);
      return li;
    }),
  );
}

function headingQuaternion(position, headingDeg, pitchDeg = 0) {
  return Cesium.Transforms.headingPitchRollQuaternion(
    position,
    new Cesium.HeadingPitchRoll(
      Cesium.Math.toRadians((headingDeg ?? 0) - 90),
      Cesium.Math.toRadians(pitchDeg),
      0,
    ),
  );
}

async function pollAircraftFeed() {
  try {
    const response = await fetch(`./public/data/aircraft-feed.json?ts=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) return;

    const data = await response.json();
    const aircraft = Array.isArray(data.aircraft) ? data.aircraft : [];
    latestAircraft = aircraft;

    for (const item of aircraft) {
      if (!Number.isFinite(item.lon) || !Number.isFinite(item.lat)) continue;
      const id = `aircraft-${item.id}`;
      let entity = aircraftEntities.get(id);
      const position = Cesium.Cartesian3.fromDegrees(
        item.lon,
        item.lat,
        item.renderAltitudeMeters ?? 900,
      );

      if (!entity) {
        entity = viewer.entities.add({
          id,
          name: item.callsign || item.id,
          model: {
            uri: "./public/models/aircraft.gltf",
            scale: 55,
            minimumPixelSize: 26,
            maximumScale: 220,
          },
          label: {
            text: item.callsign || item.id,
            font: "700 12px Inter, sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -24),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 55000),
          },
          path: {
            material: COLORS.aircraft.withAlpha(0.36),
            width: 2,
            trailTime: 90,
          },
        });
        aircraftEntities.set(id, entity);
      }

      entity.position = position;
      entity.orientation = headingQuaternion(position, item.trackDeg ?? 0, 0);
      entity.show = document.querySelector("#aircraftToggle").checked;
      entity.label.text = item.callsign || item.id;
    }

    for (const [id, entity] of aircraftEntities) {
      if (!aircraft.some((item) => `aircraft-${item.id}` === id)) entity.show = false;
    }

    elements.aircraftCount.textContent = String(aircraft.length);
    refreshFeedList();
  } catch (error) {
    console.warn(error);
  }
}

async function pollTransitFeed() {
  try {
    const response = await fetch(`./public/data/transit-feed.json?ts=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) return;

    const data = await response.json();
    const vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
    latestTransit = vehicles;

    for (const vehicle of vehicles) {
      if (!Number.isFinite(vehicle.lon) || !Number.isFinite(vehicle.lat)) continue;
      const id = `transit-${vehicle.id}`;
      let entity = transitEntities.get(id);
      const isRail = vehicle.mode === "rail";
      const position = Cesium.Cartesian3.fromDegrees(vehicle.lon, vehicle.lat, isRail ? 22 : 14);

      if (!entity) {
        entity = viewer.entities.add({
          id,
          name: vehicle.label,
          point: isRail
            ? undefined
            : {
                pixelSize: 8,
                color: COLORS.bus,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 1.5,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
          box: isRail
            ? {
                dimensions: new Cesium.Cartesian3(72, 18, 18),
                material: COLORS.rail.withAlpha(0.88),
                outline: true,
                outlineColor: Cesium.Color.WHITE.withAlpha(0.55),
              }
            : undefined,
          label: {
            text: vehicle.label,
            font: "700 11px Inter, sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -16),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, isRail ? 18000 : 7000),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        transitEntities.set(id, entity);
      }

      entity.position = position;
      entity.orientation = headingQuaternion(position, vehicle.bearingDeg ?? 0, 0);
      entity.show = document.querySelector("#transitToggle").checked;
      entity.label.text = vehicle.label;
    }

    for (const [id, entity] of transitEntities) {
      if (!vehicles.some((vehicle) => `transit-${vehicle.id}` === id)) entity.show = false;
    }

    const railCount = vehicles.filter((vehicle) => vehicle.mode === "rail").length;
    elements.transitCount.textContent = `${railCount}/${vehicles.length}`;
    refreshFeedList();
  } catch (error) {
    console.warn(error);
  }
}

async function pollTrafficFeed() {
  try {
    const response = await fetch(`./public/data/traffic-feed.geojson?ts=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) return;

    const geojson = await response.json();
    latestTraffic = Array.isArray(geojson.features) ? geojson.features : [];
    if (trafficSource) {
      viewer.dataSources.remove(trafficSource, true);
      trafficSource = undefined;
    }

    trafficSource = await Cesium.GeoJsonDataSource.load(geojson, {
      clampToGround: true,
    });
    viewer.dataSources.add(trafficSource);

    for (const entity of trafficSource.entities.values) {
      const severity = entity.properties?.severity?.getValue?.();
      const color = severity === "high" ? COLORS.trafficHigh : COLORS.trafficMedium;

      if (entity.polyline) {
        entity.polyline.width = severity === "high" ? 6 : 4;
        entity.polyline.material = color;
        entity.polyline.clampToGround = true;
      }

      if (entity.position) {
        entity.point = new Cesium.PointGraphics({
          pixelSize: severity === "high" ? 13 : 10,
          color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
        entity.label = new Cesium.LabelGraphics({
          text: entity.properties?.TYPE_CODE?.getValue?.() ?? "Traffic",
          font: "700 11px Inter, sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 9500),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      }
    }

    trafficSource.show = document.querySelector("#trafficToggle").checked;
    elements.trafficCount.textContent = String(latestTraffic.length);
    refreshFeedList();
  } catch (error) {
    console.warn(error);
  }
}

async function pollWeatherFeed() {
  try {
    const response = await fetch(`./public/data/weather-feed.json?ts=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) return;

    latestWeather = await response.json();
    const tempF =
      Number.isFinite(latestWeather.temperatureC) ? latestWeather.temperatureC * (9 / 5) + 32 : null;
    elements.weatherStatus.textContent = tempF
      ? `${Math.round(tempF)}F`
      : String(latestWeather.description ?? "--").slice(0, 8);
    refreshFeedList();
  } catch (error) {
    console.warn(error);
  }
}

function startWeatherAnimation() {
  const canvas = document.querySelector("#weatherCanvas");
  const context = canvas.getContext("2d");
  const particles = Array.from({ length: 120 }, () => ({
    x: Math.random(),
    y: Math.random(),
    speed: 0.25 + Math.random() * 0.8,
    length: 10 + Math.random() * 28,
    alpha: 0.08 + Math.random() * 0.22,
  }));

  function resize() {
    canvas.width = window.innerWidth * window.devicePixelRatio;
    canvas.height = window.innerHeight * window.devicePixelRatio;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
  }

  function draw() {
    const visible = document.querySelector("#weatherToggle").checked;
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (visible) {
      const windDeg = Number.isFinite(latestWeather?.windDirectionDeg)
        ? latestWeather.windDirectionDeg
        : 260;
      const windSpeed = Number.isFinite(latestWeather?.windSpeedMps)
        ? Math.max(latestWeather.windSpeedMps, 1)
        : 4;
      const condition = String(latestWeather?.description ?? "").toLowerCase();
      const wet = /rain|drizzle|storm|snow|mist|fog/.test(condition);
      const angle = Cesium.Math.toRadians(windDeg - 180);
      const dx = Math.sin(angle);
      const dy = -Math.cos(angle);

      for (const particle of particles) {
        particle.x = (particle.x + dx * particle.speed * windSpeed * 0.00022 + 1) % 1;
        particle.y = (particle.y + dy * particle.speed * windSpeed * 0.00022 + 1) % 1;

        const x = particle.x * canvas.width;
        const y = particle.y * canvas.height;
        const length = particle.length * (wet ? 1.6 : 1);
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x - dx * length, y - dy * length);
        context.strokeStyle = wet
          ? `rgba(125, 211, 252, ${particle.alpha + 0.12})`
          : `rgba(255, 255, 255, ${particle.alpha})`;
        context.lineWidth = wet ? 1.6 : 1;
        context.stroke();
      }
    }

    requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(draw);
}

async function pollExternalFeed() {
  try {
    const response = await fetch(`./public/data/live-feed.json?ts=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) return;

    const data = await response.json();
    if (Array.isArray(data.objects) && data.objects.length > 0) {
      localLiveMode = false;
      applyLiveFeed(
        data.objects.map((object, index) => ({
          id: object.id ?? `feed-${index + 1}`,
          label: object.label ?? object.id ?? `Feed ${index + 1}`,
          lon: Number(object.lon),
          lat: Number(object.lat),
          alt: Number(object.alt ?? 12),
          status: object.status ?? "feed",
          color: Cesium.Color.fromCssColorString(object.color ?? "#7bd88f"),
        })),
      );
    }
  } catch {
    localLiveMode = true;
  }
}

async function enableGoogleTiles(key) {
  if (!key) return;

  if (googleTileset) {
    viewer.scene.primitives.remove(googleTileset);
    googleTileset = undefined;
  }

  googleTileset = viewer.scene.primitives.add(
    new Cesium.Cesium3DTileset({
      url: `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(key)}`,
      showCreditsOnScreen: true,
    }),
  );

  viewer.scene.globe.show = false;
  if (buildingPrimitive) buildingPrimitive.show = false;
  document.querySelector("#buildingsToggle").checked = false;
  if (elements.tileMode) elements.tileMode.textContent = "Google";
  localStorage.setItem("stl_google_3d_key", key);

  await googleTileset.readyPromise;
  flyToPreset("arch");
}

function runCommand(rawCommand) {
  const command = rawCommand.trim().toLowerCase();
  if (!command) return;

  if (command.startsWith("fly ")) {
    flyToPreset(command.replace("fly ", "").trim());
    return;
  }

  if (command.startsWith("track ")) {
    activeTrackId = command.replace("track ", "").trim();
    return;
  }

  if (command === "untrack") {
    activeTrackId = null;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    return;
  }

  if (command === "hide buildings") {
    document.querySelector("#buildingsToggle").checked = false;
    if (buildingPrimitive) buildingPrimitive.show = false;
    return;
  }

  if (command === "show buildings") {
    document.querySelector("#buildingsToggle").checked = true;
    if (buildingPrimitive) buildingPrimitive.show = true;
  }
}

function wireControls() {
  document.querySelectorAll("[data-fly]").forEach((button) => {
    button.addEventListener("click", () => flyToPreset(button.dataset.fly));
  });

  document.querySelector("#buildingsToggle").addEventListener("change", (event) => {
    if (buildingPrimitive) buildingPrimitive.show = event.target.checked;
  });

  document.querySelector("#liveToggle").addEventListener("change", (event) => {
    for (const entity of liveEntities.values()) {
      entity.show = event.target.checked;
    }
  });

  document.querySelector("#trafficToggle").addEventListener("change", (event) => {
    if (trafficSource) trafficSource.show = event.target.checked;
  });

  document.querySelector("#aircraftToggle").addEventListener("change", (event) => {
    for (const entity of aircraftEntities.values()) {
      entity.show = event.target.checked;
    }
  });

  document.querySelector("#transitToggle").addEventListener("change", (event) => {
    for (const entity of transitEntities.values()) {
      entity.show = event.target.checked;
    }
  });

  document.querySelector("#weatherToggle").addEventListener("change", (event) => {
    document.querySelector("#weatherCanvas").style.display = event.target.checked ? "block" : "none";
  });

  document.querySelector("#sitesToggle").addEventListener("change", (event) => {
    if (siteSource) siteSource.show = event.target.checked;
  });

  document.querySelector("#shadowsToggle").addEventListener("change", (event) => {
    viewer.scene.shadowMap.enabled = event.target.checked;
    viewer.shadows = event.target.checked;
  });

  document.querySelector("#runCommand").addEventListener("click", () => {
    runCommand(elements.commandInput.value);
  });

  elements.commandInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") runCommand(elements.commandInput.value);
  });

  document.querySelector("#enableGoogleTiles").addEventListener("click", () => {
    enableGoogleTiles(elements.googleKey.value.trim()).catch((error) => {
      console.error(error);
      setStatus("Tile error");
    });
  });

  const savedKey = localStorage.getItem("stl_google_3d_key");
  if (savedKey) elements.googleKey.value = savedKey;
}

async function boot() {
  try {
    setStatus("Loading");
    wireControls();
    flyToPreset("downtown");

    await Promise.all([loadBuildings(), loadSites()]);
    await Promise.allSettled([
      pollAircraftFeed(),
      pollTrafficFeed(),
      pollWeatherFeed(),
      pollTransitFeed(),
    ]);
    updateLocalLiveLayer();
    startWeatherAnimation();
    setInterval(updateLocalLiveLayer, 1000);
    setInterval(pollExternalFeed, 2500);
    setInterval(pollAircraftFeed, 10_000);
    setInterval(pollTransitFeed, 10_000);
    setInterval(pollTrafficFeed, 30_000);
    setInterval(pollWeatherFeed, 60_000);

    const queryKey = params.get("googleKey");
    if (queryKey) {
      elements.googleKey.value = queryKey;
      await enableGoogleTiles(queryKey);
    }

    setStatus("Live");
  } catch (error) {
    console.error(error);
    setStatus("Data needed");
  }
}

boot();
