// ─── City configuration framework ────────────────────────────────────────────
const CITY_CONFIGS = {
  stl: {
    name: "St. Louis, MO",
    center: { lon: -90.1994, lat: 38.627 },
    buildingData: [
      "./public/data/stl-buildings-county-render.geojson",
      "./public/data/stl-buildings.geojson",
    ],
    cameraPresets: {
      arch:     { lon: -90.1848, lat: 38.6247, range: 950,  heading: 5.62, pitch: -0.58 },
      downtown: { lon: -90.1945, lat: 38.6297, range: 1250, heading: 5.42, pitch: -0.62 },
      cortex:   { lon: -90.2518, lat: 38.6354, range: 1350, heading: 5.95, pitch: -0.6  },
      airport:  { lon: -90.3701, lat: 38.7487, range: 2600, heading: 3.04, pitch: -0.66 },
    },
  },
};

// World-city fly presets for navigating to Soho House locations
const WORLD_FLY_PRESETS = {
  nyc:       { lon: -74.0045,  lat: 40.7416,  range: 2200, heading: 5.8, pitch: -0.52 },
  chicago:   { lon: -87.6486,  lat: 41.8855,  range: 2200, heading: 5.8, pitch: -0.52 },
  la:        { lon: -118.3797, lat: 34.0902,  range: 2200, heading: 5.8, pitch: -0.52 },
  austin:    { lon: -97.7540,  lat: 30.2449,  range: 2000, heading: 5.8, pitch: -0.52 },
  nashville: { lon: -86.7832,  lat: 36.1556,  range: 2000, heading: 5.8, pitch: -0.52 },
  toronto:   { lon: -79.3841,  lat: 43.6475,  range: 2200, heading: 5.8, pitch: -0.52 },
  malibu:    { lon: -118.7201, lat: 34.0322,  range: 1400, heading: 5.8, pitch: -0.52 },
  london:    { lon: -0.1315,   lat: 51.5135,  range: 2800, heading: 5.8, pitch: -0.52 },
  shoreditch:{ lon: -0.0714,   lat: 51.5227,  range: 1400, heading: 5.8, pitch: -0.52 },
  farmhouse: { lon: -1.4682,   lat: 51.9247,  range: 1800, heading: 5.8, pitch: -0.52 },
  berlin:    { lon: 13.4019,   lat: 52.5301,  range: 2200, heading: 5.8, pitch: -0.52 },
  amsterdam: { lon: 4.8915,    lat: 52.3731,  range: 2000, heading: 5.8, pitch: -0.52 },
  istanbul:  { lon: 28.9747,   lat: 41.0333,  range: 2200, heading: 5.8, pitch: -0.52 },
  barcelona: { lon: 2.1845,    lat: 41.3832,  range: 2000, heading: 5.8, pitch: -0.52 },
  mumbai:    { lon: 72.8278,   lat: 19.1073,  range: 2200, heading: 5.8, pitch: -0.52 },
};

const params   = new URLSearchParams(window.location.search);
const CITY_KEY = params.get("city") ?? "stl";
const CITY     = CITY_CONFIGS[CITY_KEY] ?? CITY_CONFIGS.stl;

const MAX_RENDERED_BUILDINGS = Math.max(
  1000,
  Number.parseInt(params.get("maxBuildings") ?? "2500", 10),
);
const HEIGHT_SCALE = Math.max(1, Number.parseFloat(params.get("heightScale") ?? "1.8"));

// ─── SimCity neon color palette ───────────────────────────────────────────────
const COLORS = {
  // 5-tier building gradient: short → medium → tall → high-rise → skyscraper
  buildingFloor:    Cesium.Color.fromCssColorString("#0b2233").withAlpha(0.75),
  buildingLow:      Cesium.Color.fromCssColorString("#00b4d8").withAlpha(0.65),
  buildingMid:      Cesium.Color.fromCssColorString("#48c98e").withAlpha(0.72),
  buildingTall:     Cesium.Color.fromCssColorString("#f4c23f").withAlpha(0.88),
  buildingSky:      Cesium.Color.fromCssColorString("#ff3fa4").withAlpha(0.96),
  // Live layers
  site:             Cesium.Color.fromCssColorString("#ff6b6b"),
  river:            Cesium.Color.fromCssColorString("#4cc9f0"),
  civic:            Cesium.Color.fromCssColorString("#7bd88f"),
  freight:          Cesium.Color.fromCssColorString("#f4a261"),
  trafficHigh:      Cesium.Color.fromCssColorString("#ff3b30").withAlpha(0.95),
  trafficMedium:    Cesium.Color.fromCssColorString("#ffb703").withAlpha(0.92),
  aircraft:         Cesium.Color.fromCssColorString("#8bd3ff"),
  rail:             Cesium.Color.fromCssColorString("#c77dff"),
  bus:              Cesium.Color.fromCssColorString("#62d2a2"),
  // Soho House — gold
  sohoHouse:        Cesium.Color.fromCssColorString("#ffd700").withAlpha(0.95),
  sohoHouseGlow:    Cesium.Color.fromCssColorString("#ffa500").withAlpha(0.4),
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const elements = {
  buildingCount: document.querySelector("#buildingCount"),
  liveCount:     document.querySelector("#liveCount"),
  trafficCount:  document.querySelector("#trafficCount"),
  aircraftCount: document.querySelector("#aircraftCount"),
  transitCount:  document.querySelector("#transitCount"),
  weatherStatus: document.querySelector("#weatherStatus"),
  tileMode:      document.querySelector("#tileMode"),
  status:        document.querySelector("#renderStatus"),
  liveFeed:      document.querySelector("#liveFeed"),
  feedClock:     document.querySelector("#feedClock"),
  commandInput:  document.querySelector("#commandInput"),
  googleKey:     document.querySelector("#googleKey"),
  bimModal:      document.querySelector("#bimModal"),
};

// ─── Cesium viewer ────────────────────────────────────────────────────────────
const viewer = new Cesium.Viewer("cesiumContainer", {
  animation:            false,
  baseLayerPicker:      false,
  baseLayer: new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url:          "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      credit:       "© OpenStreetMap contributors, © CARTO",
      maximumLevel: 19,
    }),
  ),
  fullscreenButton:     false,
  geocoder:             false,
  homeButton:           false,
  infoBox:              false,
  navigationHelpButton: false,
  sceneModePicker:      false,
  selectionIndicator:   false,
  timeline:             false,
  terrainProvider:      new Cesium.EllipsoidTerrainProvider(),
});

// Scene settings
viewer.scene.globe.depthTestAgainstTerrain = false;
viewer.scene.skyAtmosphere.show          = true;
viewer.scene.requestRenderMode           = false;
viewer.scene.fog.enabled                 = true;
viewer.scene.fog.density                 = 0.00012;
viewer.scene.sun.show                    = true;
viewer.scene.moon.show                   = false;
viewer.scene.highDynamicRange            = true;
viewer.scene.shadowMap.enabled           = false;
viewer.resolutionScale                   = window.devicePixelRatio > 1 ? 0.9 : 1;

// SimCity bloom post-processing
const bloom = viewer.scene.postProcessStages.add(
  Cesium.PostProcessStageLibrary.createBloomStage(),
);
bloom.uniforms.contrast   = 96;
bloom.uniforms.brightness = -0.28;
bloom.uniforms.glowOnly   = false;
bloom.uniforms.delta      = 1.0;
bloom.uniforms.sigma      = 2.4;
bloom.uniforms.stepSize   = 1.2;

// ─── State ────────────────────────────────────────────────────────────────────
let buildingPrimitive;
let siteSource;
let trafficSource;
let googleTileset;
let activeTrackId   = null;
let localLiveMode   = true;
let latestLiveObjects = [];
let latestAircraft    = [];
let latestTransit     = [];
let latestTraffic     = [];
let latestWeather     = null;

const liveEntities    = new Map();
const aircraftEntities = new Map();
const transitEntities  = new Map();
const sohoEntities     = new Map();

// Simulated live objects (river barge, civic van, freight truck)
const liveObjects = [
  {
    id: "river-1", label: "River unit", type: "river", color: COLORS.river,
    path: [[-90.1832,38.6042],[-90.1815,38.6191],[-90.1772,38.6391],[-90.1714,38.6624]],
    phase: 0.05, speed: 0.018,
  },
  {
    id: "civic-2", label: "Civic field team", type: "civic", color: COLORS.civic,
    path: [[-90.2332,38.6359],[-90.2194,38.6354],[-90.2028,38.6314],[-90.1916,38.6286]],
    phase: 0.34, speed: 0.011,
  },
  {
    id: "freight-7", label: "Freight check", type: "freight", color: COLORS.freight,
    path: [[-90.3065,38.6221],[-90.2764,38.6207],[-90.2401,38.6195],[-90.2054,38.6164]],
    phase: 0.66, speed: 0.014,
  },
];

// ─── Global export ────────────────────────────────────────────────────────────
window.stlWorld = { viewer, flyToPreset, liveEntities, aircraftEntities, transitEntities };

// ─── Utilities ────────────────────────────────────────────────────────────────
function setStatus(text) { elements.status.textContent = text; }

function flyToPreset(name) {
  const preset = CITY.cameraPresets[name]
    ?? WORLD_FLY_PRESETS[name]
    ?? CITY.cameraPresets.downtown;
  const target = Cesium.Cartesian3.fromDegrees(preset.lon, preset.lat, 0);
  viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 320), {
    offset:   new Cesium.HeadingPitchRange(preset.heading, preset.pitch, preset.range),
    duration: 1.6,
  });
}

function parseLengthMeters(value) {
  if (value === null || value === undefined) return Number.NaN;
  const text   = String(value).trim().toLowerCase();
  const number = Number.parseFloat(text.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(number) || number <= 0) return Number.NaN;
  if (text.includes("ft") || text.includes("feet") || text.includes("'")) return number * 0.3048;
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
  const h = featureHeight(feature);
  if (h >= 100) return COLORS.buildingSky;
  if (h >= 50)  return COLORS.buildingTall;
  if (h >= 20)  return COLORS.buildingMid;
  if (h >= 10)  return COLORS.buildingLow;
  return COLORS.buildingFloor;
}

function featureCentroid(feature) {
  const ring = feature.geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length === 0) return [CITY.center.lon, CITY.center.lat];
  const sum = ring.reduce(
    (acc, c) => { acc.lon += c[0]; acc.lat += c[1]; return acc; },
    { lon: 0, lat: 0 },
  );
  return [sum.lon / ring.length, sum.lat / ring.length];
}

function rankBuildingFeature(feature) {
  const [lon, lat] = featureCentroid(feature);
  const downtownDist = Math.hypot(lon + 90.1945, lat - 38.6297);
  const cortexDist   = Math.hypot(lon + 90.2518, lat - 38.6354);
  const namedBoost   = feature.properties?.name ? 80 : 0;
  const heightBoost  = featureHeight(feature) * 7;
  const locationBoost = 1 / Math.max(Math.min(downtownDist, cortexDist), 0.0008);
  const id = String(feature.properties?.osm_id ?? "");
  const stableJitter = [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 17;
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

// ─── Buildings layer ──────────────────────────────────────────────────────────
async function loadBuildings() {
  const sourceGeojson = await fetchFirstJson(CITY.buildingData);
  const geojson  = selectRenderableBuildings(sourceGeojson);
  const instances = [];

  for (const feature of geojson.features) {
    const ring = feature.geometry?.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length < 4) continue;

    const degrees = [];
    for (const coord of ring) {
      const lon = Number(coord[0]);
      const lat = Number(coord[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) degrees.push(lon, lat);
    }
    if (degrees.length < 8) continue;

    try {
      const height = featureHeight(feature);
      const geometry = Cesium.PolygonGeometry.fromPositions({
        positions:      Cesium.Cartesian3.fromDegreesArray(degrees),
        height:         Math.min(Math.max(height * HEIGHT_SCALE, 10), 280),
        extrudedHeight: 0,
        vertexFormat:   Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      });
      instances.push(new Cesium.GeometryInstance({
        id: feature.properties?.osm_id,
        geometry,
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(featureColor(feature)),
        },
      }));
    } catch {
      // Skip malformed OSM footprints.
    }
  }

  buildingPrimitive = viewer.scene.primitives.add(new Cesium.Primitive({
    geometryInstances: instances,
    appearance: new Cesium.PerInstanceColorAppearance({ closed: true, translucent: true }),
    asynchronous: false,
    releaseGeometryInstances: true,
  }));
  window.stlWorld.buildingPrimitive = buildingPrimitive;

  const sourceCount = geojson.metadata?.sourceFeatureCount;
  elements.buildingCount.textContent = sourceCount
    ? `${new Intl.NumberFormat().format(instances.length)} / ${new Intl.NumberFormat().format(sourceCount)}`
    : new Intl.NumberFormat().format(instances.length);
}

// ─── Sites layer ──────────────────────────────────────────────────────────────
async function loadSites() {
  const geojson = await fetch("./public/data/stl-sites.geojson").then((r) => r.json());
  siteSource = await Cesium.GeoJsonDataSource.load(geojson, {
    markerColor: COLORS.site,
    markerSize:  40,
    clampToGround: true,
  });
  viewer.dataSources.add(siteSource);

  for (const entity of siteSource.entities.values) {
    entity.billboard = undefined;
    entity.point = new Cesium.PointGraphics({
      pixelSize:   10,
      color:       COLORS.site,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 1.5,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    });
    entity.label = new Cesium.LabelGraphics({
      text:       entity.properties?.name?.getValue?.() ?? "Site",
      font:       "600 13px Inter, sans-serif",
      fillColor:  Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style:      Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -18),
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 9000),
    });
  }
}

// ─── Soho House layer + BIM modal ─────────────────────────────────────────────
const AMENITY_ICONS = {
  pool:      "🏊",
  cinema:    "🎬",
  restaurant:"🍽",
  gym:       "💪",
  workspace: "💻",
  bar:       "🍸",
  spa:       "🛁",
};

function generateFloorPlanSVG(props) {
  const amenities = props.amenities ?? [];
  const w = 500;
  const rowH = 34;
  const gap = 5;

  const floors = [];
  if (amenities.includes("pool"))       floors.push({ label: "Rooftop Pool & Bar",      color: "#0ea5e9" });
  if (amenities.includes("spa"))        floors.push({ label: "Spa & Wellness",            color: "#7c3aed" });
  floors.push({ label: "Members Bar & Lounge",       color: "#d97706" });
  if (amenities.includes("cinema"))     floors.push({ label: "Cinema Club",               color: "#1d4ed8" });
  if (amenities.includes("gym"))        floors.push({ label: "Fitness Center",            color: "#059669" });
  if (amenities.includes("workspace")) floors.push({ label: "Workspaces",                color: "#0891b2" });
  floors.push({ label: "Restaurant & Dining",        color: "#dc2626" });
  floors.push({ label: "Reception & Lobby",          color: "#374151" });

  const svgH = floors.length * (rowH + gap) + 16;

  const rows = floors.map((floor, i) => {
    const y = 8 + i * (rowH + gap);
    return [
      `<rect x="6" y="${y}" width="${w - 12}" height="${rowH}" rx="3" fill="${floor.color}" fill-opacity="0.22" stroke="${floor.color}" stroke-opacity="0.7" stroke-width="1"/>`,
      `<rect x="6" y="${y}" width="5" height="${rowH}" rx="3" fill="${floor.color}" fill-opacity="0.9"/>`,
      `<text x="20" y="${y + rowH / 2 + 5}" font-family="monospace,ui-monospace,Menlo" font-size="11" fill="#e2e8f0">${floor.label}</text>`,
      `<text x="${w - 10}" y="${y + rowH / 2 + 5}" font-family="monospace" font-size="10" fill="#6b7280" text-anchor="end">FL ${floors.length - i}</text>`,
    ].join("");
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${svgH}" viewBox="0 0 ${w} ${svgH}">
  <rect width="${w}" height="${svgH}" fill="#070d18" rx="6"/>
  <text x="${w / 2}" y="6" text-anchor="middle" font-family="monospace" font-size="9" fill="#374151">SCHEMATIC — NOT TO SCALE</text>
  ${rows}
</svg>`;
}

async function loadSohoHouses() {
  const geojson = await fetch("./public/data/soho-houses.geojson").then((r) => r.json());

  for (const feature of geojson.features) {
    const [lon, lat] = feature.geometry.coordinates;
    const props = feature.properties;

    const entity = viewer.entities.add({
      id:   `soho-${props.id}`,
      name: props.name,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 40),
      point: new Cesium.PointGraphics({
        pixelSize:   16,
        color:       COLORS.sohoHouse,
        outlineColor: Cesium.Color.fromCssColorString("#ffa500"),
        outlineWidth: 3,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(400, 1.8, 80000, 0.5),
      }),
      label: new Cesium.LabelGraphics({
        text:       props.name,
        font:       "700 12px Inter, sans-serif",
        fillColor:  COLORS.sohoHouse,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style:      Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -24),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 60000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      }),
      properties: props,
    });

    entity._sohoHouseData = props;
    sohoEntities.set(`soho-${props.id}`, entity);
  }

  // Show/hide on toggle
  const toggle = document.querySelector("#sohoToggle");
  if (toggle) {
    toggle.addEventListener("change", (ev) => {
      for (const e of sohoEntities.values()) e.show = ev.target.checked;
    });
  }
}

function showBimModal(props) {
  const modal = elements.bimModal;
  if (!modal) return;

  const amenityBar = (props.amenities ?? [])
    .map((a) => `<span class="amenity-chip">${AMENITY_ICONS[a] ?? "•"} ${a}</span>`)
    .join("");

  const svg = generateFloorPlanSVG(props);

  modal.innerHTML = `
    <div class="bim-panel" role="dialog" aria-modal="true">
      <button class="bim-close" id="bimClose" aria-label="Close">✕</button>
      <div class="bim-header">
        <div class="bim-logo">SH</div>
        <div>
          <p class="bim-eyebrow">Soho House · Digital Twin</p>
          <h2 class="bim-title">${props.name}</h2>
          <p class="bim-city">${props.city}</p>
        </div>
      </div>
      ${props.address ? `<p class="bim-address">📍 ${props.address}</p>` : ""}
      ${props.year_opened ? `<p class="bim-address">🏛 Opened ${props.year_opened}</p>` : ""}
      <p class="bim-desc">${props.description ?? ""}</p>
      <div class="bim-amenities">${amenityBar}</div>
      <div class="bim-section-label">SCHEMATIC FLOOR PLAN</div>
      <div class="bim-floorplan">${svg}</div>
      <p class="bim-note">Floor plan is schematic only — based on publicly available venue information.</p>
    </div>`;

  modal.classList.add("open");
  document.querySelector("#bimClose")?.addEventListener("click", hideBimModal);
  modal.addEventListener("click", (ev) => { if (ev.target === modal) hideBimModal(); });
}

function hideBimModal() {
  elements.bimModal?.classList.remove("open");
}

// ─── Live-object helpers ──────────────────────────────────────────────────────
function interpolatePath(path, amount) {
  const total  = path.length - 1;
  const scaled = (amount % 1) * total;
  const index  = Math.floor(scaled);
  const next   = Math.min(index + 1, path.length - 1);
  const local  = scaled - index;
  const start  = path[index];
  const end    = path[next];
  return [start[0] + (end[0] - start[0]) * local, start[1] + (end[1] - start[1]) * local];
}

function upsertLiveEntity(object) {
  let entity = liveEntities.get(object.id);
  const color = object.color ?? COLORS.civic;

  if (!entity) {
    entity = viewer.entities.add({
      id:   object.id,
      name: object.label,
      point: {
        pixelSize:   12,
        color,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text:       object.id,
        font:       "700 12px Inter, sans-serif",
        fillColor:  Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style:      Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 12000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    liveEntities.set(object.id, entity);
  }

  entity.position = Cesium.Cartesian3.fromDegrees(object.lon, object.lat, object.alt ?? 12);
  entity.show     = document.querySelector("#liveToggle").checked;
  return entity;
}

function updateLocalLiveLayer() {
  if (!localLiveMode) return;
  const nowSeconds = Date.now() / 1000;
  const feed = liveObjects.map((obj) => {
    const pos = interpolatePath(obj.path, obj.phase + nowSeconds * obj.speed);
    return { ...obj, lon: pos[0], lat: pos[1], alt: 12,
      status: activeTrackId === obj.id ? "tracking" : "active" };
  });
  applyLiveFeed(feed);
}

function applyLiveFeed(objects) {
  latestLiveObjects = objects;
  for (const obj of objects) upsertLiveEntity(obj);
  for (const [id, entity] of liveEntities) {
    if (!objects.some((o) => o.id === id)) entity.show = false;
  }
  elements.liveCount.textContent = String(objects.length);
  elements.feedClock.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  refreshFeedList();

  if (activeTrackId) {
    const tracked = objects.find((o) => o.id === activeTrackId);
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
    ...latestAircraft.slice(0, 5).map((a) => ({
      label: a.callsign || a.id,
      status: `${Math.round(a.altitudeFeet ?? 0).toLocaleString()} ft`,
    })),
    ...latestTransit.filter((v) => v.mode === "rail").slice(0, 4).map((v) => ({
      label: v.label, status: "rail",
    })),
    ...latestTraffic.slice(0, 4).map((f) => ({
      label: f.properties?.TYPE_CODE ?? f.properties?.layerName ?? "Traffic",
      status: f.properties?.severity ?? "active",
    })),
  ].slice(0, 14);
}

function refreshFeedList() {
  elements.liveFeed.replaceChildren(
    ...buildFeedItems().map((obj) => {
      const li     = document.createElement("li");
      const name   = document.createElement("span");
      const detail = document.createElement("small");
      name.textContent   = obj.label ?? obj.id ?? "Feed";
      detail.textContent = obj.status ?? "active";
      li.append(name, detail);
      return li;
    }),
  );
}

// ─── Aircraft ─────────────────────────────────────────────────────────────────
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
    const response = await fetch(`./public/data/aircraft-feed.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const data     = await response.json();
    const aircraft = Array.isArray(data.aircraft) ? data.aircraft : [];
    latestAircraft = aircraft;

    for (const item of aircraft) {
      if (!Number.isFinite(item.lon) || !Number.isFinite(item.lat)) continue;
      const id       = `aircraft-${item.id}`;
      let entity     = aircraftEntities.get(id);
      const position = Cesium.Cartesian3.fromDegrees(item.lon, item.lat, item.renderAltitudeMeters ?? 900);

      if (!entity) {
        entity = viewer.entities.add({
          id,
          name: item.callsign || item.id,
          model: {
            uri:           "./public/models/aircraft.gltf",
            scale:         55,
            minimumPixelSize: 26,
            maximumScale:  220,
          },
          label: {
            text:       item.callsign || item.id,
            font:       "700 12px Inter, sans-serif",
            fillColor:  COLORS.aircraft,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style:      Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -24),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 55000),
          },
          path: {
            material:  COLORS.aircraft.withAlpha(0.45),
            width:     2.5,
            trailTime: 90,
          },
        });
        aircraftEntities.set(id, entity);
      }

      entity.position    = position;
      entity.orientation = headingQuaternion(position, item.trackDeg ?? 0, 0);
      entity.show        = document.querySelector("#aircraftToggle").checked;
      entity.label.text  = item.callsign || item.id;
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

// ─── Transit ──────────────────────────────────────────────────────────────────
async function pollTransitFeed() {
  try {
    const response = await fetch(`./public/data/transit-feed.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const data     = await response.json();
    const vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
    latestTransit  = vehicles;

    for (const vehicle of vehicles) {
      if (!Number.isFinite(vehicle.lon) || !Number.isFinite(vehicle.lat)) continue;
      const id     = `transit-${vehicle.id}`;
      let entity   = transitEntities.get(id);
      const isRail = vehicle.mode === "rail";
      const position = Cesium.Cartesian3.fromDegrees(vehicle.lon, vehicle.lat, isRail ? 22 : 14);

      if (!entity) {
        entity = viewer.entities.add({
          id,
          name: vehicle.label,
          point: isRail ? undefined : {
            pixelSize:   8,
            color:       COLORS.bus,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1.5,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          box: isRail ? {
            dimensions:   new Cesium.Cartesian3(72, 18, 18),
            material:     COLORS.rail.withAlpha(0.88),
            outline:      true,
            outlineColor: Cesium.Color.WHITE.withAlpha(0.55),
          } : undefined,
          label: {
            text:       vehicle.label,
            font:       "700 11px Inter, sans-serif",
            fillColor:  Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style:      Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -16),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, isRail ? 18000 : 7000),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        transitEntities.set(id, entity);
      }

      entity.position    = position;
      entity.orientation = headingQuaternion(position, vehicle.bearingDeg ?? 0, 0);
      entity.show        = document.querySelector("#transitToggle").checked;
      entity.label.text  = vehicle.label;
    }

    for (const [id, entity] of transitEntities) {
      if (!vehicles.some((v) => `transit-${v.id}` === id)) entity.show = false;
    }

    const railCount = vehicles.filter((v) => v.mode === "rail").length;
    elements.transitCount.textContent = `${railCount}/${vehicles.length}`;
    refreshFeedList();
  } catch (error) {
    console.warn(error);
  }
}

// ─── Traffic ──────────────────────────────────────────────────────────────────
async function pollTrafficFeed() {
  try {
    const response = await fetch(`./public/data/traffic-feed.geojson?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const geojson  = await response.json();
    latestTraffic  = Array.isArray(geojson.features) ? geojson.features : [];

    if (trafficSource) {
      viewer.dataSources.remove(trafficSource, true);
      trafficSource = undefined;
    }

    trafficSource = await Cesium.GeoJsonDataSource.load(geojson, { clampToGround: true });
    viewer.dataSources.add(trafficSource);

    for (const entity of trafficSource.entities.values) {
      const severity = entity.properties?.severity?.getValue?.();
      const color    = severity === "high" ? COLORS.trafficHigh : COLORS.trafficMedium;
      if (entity.polyline) {
        entity.polyline.width        = severity === "high" ? 6 : 4;
        entity.polyline.material     = color;
        entity.polyline.clampToGround = true;
      }
      if (entity.position) {
        entity.point = new Cesium.PointGraphics({
          pixelSize:   severity === "high" ? 13 : 10,
          color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
        entity.label = new Cesium.LabelGraphics({
          text:       entity.properties?.TYPE_CODE?.getValue?.() ?? "Traffic",
          font:       "700 11px Inter, sans-serif",
          fillColor:  Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style:      Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -18),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 9500),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      }
    }

    trafficSource.show               = document.querySelector("#trafficToggle").checked;
    elements.trafficCount.textContent = String(latestTraffic.length);
    refreshFeedList();
  } catch (error) {
    console.warn(error);
  }
}

// ─── Weather ──────────────────────────────────────────────────────────────────
async function pollWeatherFeed() {
  try {
    const response = await fetch(`./public/data/weather-feed.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    latestWeather  = await response.json();
    const tempF    = Number.isFinite(latestWeather.temperatureC)
      ? latestWeather.temperatureC * (9 / 5) + 32
      : null;
    elements.weatherStatus.textContent = tempF
      ? `${Math.round(tempF)}°F`
      : String(latestWeather.description ?? "--").slice(0, 8);
  } catch (error) {
    console.warn(error);
  }
}

function startWeatherAnimation() {
  const canvas  = document.querySelector("#weatherCanvas");
  const ctx     = canvas.getContext("2d");
  const particles = Array.from({ length: 120 }, () => ({
    x:      Math.random(),
    y:      Math.random(),
    speed:  0.25 + Math.random() * 0.8,
    length: 10 + Math.random() * 28,
    alpha:  0.08 + Math.random() * 0.22,
  }));

  function resize() {
    canvas.width  = window.innerWidth  * window.devicePixelRatio;
    canvas.height = window.innerHeight * window.devicePixelRatio;
    canvas.style.width  = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
  }

  function draw() {
    const visible = document.querySelector("#weatherToggle").checked;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (visible) {
      const windDeg   = Number.isFinite(latestWeather?.windDirectionDeg) ? latestWeather.windDirectionDeg : 260;
      const windSpeed = Number.isFinite(latestWeather?.windSpeedMps) ? Math.max(latestWeather.windSpeedMps, 1) : 4;
      const condition = String(latestWeather?.description ?? "").toLowerCase();
      const wet       = /rain|drizzle|storm|snow|mist|fog/.test(condition);
      const angle     = Cesium.Math.toRadians(windDeg - 180);
      const dx        = Math.sin(angle);
      const dy        = -Math.cos(angle);
      for (const p of particles) {
        p.x = (p.x + dx * p.speed * windSpeed * 0.00022 + 1) % 1;
        p.y = (p.y + dy * p.speed * windSpeed * 0.00022 + 1) % 1;
        const x = p.x * canvas.width;
        const y = p.y * canvas.height;
        const len = p.length * (wet ? 1.6 : 1);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - dx * len, y - dy * len);
        ctx.strokeStyle = wet
          ? `rgba(125, 211, 252, ${p.alpha + 0.12})`
          : `rgba(255, 255, 255, ${p.alpha})`;
        ctx.lineWidth = wet ? 1.6 : 1;
        ctx.stroke();
      }
    }
    requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(draw);
}

// ─── External feed ────────────────────────────────────────────────────────────
async function pollExternalFeed() {
  try {
    const response = await fetch(`./public/data/live-feed.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (Array.isArray(data.objects) && data.objects.length > 0) {
      localLiveMode = false;
      applyLiveFeed(data.objects.map((obj, i) => ({
        id:     obj.id ?? `feed-${i + 1}`,
        label:  obj.label ?? obj.id ?? `Feed ${i + 1}`,
        lon:    Number(obj.lon),
        lat:    Number(obj.lat),
        alt:    Number(obj.alt ?? 12),
        status: obj.status ?? "feed",
        color:  Cesium.Color.fromCssColorString(obj.color ?? "#7bd88f"),
      })));
    }
  } catch {
    localLiveMode = true;
  }
}

// ─── Google 3D Tiles ──────────────────────────────────────────────────────────
async function enableGoogleTiles(key) {
  if (!key) return;
  if (googleTileset) {
    viewer.scene.primitives.remove(googleTileset);
    googleTileset = undefined;
  }
  googleTileset = viewer.scene.primitives.add(new Cesium.Cesium3DTileset({
    url:               `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(key)}`,
    showCreditsOnScreen: true,
  }));
  viewer.scene.globe.show = false;
  if (buildingPrimitive) buildingPrimitive.show = false;
  document.querySelector("#buildingsToggle").checked = false;
  if (elements.tileMode) elements.tileMode.textContent = "Google";
  localStorage.setItem("stl_google_3d_key", key);
  await googleTileset.readyPromise;
  flyToPreset(Object.keys(CITY.cameraPresets)[0]);
}

// ─── Command parser ───────────────────────────────────────────────────────────
function runCommand(rawCommand) {
  const cmd = rawCommand.trim().toLowerCase();
  if (!cmd) return;

  if (cmd.startsWith("fly ")) {
    flyToPreset(cmd.replace("fly ", "").trim());
    return;
  }
  if (cmd.startsWith("track ")) {
    activeTrackId = cmd.replace("track ", "").trim();
    return;
  }
  if (cmd === "untrack") {
    activeTrackId = null;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    return;
  }
  if (cmd === "hide buildings") {
    document.querySelector("#buildingsToggle").checked = false;
    if (buildingPrimitive) buildingPrimitive.show = false;
    return;
  }
  if (cmd === "show buildings") {
    document.querySelector("#buildingsToggle").checked = true;
    if (buildingPrimitive) buildingPrimitive.show = true;
    return;
  }
  if (cmd === "hide soho" || cmd === "hide soho house") {
    document.querySelector("#sohoToggle").checked = false;
    for (const e of sohoEntities.values()) e.show = false;
    return;
  }
  if (cmd === "show soho" || cmd === "show soho house") {
    document.querySelector("#sohoToggle").checked = true;
    for (const e of sohoEntities.values()) e.show = true;
    return;
  }
}

// ─── Control wiring ───────────────────────────────────────────────────────────
function wireControls() {
  document.querySelectorAll("[data-fly]").forEach((btn) => {
    btn.addEventListener("click", () => flyToPreset(btn.dataset.fly));
  });

  document.querySelector("#buildingsToggle").addEventListener("change", (ev) => {
    if (buildingPrimitive) buildingPrimitive.show = ev.target.checked;
  });
  document.querySelector("#liveToggle").addEventListener("change", (ev) => {
    for (const e of liveEntities.values()) e.show = ev.target.checked;
  });
  document.querySelector("#trafficToggle").addEventListener("change", (ev) => {
    if (trafficSource) trafficSource.show = ev.target.checked;
  });
  document.querySelector("#aircraftToggle").addEventListener("change", (ev) => {
    for (const e of aircraftEntities.values()) e.show = ev.target.checked;
  });
  document.querySelector("#transitToggle").addEventListener("change", (ev) => {
    for (const e of transitEntities.values()) e.show = ev.target.checked;
  });
  document.querySelector("#weatherToggle").addEventListener("change", (ev) => {
    document.querySelector("#weatherCanvas").style.display = ev.target.checked ? "block" : "none";
  });
  document.querySelector("#sitesToggle").addEventListener("change", (ev) => {
    if (siteSource) siteSource.show = ev.target.checked;
  });
  document.querySelector("#shadowsToggle").addEventListener("change", (ev) => {
    viewer.scene.shadowMap.enabled = ev.target.checked;
    viewer.shadows                 = ev.target.checked;
  });
  document.querySelector("#runCommand").addEventListener("click", () => {
    runCommand(elements.commandInput.value);
  });
  elements.commandInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") runCommand(elements.commandInput.value);
  });
  document.querySelector("#enableGoogleTiles").addEventListener("click", () => {
    enableGoogleTiles(elements.googleKey.value.trim()).catch((error) => {
      console.error(error); setStatus("Tile error");
    });
  });
  const savedKey = localStorage.getItem("stl_google_3d_key");
  if (savedKey) elements.googleKey.value = savedKey;

  // Click handler for Soho House BIM modal
  viewer.selectedEntityChanged.addEventListener((entity) => {
    if (entity?._sohoHouseData) {
      showBimModal(entity._sohoHouseData);
    } else {
      hideBimModal();
    }
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    setStatus("Loading");
    wireControls();
    flyToPreset(Object.keys(CITY.cameraPresets)[1] ?? "downtown");

    await Promise.all([loadBuildings(), loadSites(), loadSohoHouses()]);
    await Promise.allSettled([
      pollAircraftFeed(),
      pollTrafficFeed(),
      pollWeatherFeed(),
      pollTransitFeed(),
    ]);
    updateLocalLiveLayer();
    startWeatherAnimation();

    setInterval(updateLocalLiveLayer, 1000);
    setInterval(pollExternalFeed,    2500);
    setInterval(pollAircraftFeed,    10_000);
    setInterval(pollTransitFeed,     10_000);
    setInterval(pollTrafficFeed,     30_000);
    setInterval(pollWeatherFeed,     60_000);

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
