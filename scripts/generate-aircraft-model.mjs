import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const modelDir = resolve(projectRoot, "public/models");

const positions = new Float32Array([
  1.65, 0, 0,
  -1.2, 0.16, 0,
  -1.2, -0.16, 0,
  -0.15, 1.35, 0.02,
  -0.45, 0.08, 0.03,
  -0.15, -1.35, 0.02,
  -0.45, -0.08, 0.03,
  -1.0, 0.55, 0.02,
  -1.28, 0.07, 0.03,
  -1.0, -0.55, 0.02,
  -1.28, -0.07, 0.03,
  0.45, 0, 0.18,
  -0.85, 0, 0.14,
]);

const indices = new Uint16Array([
  0, 1, 2,
  3, 4, 1,
  0, 4, 3,
  0, 5, 6,
  0, 6, 2,
  7, 8, 1,
  9, 2, 10,
  0, 11, 1,
  0, 2, 11,
  1, 12, 2,
]);

const positionBytes = Buffer.from(positions.buffer);
const indexBytes = Buffer.from(indices.buffer);
const padding = Buffer.alloc((4 - (positionBytes.length % 4)) % 4);
const binary = Buffer.concat([positionBytes, padding, indexBytes]);

const gltf = {
  asset: { version: "2.0", generator: "StLouis3DWorld" },
  scenes: [{ nodes: [0] }],
  scene: 0,
  nodes: [{ mesh: 0 }],
  meshes: [
    {
      primitives: [
        {
          attributes: { POSITION: 0 },
          indices: 1,
          material: 0,
        },
      ],
    },
  ],
  materials: [
    {
      pbrMetallicRoughness: {
        baseColorFactor: [0.24, 0.78, 1, 1],
        metallicFactor: 0.15,
        roughnessFactor: 0.36,
      },
      emissiveFactor: [0.02, 0.16, 0.22],
    },
  ],
  buffers: [
    {
      uri: `data:application/octet-stream;base64,${binary.toString("base64")}`,
      byteLength: binary.length,
    },
  ],
  bufferViews: [
    {
      buffer: 0,
      byteOffset: 0,
      byteLength: positionBytes.length,
      target: 34962,
    },
    {
      buffer: 0,
      byteOffset: positionBytes.length + padding.length,
      byteLength: indexBytes.length,
      target: 34963,
    },
  ],
  accessors: [
    {
      bufferView: 0,
      byteOffset: 0,
      componentType: 5126,
      count: positions.length / 3,
      type: "VEC3",
      min: [-1.28, -1.35, 0],
      max: [1.65, 1.35, 0.18],
    },
    {
      bufferView: 1,
      byteOffset: 0,
      componentType: 5123,
      count: indices.length,
      type: "SCALAR",
    },
  ],
};

await mkdir(modelDir, { recursive: true });
await writeFile(resolve(modelDir, "aircraft.gltf"), `${JSON.stringify(gltf)}\n`);
console.log(`Wrote ${resolve(modelDir, "aircraft.gltf")}`);
