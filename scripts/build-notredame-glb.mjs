// Builds public/models/notredame.glb from the scene authored in Higgsfield 3D Jutsu (hosted Blender).
//
// The cathedral was modelled in metres in the Jutsu project "Notre-Dame de Paris"; its GLB export is kept
// in scripts/notredame/jutsu-export.glb. This script drops the working camera and lights, merges the
// meshes into one node per material (named NotreDame_<Material>, which is how the viewer finds them),
// sets the final colours, and writes a Meshopt-compressed file.
//
//   node scripts/build-notredame-glb.mjs [path/to/a-newer-jutsu-export.glb]
//
// Passing a fresh export also refreshes the stored copy. Coordinates: +x east (apse), +z south, y up,
// the origin at the middle of the cathedral's length, on its axis.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRLightsPunctual, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dequantize, meshopt, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, KHRLightsPunctual])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const stored = fileURLToPath(new URL('./notredame/jutsu-export.glb', import.meta.url));
const src = await io.read(process.argv[2] ?? stored);
src.setLogger(new Logger(Logger.Verbosity.ERROR));
await src.transform(dequantize()); // the stored copy is quantized; a fresh export is left as it is

const lin = (hex) => [16, 8, 0].map((s) => { const c = ((hex >> s) & 255) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
/** Final look of each material: sRGB colour, roughness, metalness. Limestone as cleaned for the 2024 reopening. */
const LOOK = {
  Stone: [0xe2d3b2, 0.93, 0], Stone_Trim: [0xeee2c8, 0.9, 0], Stone_Dark: [0x4a4337, 1, 0], Stone_Sculpture: [0xd8c7a2, 0.86, 0],
  Portal_Tympanum_Stone: [0xd9c9a6, 0.86, 0], Portal_Door_Wood: [0x7a2a1e, 0.7, 0], Roof_Lead: [0x5b6770, 0.55, 0.35],
  Spire_Lead: [0x4f5a63, 0.5, 0.4], Copper_Verdigris: [0x5fa08c, 0.7, 0.3], Gilt: [0xf2c04a, 0.3, 1], Bronze: [0x3f5145, 0.55, 0.6],
  Belfry_Slate: [0x23262b, 0.8, 0], Vitrail_Glow_RoseWest: [0x27356e, 0.3, 0], Vitrail_Glow_RoseNorth: [0x31297a, 0.3, 0],
  Vitrail_Glow_RoseSouth: [0x6b2550, 0.3, 0], Vitrail_Glow_Lancet: [0x26315f, 0.3, 0], Plaza_Stone: [0xcfc8b8, 0.95, 0],
};

// Gather every primitive by material.
const groups = new Map();
for (const node of src.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  for (const prim of mesh.listPrimitives()) {
    const name = prim.getMaterial().getName();
    if (!LOOK[name]) throw new Error(`no look defined for material ${name}`);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ prim, matrix: node.getWorldMatrix() });
  }
}

const doc = new Document();
doc.setLogger(new Logger(Logger.Verbosity.ERROR));
doc.getRoot().getAsset().generator = 'Higgsfield 3D Jutsu (Blender) + Paris vivant Notre-Dame builder';
const buffer = doc.createBuffer();
const scene = doc.createScene('Notre_Dame');
let tris = 0;
let verts = 0;
for (const [name, prims] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
  const count = prims.reduce((n, p) => n + p.prim.getAttribute('POSITION').getCount(), 0);
  const pos = new Float32Array(count * 3);
  const norm = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const idx = [];
  let at = 0;
  for (const { prim: p, matrix: m } of prims) {
    const n = p.getAttribute('POSITION').getCount();
    // Quantized copies carry a scale and offset on the node (never a rotation); bake them in.
    const local = p.getAttribute('POSITION').getArray();
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) pos[(at + i) * 3 + k] = local[i * 3 + k] * m[k * 5] + m[12 + k];
    norm.set(p.getAttribute('NORMAL').getArray(), at * 3);
    uv.set(p.getAttribute('TEXCOORD_0').getArray(), at * 2);
    const ind = p.getIndices().getArray();
    for (let i = 0; i < ind.length; i++) idx.push(ind[i] + at);
    at += n;
  }
  const [hex, rough, metal] = LOOK[name];
  const material = doc.createMaterial(name).setBaseColorFactor([...lin(hex), 1]).setRoughnessFactor(rough).setMetallicFactor(metal);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(norm).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buffer))
    .setMaterial(material);
  scene.addChild(doc.createNode(`NotreDame_${name}`).setMesh(doc.createMesh(`NotreDame_${name}`).addPrimitive(prim)));
  tris += idx.length / 3;
  verts += count;
}

if (process.argv[2]) {
  // Keep a compact copy of the new export as the source for later rebuilds.
  await src.transform(weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14 }));
  writeFileSync(stored, await io.writeBinary(src));
}
await doc.transform(weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14 }));
const dir = new URL('../public/models/', import.meta.url);
mkdirSync(dir, { recursive: true });
const glb = await io.writeBinary(doc);
writeFileSync(new URL('notredame.glb', dir), glb);
console.log(`wrote public/models/notredame.glb: ${(glb.byteLength / 1e6).toFixed(2)} MB — ${groups.size} materials, ${verts.toLocaleString()} vertices, ${tris.toLocaleString()} triangles`);
