import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const output = resolve(projectRoot, "public/data/live-feed.json");

const tracks = [
  {
    id: "field-arch",
    label: "Arch field unit",
    color: "#4cc9f0",
    status: "moving",
    path: [
      [-90.2055, 38.628],
      [-90.1967, 38.6262],
      [-90.1883, 38.625],
      [-90.1812, 38.6253],
    ],
    speed: 0.019,
  },
  {
    id: "north-logistics",
    label: "North logistics",
    color: "#f4a261",
    status: "moving",
    path: [
      [-90.248, 38.661],
      [-90.229, 38.655],
      [-90.211, 38.646],
      [-90.196, 38.636],
    ],
    speed: 0.013,
  },
];

function interpolate(path, amount) {
  const scaled = (amount % 1) * (path.length - 1);
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

async function writeFrame() {
  const now = Date.now() / 1000;
  const objects = tracks.map((track, index) => {
    const [lon, lat] = interpolate(track.path, now * track.speed + index * 0.25);
    return {
      id: track.id,
      label: track.label,
      lon,
      lat,
      alt: 12,
      status: track.status,
      color: track.color,
    };
  });

  await writeFile(
    output,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), objects }, null, 2)}\n`,
  );
}

setInterval(writeFrame, 1500);
writeFrame().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
