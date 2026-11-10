// Generates the Eiffel Tower with open observation floors and a garden setting inspired by the site
// model as a standard glTF 2.0 binary: public/models/eiffel.glb
// Usage: node scripts/build-eiffel-glb.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

/**
 * Mesh builder collecting indexed triangles (POSITION, NORMAL, INDICES) per named PBR material.
 */
class MeshBucket {
  constructor(name, mat) {
    this.name = name;
    this.mat = mat;
    this.pos = [];
    this.norm = [];
    this.idx = [];
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  addQuad(p0, p1, p2, p3, n) {
    const base = this.pos.length / 3;
    let nx = n?.[0] ?? 0;
    let ny = n?.[1] ?? 1;
    let nz = n?.[2] ?? 0;
    if (!n) {
      const ux = p1[0] - p0[0];
      const uy = p1[1] - p0[1];
      const uz = p1[2] - p0[2];
      const vx = p2[0] - p0[0];
      const vy = p2[1] - p0[1];
      const vz = p2[2] - p0[2];
      nx = uy * vz - uz * vy;
      ny = uz * vx - ux * vz;
      nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
    }
    this.pos.push(...p0, ...p1, ...p2, ...p3);
    this.norm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  addTri(p0, p1, p2, n) {
    const base = this.pos.length / 3;
    let nx = n?.[0] ?? 0;
    let ny = n?.[1] ?? 1;
    let nz = n?.[2] ?? 0;
    if (!n) {
      const ux = p1[0] - p0[0];
      const uy = p1[1] - p0[1];
      const uz = p1[2] - p0[2];
      const vx = p2[0] - p0[0];
      const vy = p2[1] - p0[1];
      const vz = p2[2] - p0[2];
      nx = uy * vz - uz * vy;
      ny = uz * vx - ux * vz;
      nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
    }
    this.pos.push(...p0, ...p1, ...p2);
    this.norm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.idx.push(base, base + 1, base + 2);
  }

  /** Structural beam between 3D points a and b with `sides`-gon cross-section. */
  addBeam(a, b, r0, r1 = r0, sides = 4, cap = false) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    const dir = [dx / len, dy / len, dz / len];
    const up = Math.abs(dir[1]) < 0.92 ? [0, 1, 0] : [1, 0, 0];
    let ux = dir[1] * up[2] - dir[2] * up[1];
    let uy = dir[2] * up[0] - dir[0] * up[2];
    let uz = dir[0] * up[1] - dir[1] * up[0];
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = dir[1] * uz - dir[2] * uy;
    const vy = dir[2] * ux - dir[0] * uz;
    const vz = dir[0] * uy - dir[1] * ux;

    const ring0 = [];
    const ring1 = [];
    for (let i = 0; i < sides; i++) {
      const ang = ((i + 0.5) / sides) * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const rx = ux * ca + vx * sa;
      const ry = uy * ca + vy * sa;
      const rz = uz * ca + vz * sa;
      ring0.push([a[0] + rx * r0, a[1] + ry * r0, a[2] + rz * r0]);
      ring1.push([b[0] + rx * r1, b[1] + ry * r1, b[2] + rz * r1]);
    }
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.addQuad(ring0[i], ring0[j], ring1[j], ring1[i]);
    }
    if (cap) {
      for (let i = 1; i < sides - 1; i++) {
        this.addTri(ring1[0], ring1[i], ring1[i + 1], dir);
        this.addTri(ring0[0], ring0[i + 1], ring0[i], [-dir[0], -dir[1], -dir[2]]);
      }
    }
  }

  /** Axis-aligned or Y-rotated box from y0 to y1 (Three.js Y-up coordinates: x, y, z). */
  addBox(cx, y0, cz, wx, wy, wz, rotY = 0, capBottom = false) {
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    const y1 = y0 + wy;
    // CCW when viewed from +Y looking down: (-x,+z) -> (+x,+z) -> (+x,-z) -> (-x,-z)
    const pts = [
      [-wx / 2, wz / 2],
      [wx / 2, wz / 2],
      [wx / 2, -wz / 2],
      [-wx / 2, -wz / 2],
    ].map(([lx, lz]) => [cx + lx * c - lz * s, cz + lx * s + lz * c]);
    const b = pts.map(([x, z]) => [x, y0, z]);
    const t = pts.map(([x, z]) => [x, y1, z]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.addQuad(b[i], b[j], t[j], t[i]);
    }
    this.addQuad(t[0], t[1], t[2], t[3], [0, 1, 0]);
    if (capBottom) this.addQuad(b[0], b[3], b[2], b[1], [0, -1, 0]);
  }

  addRing(size, opening, y, thickness) {
    const strip = (size - opening) / 2;
    for (const sign of [-1, 1]) {
      this.addBox(0, y, sign * (opening + strip) / 2, size, thickness, strip, 0, true);
      this.addBox(sign * (opening + strip) / 2, y, 0, strip, thickness, opening, 0, true);
    }
  }

  /** Tapered frustum (square/rectangular or n-gon) along Y-up. */
  addFrustum(cx0, y0, cz0, rx0, rz0, cx1, y1, cz1, rx1, rz1, segs = 16, rotY = 0, capTop = true, capBottom = false) {
    // CCW in (x, z) when viewed from +Y: x = +cos(a), z = -sin(a)
    const ring = (cx, y, cz, rx, rz) =>
      Array.from({ length: segs }, (_, i) => {
        const a = rotY + (i / segs) * Math.PI * 2;
        return [cx + Math.cos(a) * rx, y, cz - Math.sin(a) * rz];
      });
    const r0 = ring(cx0, y0, cz0, rx0, rz0);
    const r1 = ring(cx1, y1, cz1, rx1, rz1);
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      this.addQuad(r0[i], r0[j], r1[j], r1[i]);
    }
    if (capTop) {
      for (let i = 1; i < segs - 1; i++) this.addTri(r1[0], r1[i], r1[i + 1], [0, 1, 0]);
    }
    if (capBottom) {
      for (let i = 1; i < segs - 1; i++) this.addTri(r0[0], r0[i + 1], r0[i], [0, -1, 0]);
    }
  }

  /** Hemisphere / ellipsoid dome sitting at (cx, y0, cz) with radius r and height h. */
  addDome(cx, y0, cz, r, h, segs = 20, bands = 8) {
    for (let b = 0; b < bands; b++) {
      const a0 = (b / bands) * (Math.PI / 2);
      const a1 = ((b + 1) / bands) * (Math.PI / 2);
      const r0 = r * Math.cos(a0);
      const r1 = Math.max(0.02, r * Math.cos(a1));
      const ya = y0 + h * Math.sin(a0);
      const yb = y0 + h * Math.sin(a1);
      this.addFrustum(cx, ya, cz, r0, r0, cx, yb, cz, r1, r1, segs, 0, b === bands - 1, false);
    }
  }

  /** Full sphere centred at (cx, yc, cz). */
  /**
   * Organic lump for tree crowns: an ellipsoid whose surface is pushed in and out by a little
   * noise, with smooth per-vertex normals so it reads as a soft leafy mass rather than a faceted ball.
   */
  addBlob(cx, cy, cz, rx, ry, rz, seed = 0, segs = 11, bands = 7) {
    const base = this.pos.length / 3;
    const wobble = (x, y, z) =>
      0.2 * Math.sin(x * 2.3 + seed) * Math.sin(y * 2.9 + seed * 1.7) * Math.sin(z * 2.6 + seed * 0.6) +
      0.09 * Math.sin(x * 5.7 + seed * 2.1) * Math.sin(y * 6.3 + seed) * Math.sin(z * 5.2 + seed * 1.3);
    for (let b = 0; b <= bands; b++) {
      const phi = (b / bands) * Math.PI;
      for (let i = 0; i <= segs; i++) {
        const th = (i / segs) * Math.PI * 2;
        const ux = Math.sin(phi) * Math.cos(th);
        const uy = Math.cos(phi);
        const uz = Math.sin(phi) * Math.sin(th);
        // Poles and the seam share one direction each, so they stay closed.
        const f = 1 + wobble(ux * 3, uy * 3, uz * 3);
        this.pos.push(cx + ux * rx * f, cy + uy * ry * f, cz + uz * rz * f);
        const nx = ux / rx;
        const ny = uy / ry;
        const nz = uz / rz;
        const l = Math.hypot(nx, ny, nz) || 1;
        this.norm.push(nx / l, ny / l, nz / l);
      }
    }
    const row = segs + 1;
    for (let b = 0; b < bands; b++)
      for (let i = 0; i < segs; i++) {
        const a = base + b * row + i;
        const c = a + row;
        this.idx.push(a, a + 1, c, a + 1, c + 1, c); // counter-clockwise seen from outside
      }
  }

  addSphere(cx, yc, cz, r, segs = 16, bands = 6) {
    for (let b = -bands; b < bands; b++) {
      const a0 = (b / bands) * (Math.PI / 2);
      const a1 = ((b + 1) / bands) * (Math.PI / 2);
      const r0 = Math.max(0.02, r * Math.cos(a0));
      const r1 = Math.max(0.02, r * Math.cos(a1));
      const ya = yc + r * Math.sin(a0);
      const yb = yc + r * Math.sin(a1);
      this.addFrustum(cx, ya, cz, r0, r0, cx, yb, cz, r1, r1, segs, 0, b === bands - 1, b === -bands);
    }
  }
}

// ------------------------------------------------------------------ PBR Material definitions
const buckets = {
  tower_iron: new MeshBucket('Tower_Iron', {
    baseColorFactor: [0.44, 0.33, 0.24, 1.0], // authentic Eiffel bronze-brown (painted iron: mostly matte)
    metallicFactor: 0.15,
    roughnessFactor: 0.72,
  }),
  tower_fine_iron: new MeshBucket('Tower_FineIron', {
    baseColorFactor: [0.32, 0.24, 0.18, 1], metallicFactor: 0.15, roughnessFactor: 0.73,
  }),
  tower_glass_floor: new MeshBucket('Tower_GlassFloor', {
    baseColorFactor: [0.5, 0.62, 0.65, 0.28], metallicFactor: 0.05, roughnessFactor: 0.18, alphaMode: 'BLEND',
  }),
  tower_dark_iron: new MeshBucket('Tower_DarkIron', {
    baseColorFactor: [0.31, 0.23, 0.17, 1.0], // deep structural iron trim & decks
    metallicFactor: 0.15,
    roughnessFactor: 0.6,
  }),
  tower_gold: new MeshBucket('Tower_Gold', {
    baseColorFactor: [0.92, 0.73, 0.26, 1.0], // golden scientific plaques, cupola & filigree
    metallicFactor: 0.88,
    roughnessFactor: 0.24,
  }),
  tower_glass: new MeshBucket('Tower_Glass', {
    baseColorFactor: [0.32, 0.43, 0.5, 0.48], // cool reflective glass; lit interiors are enabled only at night
    metallicFactor: 0.1,
    roughnessFactor: 0.2,
    alphaMode: 'BLEND',
  }),
  tower_stone: new MeshBucket('Tower_Stone', {
    baseColorFactor: [0.84, 0.8, 0.72, 1.0], // limestone masonry anchor piers
    metallicFactor: 0.05,
    roughnessFactor: 0.85,
  }),
  plaza_stone: new MeshBucket('Plaza_Stone', {
    baseColorFactor: [0.6, 0.56, 0.49, 1.0], // Champ de Mars gravel & stone walkways
    metallicFactor: 0.04,
    roughnessFactor: 0.9,
  }),
  plaza_curb: new MeshBucket('Plaza_Curb', {
    baseColorFactor: [0.58, 0.56, 0.52, 1.0], // dark granite borders, benches & curbs
    metallicFactor: 0.08,
    roughnessFactor: 0.82,
  }),
  park_lawn: new MeshBucket('Park_Lawn', {
    baseColorFactor: [0.27, 0.43, 0.17, 1.0], // manicured parterre grass
    metallicFactor: 0.02,
    roughnessFactor: 0.92,
  }),
  park_foliage: new MeshBucket('Park_Foliage', {
    baseColorFactor: [0.2, 0.36, 0.13, 1.0], // chestnut & plane tree crowns, mid tone
    metallicFactor: 0.0,
    roughnessFactor: 0.9,
  }),
  park_foliage_dark: new MeshBucket('Park_Foliage_Dark', {
    baseColorFactor: [0.12, 0.25, 0.09, 1.0], // shaded inner and lower leaves
    metallicFactor: 0.0,
    roughnessFactor: 0.95,
  }),
  park_foliage_light: new MeshBucket('Park_Foliage_Light', {
    baseColorFactor: [0.34, 0.48, 0.16, 1.0], // sunlit outer leaves
    metallicFactor: 0.0,
    roughnessFactor: 0.85,
  }),
  tree_trunk: new MeshBucket('Tree_Trunk', {
    baseColorFactor: [0.36, 0.27, 0.2, 1.0],
    metallicFactor: 0.02,
    roughnessFactor: 0.95,
  }),
  fountain_water: new MeshBucket('Garden_Water', {
    baseColorFactor: [0.18, 0.49, 0.64, 1.0], // reflective water basins
    metallicFactor: 0.15,
    roughnessFactor: 0.12,
  }),
  lamp_glow: new MeshBucket('Lamp_Glow', {
    baseColorFactor: [1.0, 0.93, 0.75, 1.0], // Parisian streetlamp globes & fountain lights
    metallicFactor: 0.05,
    roughnessFactor: 0.15,
    emissiveFactor: [0.65, 0.52, 0.25],
  }),
};

const {
  tower_iron: iron,
  tower_dark_iron: darkIron,
  tower_fine_iron: fineIron,
  tower_glass_floor: glassFloor,
  tower_gold: gold,
  tower_glass: glass,
  tower_stone: stone,
  plaza_stone: plaza,
  plaza_curb: curb,
  park_lawn: lawn,
  park_foliage: foliage,
  park_foliage_dark: foliageDark,
  park_foliage_light: foliageLight,
  tree_trunk: trunk,
  fountain_water: water,
  lamp_glow: lampGlow,
} = buckets;

// ------------------------------------------------------------------ 1. Esplanade and east/west gardens
// A restrained site study, not a surveyed digital twin. +z points towards the Seine.
{
  // Ground stays flush with the surrounding city instead of sitting on a circular display plinth.
  plaza.addBox(0, -0.25, 0, 154, 0.5, 154, 0, true);
  for (const x of [-78, 78]) curb.addBox(x, 0, 0, 1.2, 0.12, 168);
  plaza.addBox(0, -0.12, 115, 66, 0.15, 90);
  plaza.addBox(0, -0.12, -155, 30, 0.15, 180);
  // Two landscaped gardens beside the esplanade, with softly irregular ponds.
  for (const side of [-1, 1]) {
    lawn.addBox(side * 112, -0.18, -10, 66, 0.2, 220);
    const cx = side * 115, cz = side > 0 ? 22 : -26;
    const ring = Array.from({ length: 32 }, (_, i) => {
      const a = i / 32 * Math.PI * 2;
      const r = 1 + 0.1 * Math.sin(a * 3 + side);
      return [cx + Math.cos(a) * 19 * r, 0.03, cz + Math.sin(a) * 30 * r];
    });
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      water.addTri([cx, 0.03, cz], ring[j], ring[i], [0, 1, 0]);
      curb.addBeam(ring[i], ring[j], 0.28, 0.28, 4);
    }
    for (const z of [-80, 75]) plaza.addBox(side * 112, 0.05, z, 67, 0.05, 4.5);
  }
  let treeSeed = 7;
  const rnd = () => {
    treeSeed = (Math.imul(treeSeed, 1664525) + 1013904223) >>> 0;
    return treeSeed / 4294967296;
  };
  const addTree = (tx, tz, baseY, h = 13.5, r = 5.2) => {
    h *= 0.85 + rnd() * 0.4;
    r *= 0.85 + rnd() * 0.35;
    stone.addFrustum(tx, baseY, tz, 1.6, 1.6, tx, baseY + 0.45, tz, 1.4, 1.4, 8);
    // Trunk: flared at the root, tapering, leaning slightly.
    const lean = [(rnd() - 0.5) * 0.9, (rnd() - 0.5) * 0.9];
    const forkY = baseY + h * (0.36 + rnd() * 0.08);
    const fork = [tx + lean[0], forkY, tz + lean[1]];
    trunk.addFrustum(tx, baseY + 0.45, tz, 0.85, 0.85, tx + lean[0] * 0.15, baseY + 1.6, tz + lean[1] * 0.15, 0.5, 0.5, 8, 0, false);
    trunk.addBeam([tx + lean[0] * 0.15, baseY + 1.6, tz + lean[1] * 0.15], fork, 0.5, 0.36, 7);
    const crownY = baseY + h * 0.68;
    // Limbs reach up and out into the crown.
    const limbs = 3 + Math.floor(rnd() * 3);
    const a0 = rnd() * Math.PI * 2;
    for (let k = 0; k < limbs; k++) {
      const a = a0 + (k / limbs) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
      const reach = r * (0.45 + rnd() * 0.3);
      trunk.addBeam(fork, [tx + Math.cos(a) * reach, crownY - r * 0.15 + rnd() * r * 0.4, tz + Math.sin(a) * reach], 0.3, 0.1, 5);
    }
    trunk.addBeam(fork, [tx + lean[0] * 1.6, crownY + r * 0.35, tz + lean[1] * 1.6], 0.32, 0.1, 5);
    // Crown: a shaded core, a ring of leafy masses around it and sunlit clumps on top.
    foliageDark.addBlob(tx + lean[0], crownY - r * 0.12, tz + lean[1], r * 0.82, r * 0.7, r * 0.82, rnd() * 50, 8, 5);
    const lobes = 5 + Math.floor(rnd() * 3);
    for (let k = 0; k < lobes; k++) {
      const a = a0 + (k / lobes) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
      const d = r * (0.5 + rnd() * 0.22);
      const rr = r * (0.48 + rnd() * 0.2);
      const y = crownY + (rnd() - 0.45) * r * 0.5;
      // The sun in the viewer comes from -x / +z, so lobes on that side get the lighter leaves.
      const sunny = -Math.cos(a) * 0.8 + Math.sin(a) * 0.55 > 0.25;
      (sunny ? foliageLight : foliage).addBlob(tx + lean[0] + Math.cos(a) * d, y, tz + lean[1] + Math.sin(a) * d, rr, rr * (0.78 + rnd() * 0.2), rr, rnd() * 50, 7, 4);
    }
    foliage.addBlob(tx + lean[0] * 1.3, crownY + r * 0.42, tz + lean[1] * 1.3, r * 0.62, r * 0.5, r * 0.62, rnd() * 50, 7, 4);
    foliageLight.addBlob(tx + lean[0] * 1.4 - r * 0.15, crownY + r * 0.62, tz + lean[1] * 1.4 + r * 0.1, r * 0.4, r * 0.32, r * 0.4, rnd() * 50, 6, 4);
  };

  // Helper to place a Belle Époque Parisian double/triple globe streetlamp
  const addStreetlamp = (lx, lz, baseY) => {
    darkIron.addFrustum(lx, baseY, lz, 0.55, 0.55, lx, baseY + 1.4, lz, 0.32, 0.32, 8);
    darkIron.addFrustum(lx, baseY + 1.4, lz, 0.18, 0.18, lx, baseY + 6.8, lz, 0.12, 0.12, 8);
    gold.addFrustum(lx, baseY + 6.5, lz, 0.45, 0.45, lx, baseY + 6.8, lz, 0.45, 0.45, 8);
    lampGlow.addSphere(lx, baseY + 7.35, lz, 0.38, 6, 2);
  };


  // Planting is clustered and asymmetric around the two ponds, leaving the tower's approaches open.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 24; i++) {
      const z = -108 + i * 9 + (rnd() - 0.5) * 7;
      const x = side * (87 + rnd() * 57);
      const pondZ = side > 0 ? 22 : -26;
      if (((x - side * 115) / 24) ** 2 + ((z - pondZ) / 36) ** 2 < 1) continue;
      addTree(x, z, 0, 12 + rnd() * 5, 4 + rnd() * 2);
    }
    for (const z of [-100, -58, -8, 45, 95]) addStreetlamp(side * 80, z, 0);
    for (const z of [-66, -45, 60, 83]) {
      curb.addBox(side * 86, 0.5, z, 4.5, 0.15, 1.2);
      for (const dx of [-1.7, 1.7]) darkIron.addBox(side * 86 + dx, 0, z, 0.12, 0.5, 0.7);
    }
  }
}

// ------------------------------------------------------------------ 2. Eiffel Tower Geometry (330 m)
{
  // Accurate Gustave Eiffel profile curves:
  // Outer half-width of the tower at height y (base span = 124.9 m -> half-width 62.45 m at y=0)
  const outer = (y) => {
    if (y <= 57.63) return 62.45 - (62.45 - 35.5) * (y / 57.63) ** 0.92;
    if (y <= 115.73) return 35.5 - (35.5 - 19.5) * ((y - 57.63) / (115.73 - 57.63)) ** 0.95;
    return 5.0 + 14.5 * Math.exp(-(y - 115.73) / 68) * (1 - (y - 115.73) / 240);
  };
  // Half-width of each of the 4 inclined legs at height y (0..115 m)
  const legHalf = (y) => 12.6 - (12.6 - 7.8) * (y / 115.73);

  // Helper: build a detailed cross-braced structural bay between heights y0 and y1
  // with corner box girders, horizontal frame, primary X-bracing, and secondary diamond/Warren sub-trusses.
  const addTrussBay = (y0, y1, c0, hw0, c1, hw1, mainR, braceR, subDivs = 2) => {
    const corners4 = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const lerp = (a, b, t) => a + (b - a) * t;
    const pt = (cornerIdx, t, inset = 0) => {
      const [sx, sz] = corners4[cornerIdx];
      const y = lerp(y0, y1, t);
      const cx = lerp(c0[0], c1[0], t);
      const cz = lerp(c0[1], c1[1], t);
      const hw = Math.max(0.5, lerp(hw0, hw1, t) - inset);
      return [cx + sx * hw, y, cz + sz * hw];
    };
    const mid = (p, q, f = 0.5) => [lerp(p[0], q[0], f), lerp(p[1], q[1], f), lerp(p[2], q[2], f)];

    // 4 heavy corner box girders + internal parallel chord
    for (let i = 0; i < 4; i++) {
      iron.addBeam(pt(i, 0), pt(i, 1), mainR, mainR, 6);
      darkIron.addBeam(pt(i, 0, mainR * 1.4), pt(i, 1, mainR * 1.4), mainR * 0.55, mainR * 0.55, 4);
    }

    // Subdivide bay vertically for dense authentic latticework
    for (let s = 0; s < subDivs; s++) {
      const t0 = s / subDivs;
      const t1 = (s + 1) / subDivs;
      const tm = (t0 + t1) / 2;
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        const a0 = pt(i, t0);
        const b0 = pt(j, t0);
        const a1 = pt(i, t1);
        const b1 = pt(j, t1);
        const am = pt(i, tm);
        const bm = pt(j, tm);
        const center = mid( mid(a0, b0), mid(a1, b1) );
        const topMid = mid(a1, b1);
        const botMid = mid(a0, b0);

        // Horizontal perimeter struts
        iron.addBeam(a1, b1, braceR * 1.05, braceR * 1.05, 4);
        fineIron.addBeam(am, bm, braceR * 0.65, braceR * 0.65, 4);
        // Primary St. Andrew's X-bracing
        iron.addBeam(a0, b1, braceR * 0.85, braceR * 0.85, 4);
        iron.addBeam(b0, a1, braceR * 0.85, braceR * 0.85, 4);
        // Secondary diamond lattice & vertical web stiffeners
        fineIron.addBeam(botMid, topMid, braceR * 0.55, braceR * 0.55, 4);
        fineIron.addBeam(am, topMid, braceR * 0.5, braceR * 0.5, 4);
        fineIron.addBeam(bm, topMid, braceR * 0.5, braceR * 0.5, 4);
        fineIron.addBeam(am, botMid, braceR * 0.5, braceR * 0.5, 4);
        fineIron.addBeam(bm, botMid, braceR * 0.5, braceR * 0.5, 4);
        // Internal cross-tie
        if (s === subDivs - 1) {
          fineIron.addBeam(a1, pt((i + 2) % 4, t1), braceR * 0.45, braceR * 0.45, 4);
        }
        void center;
      }
    }
  };

  // ---------------------------------------------------------------- 2A. Four Masonry Foundations & Inclined Legs (0..115 m)
  const legStages = [3.5, 10, 17.5, 25, 33, 41, 49, 57.63, 66, 75.5, 85, 95, 105, 115.73];
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ]) {
    const cAt = (y) => {
      const d = outer(y) - legHalf(y);
      return [sx * d, sz * d];
    };
    const [bx, bz] = cAt(0);
    // Stepped stone foundation piers with cornices and iron anchor shoes
    stone.addBox(bx, 0, bz, 28, 1.5, 28, 0);
    stone.addBox(bx, 1.5, bz, 26, 1.0, 26, 0);
    curb.addBox(bx, 2.5, bz, 26.5, 0.4, 26.5, 0);
    for (const [cx, cz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const px = bx + cx * (legHalf(0) - 1);
      const pz = bz + cz * (legHalf(0) - 1);
      stone.addBox(px, 2.5, pz, 4.8, 0.6, 4.8);
      darkIron.addFrustum(px, 3.1, pz, 1.7, 1.7, px, 4.1, pz, 1.3, 1.3, 8);
    }

    // Build all 13 inclined lattice stages per leg + internal inclined elevator tracks
    for (let i = 0; i < legStages.length - 1; i++) {
      const y0 = legStages[i];
      const y1 = legStages[i + 1];
      const belowFirst = y1 <= 57;
      addTrussBay(
        y0,
        y1,
        cAt(y0),
        legHalf(y0),
        cAt(y1),
        legHalf(y1),
        belowFirst ? 0.72 : 0.62,
        belowFirst ? 0.34 : 0.29,
        2,
      );
      // Inclined double-rail elevator track running through the centre of each leg
      const [x0, z0] = cAt(y0);
      const [x1, z1] = cAt(y1);
      for (const railOff of [-1.2, 1.2]) {
        darkIron.addBeam([x0 + railOff, y0, z0 - railOff], [x1 + railOff, y1, z1 - railOff], 0.28, 0.28, 4);
      }
    }
  }

  // ---------------------------------------------------------------- 2B. Four Grand Decorative Arches & Spandrel Webbing (y = 12..54 m)
  for (let side = 0; side < 4; side++) {
    const rot = (side * Math.PI) / 2;
    const rotPt = (x, y, z) => {
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      return [x * c - z * s, y, x * s + z * c];
    };
    const archSegs = 28;
    const span = 37.5;
    for (let i = 0; i < archSegs; i++) {
      const a0 = (i / archSegs) * Math.PI;
      const a1 = ((i + 1) / archSegs) * Math.PI;
      const x0 = Math.cos(a0) * span;
      const x1 = Math.cos(a1) * span;
      // Lower & upper concentric arch chords
      const yLow0 = 13 + Math.sin(a0) * 35;
      const yLow1 = 13 + Math.sin(a1) * 35;
      const yHigh0 = 15 + Math.sin(a0) * 37.8;
      const yHigh1 = 15 + Math.sin(a1) * 37.8;
      const zLow0 = outer(yLow0) - 2.2;
      const zLow1 = outer(yLow1) - 2.2;
      const zHigh0 = outer(yHigh0) - 2.2;
      const zHigh1 = outer(yHigh1) - 2.2;

      for (const zOff of [-2.8, 2.8]) {
        const pL0 = rotPt(x0, yLow0, zLow0 + zOff);
        const pL1 = rotPt(x1, yLow1, zLow1 + zOff);
        const pH0 = rotPt(x0, yHigh0, zHigh0 + zOff);
        const pH1 = rotPt(x1, yHigh1, zHigh1 + zOff);
        iron.addBeam(pL0, pL1, 0.62, 0.62, 6);
        iron.addBeam(pH0, pH1, 0.55, 0.55, 6);
        // Radial & diagonal web struts between inner and outer arch rings
        fineIron.addBeam(pL0, pH0, 0.34, 0.34, 4);
        fineIron.addBeam(pL0, pH1, 0.3, 0.3, 4);
        fineIron.addBeam(pH0, pL1, 0.3, 0.3, 4);
        // Spandrel vertical & diagonal hangers up to the 1st platform soffit (y = 55 m)
        if (i % 2 === 0) {
          const pTop = rotPt(x0, 55, outer(55) - 2.2 + zOff);
          fineIron.addBeam(pH0, pTop, 0.32, 0.32, 4);
          if (i + 2 <= archSegs) {
            const a2 = ((i + 2) / archSegs) * Math.PI;
            const pTop2 = rotPt(Math.cos(a2) * span, 55, outer(55) - 2.2 + zOff);
            fineIron.addBeam(pH0, pTop2, 0.26, 0.26, 4);
          }
        }
      }
      // Cross-ties joining the front and back planes of the arch box-section
      const pFront = rotPt(x0, yLow0, zLow0 + 2.8);
      const pBack = rotPt(x0, yLow0, zLow0 - 2.8);
      fineIron.addBeam(pFront, pBack, 0.3, 0.3, 4);
    }
  }

  // ---------------------------------------------------------------- 2C. Open first floor (57.63 m)
  {
    const level = 57.63, size = 76, opening = 32;
    darkIron.addRing(size, opening, level - 2.1, 1.3);
    iron.addRing(size + 1, opening, level - 0.8, 0.8);
    glassFloor.addRing(opening + 4.2, opening, level + 0.04, 0.12);
    for (let side = 0; side < 4; side++) {
      const rot = side * Math.PI / 2, c = Math.cos(rot), s = Math.sin(rot);
      const point = (x, y, z) => [x * c - z * s, y, x * s + z * c];
      // Narrow pavilions leave the central void open; glazing is divided by dark mullions.
      const px = -s * 28, pz = c * 28;
      darkIron.addBox(px, level + 0.12, pz, 41, 0.35, 10, rot);
      glass.addBox(px, level + 0.47, pz, 39, 3.2, 8.5, rot);
      iron.addBox(px, level + 3.67, pz, 41, 0.45, 10, rot);
      for (let x = -19; x <= 19; x += 3.8) {
        darkIron.addBeam(point(x, level + 0.47, 32.3), point(x, level + 3.67, 32.3), 0.075, 0.075, 4);
      }
      for (const z of [size / 2, opening / 2]) {
        for (let x = -size / 2; x <= size / 2; x += 3.8) {
          if (z === opening / 2 && Math.abs(x) > opening / 2) continue;
          fineIron.addBeam(point(x, level, z), point(x, level + 1.2, z), 0.055, 0.055, 4);
        }
        const half = z === opening / 2 ? opening / 2 : size / 2;
        fineIron.addBeam(point(-half, level + 1.2, z), point(half, level + 1.2, z), 0.06, 0.06, 4);
      }
      // 18 plaques on each side, represented as restrained bronze accents.
      for (let k = 0; k < 18; k++) {
        const [x, y, z] = point(-34 + k * 4, level - 1.6, size / 2 + 0.35);
        gold.addBox(x, y, z, 2.2, 0.45, 0.12, rot);
      }
    }
  }

  // ---------------------------------------------------------------- 2D. Light connecting frame and second floor (115.73 m)
  {
    // Intermediate bracing is an open perimeter, never a solid extra floor.
    fineIron.addRing(outer(86) * 2, outer(86) * 2 - 0.65, 85.8, 0.35);
    const level = 115.73, size = 44;
    darkIron.addRing(size, 9, level - 1.8, 1.1);
    iron.addRing(size + 1.3, 9, level - 0.7, 0.7);
    for (let side = 0; side < 4; side++) {
      const rot = side * Math.PI / 2, c = Math.cos(rot), s = Math.sin(rot);
      glass.addBox(-s * 15.5, level + 0.2, c * 15.5, 34, 2.6, 8, rot);
      darkIron.addBox(-s * 15.5, level + 2.8, c * 15.5, 35, 0.45, 9, rot);
      for (let x = -20; x <= 20; x += 2.5) {
        const px = x * c - size / 2 * s, pz = x * s + size / 2 * c;
        fineIron.addBox(px, level, pz, 0.1, 1.3, 0.1);
      }
    }
    iron.addRing(37, 10, level + 4.0, 0.55);
  }

  // ---------------------------------------------------------------- 2E. Upper Tapering Shaft (115..276 m) + Central Elevator Core
  {
    const shaftLevels = [
      125, 132, 139, 146, 153, 160, 167, 174, 181, 188, 195, 202, 209, 216, 223, 230, 237, 244, 251, 257.5, 264, 270, 275,
    ];
    for (let i = 0; i < shaftLevels.length - 1; i++) {
      const y0 = shaftLevels[i];
      const y1 = shaftLevels[i + 1];
      const hw0 = outer(y0);
      const hw1 = outer(y1);
      addTrussBay(y0, y1, [0, 0], hw0, [0, 0], hw1, 0.62, 0.3, 2);
      // Central vertical elevator shaft core inside the upper tower
      darkIron.addBox(0, y0, 0, hw1 * 0.48, y1 - y0, hw1 * 0.48);
      if (i % 4 === 0) {
        darkIron.addBox(0, y1 - 0.6, 0, hw1 * 2 + 1.6, 1.1, hw1 * 2 + 1.6, 0, true);
      }
    }
  }

  // ---------------------------------------------------------------- 2F. Summit observation decks and antenna
  {
    darkIron.addFrustum(0, 273.5, 0, 6.7, 6.7, 0, 276.13, 0, 8.5, 8.5, 4, Math.PI / 4, true, true);
    iron.addRing(17.8, 5, 276.13, 0.65);
    glass.addBox(0, 276.78, 0, 12.5, 3.0, 12.5);
    darkIron.addBox(0, 279.78, 0, 15.8, 0.55, 15.8);
    for (const sign of [-1, 1]) for (let x = -7.5; x <= 7.5; x += 1.5) {
      fineIron.addBox(x, 280.33, sign * 7.5, 0.08, 1.25, 0.08);
      fineIron.addBox(sign * 7.5, 280.33, x, 0.08, 1.25, 0.08);
    }
    darkIron.addFrustum(0, 280.33, 0, 4.5, 4.5, 0, 292, 0, 2.8, 2.8, 8);
    iron.addFrustum(0, 292, 0, 2.8, 2.8, 0, 301, 0, 1.7, 1.7, 8);
    darkIron.addBox(0, 301, 0, 4.5, 1.0, 4.5);
    lampGlow.addBox(0, 302, 0, 1.7, 0.5, 1.7);
    iron.addFrustum(0, 302.5, 0, 1.2, 1.2, 0, 318, 0, 0.55, 0.55, 8);
    iron.addFrustum(0, 318, 0, 0.55, 0.55, 0, 329.6, 0, 0.15, 0.15, 6);
    for (const ay of [308, 312, 316, 321, 325]) {
      const ar = 2.1 - (ay - 308) / 20;
      fineIron.addFrustum(0, ay, 0, ar, ar, 0, ay + 0.22, 0, ar, ar, 8);
    }
    lampGlow.addSphere(0, 329.6, 0, 0.4, 6, 2);
  }
}

// ------------------------------------------------------------------ 3. Pack into a standard glTF 2.0 binary (.glb)
function packGlb(bucketList) {
  const active = bucketList.filter((b) => b.idx.length > 0);
  const bufferViews = [];
  const accessors = [];
  const materials = [];
  const meshes = [];
  const nodes = [];
  const chunks = [];
  let byteOffset = 0;

  const appendTyped = (arr, target) => {
    const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (u8.byteLength % 4)) % 4;
    const viewIdx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: u8.byteLength,
      target,
    });
    chunks.push(u8);
    if (pad) chunks.push(new Uint8Array(pad));
    byteOffset += u8.byteLength + pad;
    return viewIdx;
  };

  let totalTris = 0;
  let totalVerts = 0;

  active.forEach((b, i) => {
    const posArr = new Float32Array(b.pos);
    const normArr = new Float32Array(b.norm);
    const idxArr = new Uint32Array(b.idx);
    totalVerts += posArr.length / 3;
    totalTris += idxArr.length / 3;

    // Bounding box for POSITION accessor (required by glTF 2.0 spec)
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < posArr.length; k += 3) {
      for (let c = 0; c < 3; c++) {
        const v = posArr[k + c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
    }

    const posView = appendTyped(posArr, 34962); // ARRAY_BUFFER
    const normView = appendTyped(normArr, 34962);
    const idxView = appendTyped(idxArr, 34963); // ELEMENT_ARRAY_BUFFER

    const posAcc = accessors.length;
    accessors.push({
      bufferView: posView,
      componentType: 5126, // FLOAT
      count: posArr.length / 3,
      type: 'VEC3',
      min: min.map((x) => +x.toFixed(4)),
      max: max.map((x) => +x.toFixed(4)),
    });
    const normAcc = accessors.length;
    accessors.push({
      bufferView: normView,
      componentType: 5126,
      count: normArr.length / 3,
      type: 'VEC3',
    });
    const idxAcc = accessors.length;
    accessors.push({
      bufferView: idxView,
      componentType: 5125, // UNSIGNED_INT
      count: idxArr.length,
      type: 'SCALAR',
    });

    materials.push({
      name: b.name,
      pbrMetallicRoughness: {
        baseColorFactor: b.mat.baseColorFactor,
        metallicFactor: b.mat.metallicFactor,
        roughnessFactor: b.mat.roughnessFactor,
      },
      ...(b.mat.alphaMode ? { alphaMode: b.mat.alphaMode } : {}),
      ...(b.mat.emissiveFactor ? { emissiveFactor: b.mat.emissiveFactor } : {}),
    });

    meshes.push({
      name: b.name,
      primitives: [
        {
          attributes: { POSITION: posAcc, NORMAL: normAcc },
          indices: idxAcc,
          material: i,
        },
      ],
    });
    nodes.push({ name: b.name, mesh: i });
  });

  const gltf = {
    asset: {
      version: '2.0',
      generator: 'Paris vivant Eiffel 3D Builder (CC0)',
    },
    scene: 0,
    scenes: [{ name: 'Tour_Eiffel_Champ_de_Mars', nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: byteOffset }],
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
  const jsonChunkLen = jsonBytes.byteLength + jsonPad;
  const binChunkLen = byteOffset;
  const totalLen = 12 + 8 + jsonChunkLen + 8 + binChunkLen;

  const out = new Uint8Array(totalLen);
  const dv = new DataView(out.buffer);
  // Header
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true); // version 2
  dv.setUint32(8, totalLen, true);
  // JSON chunk
  dv.setUint32(12, jsonChunkLen, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(jsonBytes, 20);
  for (let p = 0; p < jsonPad; p++) out[20 + jsonBytes.byteLength + p] = 0x20;
  // BIN chunk
  const binStart = 20 + jsonChunkLen;
  dv.setUint32(binStart, binChunkLen, true);
  dv.setUint32(binStart + 4, 0x004e4942, true); // 'BIN\0'
  let ptr = binStart + 8;
  for (const c of chunks) {
    out.set(c, ptr);
    ptr += c.byteLength;
  }

  return { out, totalTris, totalVerts, meshCount: active.length };
}

const dir = new URL('../public/models/', import.meta.url);
mkdirSync(dir, { recursive: true });
const { out, totalTris, totalVerts, meshCount } = packGlb(Object.values(buckets));
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const document = await io.readBinary(out);
await document.transform(weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 10 }));
const compressed = await io.writeBinary(document);
writeFileSync(new URL('eiffel.glb', dir), compressed);
console.log(
  `wrote public/models/eiffel.glb: ${(compressed.byteLength / 1e6).toFixed(2)} MB (${(out.byteLength / 1e6).toFixed(2)} MB before compression) — ${meshCount} PBR meshes, ${totalVerts.toLocaleString()} generated vertices, ${totalTris.toLocaleString()} triangles`,
);
