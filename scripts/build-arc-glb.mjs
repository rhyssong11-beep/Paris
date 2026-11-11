#!/usr/bin/env node
/**
 * Builds public/models/arc.glb — the Arc de Triomphe de l'Étoile, Place Charles de Gaulle,
 * the 12 radiating avenues (led by the Champs-Élysées, Grande-Armée and Avenue Foch), and the
 * surrounding Hôtels des Maréchaux & Haussmannian wedge blocks.
 *
 * Scale is 1 unit = 1 metre, +Y up, centred on the Arc de Triomphe at (0, 0, 0).
 *   - Main arch axis (Grand Arc): along Z (+Z = Avenue des Champs-Élysées, -Z = Avenue de la Grande-Armée)
 *   - Transverse arch axis (Petit Arc): along X (+X = Avenue de Wagram / NE, -X = Avenue Kléber / SW)
 *   - Monument dimensions: 44.8 m wide (X) × 22.2 m deep (Z) × 49.5 m tall (Y)
 *   - Grand Vault: 14.6 m wide × 29.2 m high (coffered barrel vault with sculpted roses)
 *   - Transverse Vaults: 8.4 m wide × 18.7 m high (coffered barrel vaults)
 *   - Walkable interior switchback stair inside the East-South pier up to the 49.5 m rooftop terrace
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

let seed = 18061836; // 1806 (commissioned by Napoleon) — 1836 (inaugurated)
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff;
};

/** Accumulates indexed triangles for a single glTF material. */
class Bucket {
  constructor(name, color, { rough = 0.78, metal = 0.0, emissive = null, alpha = 1 } = {}) {
    this.name = name;
    this.color = color;
    this.rough = rough;
    this.metal = metal;
    this.emissive = emissive;
    this.alpha = alpha;
    this.pos = [];
    this.norm = [];
    this.idx = [];
  }

  /** Convex polygon pts[0..n-1] with outward normal n (computed if omitted). */
  poly(pts, n) {
    if (!n) {
      const [a, b, c] = pts;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      n = [nx / len, ny / len, nz / len];
    }
    const base = this.pos.length / 3;
    for (const p of pts) {
      this.pos.push(p[0], p[1], p[2]);
      this.norm.push(n[0], n[1], n[2]);
    }
    for (let i = 1; i < pts.length - 1; i++) this.idx.push(base, base + i, base + i + 1);
  }

  /** Axis-aligned box from (x0,y0,z0) to (x1,y1,z1). */
  box(x0, y0, z0, x1, y1, z1, { capTop = true, capBottom = false } = {}) {
    if (x0 > x1) [x0, x1] = [x1, x0];
    if (y0 > y1) [y0, y1] = [y1, y0];
    if (z0 > z1) [z0, z1] = [z1, z0];
    this.poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
    this.poly([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1]);
    this.poly([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0]);
    this.poly([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
    if (capTop) this.poly([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0]);
    if (capBottom) this.poly([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
  }

  /** Connect two closed rings of [x,z] points at heights yA and yB. */
  loft(ringA, yA, ringB, yB, { capTop = true, capBottom = false } = {}) {
    let area = 0;
    for (let i = 0; i < ringA.length; i++) {
      const [x0, z0] = ringA[i];
      const [x1, z1] = ringA[(i + 1) % ringA.length];
      area += x0 * z1 - z0 * x1;
    }
    if (area > 0) {
      ringA = [...ringA].reverse();
      ringB = [...ringB].reverse();
    }
    const n = ringA.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [ax, az] = ringA[i], [bx, bz] = ringA[j];
      const [cx, cz] = ringB[j], [dx, dz] = ringB[i];
      this.poly([[ax, yA, az], [bx, yA, bz], [cx, yB, cz], [dx, yB, dz]]);
    }
    if (capTop) this.poly(ringB.map(([x, z]) => [x, yB, z]), [0, 1, 0]);
    if (capBottom) this.poly([...ringA].reverse().map(([x, z]) => [x, yA, z]), [0, -1, 0]);
  }

  /** Vertical cylinder / frustum at (cx, cz). */
  cyl(cx, cz, r0, y0, r1, y1, segs = 12, caps = { capTop: true, capBottom: false }) {
    const ring = (r) =>
      Array.from({ length: segs }, (_, i) => {
        const a = (i / segs) * Math.PI * 2;
        return [cx + Math.cos(a) * r, cz - Math.sin(a) * r];
      });
    this.loft(ring(r0), y0, ring(r1), y1, caps);
  }

  /** Square-section strut between two 3D points a and b. */
  bar(a, b, r) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    const tx = dx / len, ty = dy / len, tz = dz / len;
    const up = Math.abs(ty) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ux = ty * up[2] - tz * up[1], uy = tz * up[0] - tx * up[2], uz = tx * up[1] - ty * up[0];
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux = (ux / ul) * r; uy = (uy / ul) * r; uz = (uz / ul) * r;
    const vx = (ty * uz - tz * uy) / len, vy = (tz * ux - tx * uz) / len, vz = (tx * uy - ty * ux) / len;
    const corner = (p, su, sv) => [p[0] + su * ux + sv * vx, p[1] + su * uy + sv * vy, p[2] + su * uz + sv * vz];
    const sides = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const A = sides.map(([u, v]) => corner(a, u, v));
    const B = sides.map(([u, v]) => corner(b, u, v));
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.poly([A[i], A[j], B[j], B[i]]);
    }
  }

  /** Lumpy organic ellipsoid for tree foliage. */
  blob(cx, cy, cz, rx, ry, rz, phase = 0, uSeg = 10, vSeg = 6) {
    const pt = (u, v) => {
      const th = (u / uSeg) * Math.PI * 2;
      const ph = (v / vSeg - 0.5) * Math.PI;
      const c = Math.cos(ph);
      const lump = 1 + 0.12 * Math.sin(th * 3 + phase) * Math.cos(ph * 2 - phase) + 0.07 * Math.cos(th * 5 - ph * 3 + phase * 1.7);
      return [cx + Math.cos(th) * c * rx * lump, cy + Math.sin(ph) * ry * lump, cz - Math.sin(th) * c * rz * lump];
    };
    for (let v = 0; v < vSeg; v++) {
      for (let u = 0; u < uSeg; u++) {
        const a = pt(u, v), b = pt(u + 1, v), c = pt(u + 1, v + 1), d = pt(u, v + 1);
        if (v > 0) this.poly([a, b, c]);
        if (v < vSeg - 1) this.poly([a, c, d]);
      }
    }
  }
}

// ------------------------------------------------------------------ Palette & Materials
const M = {
  // Monument & Haussmannian limestone (Château-Landon / Lutetian limestone)
  stone: new Bucket('Arc_Stone', [0.84, 0.78, 0.67], { rough: 0.82 }),
  stoneTrim: new Bucket('Arc_Stone_Trim', [0.91, 0.86, 0.75], { rough: 0.74 }),
  stoneSculpt: new Bucket('Arc_Stone_Sculpture', [0.93, 0.88, 0.78], { rough: 0.68 }),
  stoneShade: new Bucket('Arc_Stone_Shade', [0.46, 0.42, 0.36], { rough: 0.92 }),
  haussmann: new Bucket('Palace_Stone', [0.80, 0.74, 0.63], { rough: 0.85 }),
  slate: new Bucket('Roof_Slate', [0.23, 0.26, 0.31], { rough: 0.65, metal: 0.08 }),
  lead: new Bucket('Roof_Lead', [0.40, 0.42, 0.45], { rough: 0.48, metal: 0.45 }),
  window: new Bucket('Palace_Window_Glass', [0.13, 0.17, 0.22], { rough: 0.15, metal: 0.6 }),
  glass: new Bucket('Pavilion_Glass', [0.72, 0.86, 0.92], { rough: 0.08, metal: 0.1, alpha: 0.35 }),
  granite: new Bucket('Basin_Curb', [0.32, 0.32, 0.34], { rough: 0.58 }),
  cobble: new Bucket('Plaza_Cobble', [0.36, 0.35, 0.34], { rough: 0.90 }),
  paving: new Bucket('Plaza_Stone', [0.68, 0.64, 0.56], { rough: 0.92 }),
  starRay: new Bucket('Plaza_Star_Ray', [0.80, 0.73, 0.62], { rough: 0.88 }),
  lawn: new Bucket('Park_Lawn', [0.26, 0.43, 0.17], { rough: 1.0 }),
  hedge: new Bucket('Park_Foliage_Hedge', [0.14, 0.27, 0.10], { rough: 0.95 }),
  foliage: new Bucket('Park_Foliage', [0.20, 0.36, 0.13], { rough: 0.9 }),
  foliageDark: new Bucket('Park_Foliage_Dark', [0.12, 0.25, 0.09], { rough: 0.95 }),
  foliageLight: new Bucket('Park_Foliage_Light', [0.34, 0.48, 0.16], { rough: 0.85 }),
  trunk: new Bucket('Tree_Trunk', [0.30, 0.23, 0.17], { rough: 0.95 }),
  bronze: new Bucket('Arc_Bronze', [0.22, 0.28, 0.23], { rough: 0.45, metal: 0.78 }),
  gilt: new Bucket('Arc_Gilt', [0.87, 0.70, 0.26], { rough: 0.28, metal: 0.88 }),
  iron: new Bucket('Lamp_Iron', [0.13, 0.14, 0.15], { rough: 0.48, metal: 0.65 }),
  lamp: new Bucket('Lamp_Glow', [1.0, 0.93, 0.76], { rough: 0.2, emissive: [0.6, 0.48, 0.24] }),
  flame: new Bucket('Eternal_Flame_Glow', [1.0, 0.68, 0.22], { rough: 0.15, emissive: [0.95, 0.55, 0.12] }),
  flagBlue: new Bucket('Flag_Blue', [0.05, 0.16, 0.45], { rough: 0.7 }),
  flagWhite: new Bucket('Flag_White', [0.94, 0.93, 0.90], { rough: 0.7 }),
  flagRed: new Bucket('Flag_Red', [0.75, 0.12, 0.14], { rough: 0.7 }),
};

const GROUND = 0.30; // Central island & sidewalk elevation above roadway (y = 0)
const ROAD_Y = 0.06; // Cobblestone roundabout & avenue roadway surface

// ============================================================================
// PART 1: PLACE CHARLES DE GAULLE (PLACE DE L'ÉTOILE) & 12 RADIATING AVENUES
// ============================================================================

const ISLAND_R = 45.5; // Central pedestrian island radius
const ROUNDABOUT_R = 96.0; // Outer edge of cobblestone roundabout
const PROMENADE_R = 118.0; // Inner building line of Hôtels des Maréchaux
const TILSITT_INNER_R = 158.0; // Outer back of Hôtels des Maréchaux (Rue de Tilsitt / Presbourg)
const TILSITT_OUTER_R = 172.0; // Inner front of outer Haussmann blocks
const OUTER_BLOCK_R = 262.0; // Outer radius of detailed Haussmann wedge blocks

/** Helper to create a circular sector ring from radius r0 to r1 between angles a0 and a1 at height y. */
function sectorSlab(bucket, r0, r1, a0, a1, y0, y1, segs = 8) {
  const ring = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + ((a1 - a0) * i) / segs;
    ring.push([Math.sin(a) * r1, Math.cos(a) * r1]);
  }
  for (let i = segs; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / segs;
    ring.push([Math.sin(a) * r0, Math.cos(a) * r0]);
  }
  bucket.loft(ring, y0, ring, y1, { capTop: true });
}

// 1.1 Base cobblestone disc covering entire plaza & avenue zone
M.cobble.cyl(0, 0, OUTER_BLOCK_R + 18, 0, OUTER_BLOCK_R + 18, ROAD_Y, 72);

// Concentric subtle cobble lane markings in the Étoile roundabout (r = 46 .. 96 m)
for (const r of [56, 66, 76, 86]) {
  sectorSlab(M.granite, r - 0.22, r + 0.22, 0, Math.PI * 2, ROAD_Y, ROAD_Y + 0.025, 64);
}

// 1.2 Central Pedestrian Island (r = 0 .. 45.5 m) with 12-pointed Star (Étoile) pavement inlay
M.granite.cyl(0, 0, ISLAND_R + 0.9, ROAD_Y, ISLAND_R + 0.9, GROUND, 64);
M.paving.cyl(0, 0, ISLAND_R, ROAD_Y, ISLAND_R, GROUND + 0.02, 64);

// Concentric granite bands on the central island
for (const r of [16.5, 27.5, 37.5, 44.2]) {
  sectorSlab(M.granite, r - 0.35, r + 0.35, 0, Math.PI * 2, GROUND + 0.02, GROUND + 0.045, 64);
}

// 12-pointed Star (L'Étoile) stone rays radiating across the central pedestrian plaza
for (let k = 0; k < 12; k++) {
  const aMid = (k * Math.PI) / 6;
  const da = 0.095;
  const rBase = 16.8;
  const rTip = 44.0;
  const p0 = [Math.sin(aMid - da) * rBase, GROUND + 0.04, Math.cos(aMid - da) * rBase];
  const p1 = [Math.sin(aMid) * rTip, GROUND + 0.04, Math.cos(aMid) * rTip];
  const p2 = [Math.sin(aMid + da) * rBase, GROUND + 0.04, Math.cos(aMid + da) * rBase];
  M.starRay.poly([p0, p1, p2], [0, 1, 0]);
  // Secondary minor rays between the 12 main rays
  const aSub = aMid + Math.PI / 12;
  const s0 = [Math.sin(aSub - 0.055) * 27.8, GROUND + 0.038, Math.cos(aSub - 0.055) * 27.8];
  const s1 = [Math.sin(aSub) * 43.5, GROUND + 0.038, Math.cos(aSub) * 43.5];
  const s2 = [Math.sin(aSub + 0.055) * 27.8, GROUND + 0.038, Math.cos(aSub + 0.055) * 27.8];
  M.stoneTrim.poly([s0, s1, s2], [0, 1, 0]);
}

// Low perimeter bronze bollards and chains around the central island (kept <= 0.58 m so walkers step over cleanly)
for (let i = 0; i < 48; i++) {
  const a = (i / 48) * Math.PI * 2;
  // Leave wide open crosswalk gaps along the 4 cardinal axes (0, 90, 180, 270 deg)
  const mod90 = Math.abs(((a + Math.PI / 4) % (Math.PI / 2)) - Math.PI / 4);
  if (mod90 < 0.14) continue;
  const bx = Math.sin(a) * 43.2;
  const bz = Math.cos(a) * 43.2;
  M.bronze.cyl(bx, bz, 0.22, GROUND + 0.02, 0.16, GROUND + 0.56, 8);
  const aNext = ((i + 1) / 48) * Math.PI * 2;
  const nextMod90 = Math.abs(((aNext + Math.PI / 4) % (Math.PI / 2)) - Math.PI / 4);
  if (nextMod90 >= 0.14) {
    const nx = Math.sin(aNext) * 43.2;
    const nz = Math.cos(aNext) * 43.2;
    M.iron.bar([bx, GROUND + 0.44, bz], [nx, GROUND + 0.44, nz], 0.035);
  }
}

// ============================================================================
// PART 2: THE ARC DE TRIOMPHE DE L'ÉTOILE (x ∈ [-22.4, 22.4], z ∈ [-11.1, 11.1])
// ============================================================================

const W_HALF = 22.4; // Half-width along X (total 44.8 m)
const D_HALF = 11.1; // Half-depth along Z (total 22.2 m)
const GRAND_W = 7.3; // Half-width of Grand Central Arch along X (opening = 14.6 m)
const GRAND_IMPOST = 21.9; // Springing height of Grand Arch (crown = 29.2 m)
const PETIT_W = 4.2; // Half-width of Transverse Arch along Z (opening = 8.4 m)
const PETIT_IMPOST = 14.5; // Springing height of Transverse Arch (crown = 18.7 m)
const ENTAB_Y0 = 30.2; // Bottom of Grand Entablature
const FRIEZE_Y0 = 31.6; // Bottom of Great Figurative Frieze
const FRIEZE_Y1 = 34.2; // Top of Great Figurative Frieze
const CORNICE_Y1 = 37.8; // Top of Grand Projecting Modillion Cornice
const ATTIC_Y1 = 46.8; // Top of Attic story (with 30 shields)
const ROOF_Y = 49.5; // Walkable rooftop observation terrace
const PARAPET_Y = 50.8; // Top of rooftop balustrade

// Stairwell shaft inside the East-South Pier (x ∈ [8.8, 20.8], z ∈ [5.0, 10.2]):
const STAIR_X0 = 8.8, STAIR_X1 = 20.8;
const STAIR_Z0 = 5.0, STAIR_Z1 = 10.2;
const DOOR_X0 = 9.0, DOOR_X1 = 11.5, DOOR_Y1 = 4.4;

/**
 * Builds one of the 4 main pier legs from y = GROUND up to y = GRAND_IMPOST (21.9 m).
 * For the East-South leg (sx = +1, sz = +1), builds hollow walls around the interior staircase
 * with an arched ground-floor entrance doorway facing into the East Transverse Vault (z = 4.2).
 */
function buildPierLeg(sx, sz) {
  const x0 = sx < 0 ? -W_HALF : GRAND_W;
  const x1 = sx < 0 ? -GRAND_W : W_HALF;
  const z0 = sz < 0 ? -D_HALF : PETIT_W;
  const z1 = sz < 0 ? -PETIT_W : D_HALF;
  const isStairPier = sx > 0 && sz > 0;

  // 1. Stepped granite & limestone plinths on the exterior faces (projecting outward only)
  const steps = [
    { h0: GROUND, h1: 1.1, out: 0.75, mat: M.granite },
    { h0: 1.1, h1: 2.1, out: 0.52, mat: M.stoneTrim },
    { h0: 2.1, h1: 4.8, out: 0.32, mat: M.stone },
    { h0: 4.8, h1: 5.4, out: 0.58, mat: M.stoneTrim }, // Pedestal cornice
  ];
  for (const st of steps) {
    if (!isStairPier) {
      st.mat.box(x0 - st.out, st.h0, z0 - st.out, x1 + st.out, st.h1, z1 + st.out);
    } else {
      // Wrap around hollow stairwell [STAIR_X0..STAIR_X1, STAIR_Z0..STAIR_Z1], leaving doorway at z0
      st.mat.box(x0 - st.out, st.h0, z0 - st.out, STAIR_X0, st.h1, z1 + st.out); // West wall plinth
      st.mat.box(STAIR_X1, st.h0, z0 - st.out, x1 + st.out, st.h1, z1 + st.out); // East wall plinth
      st.mat.box(STAIR_X0, st.h0, STAIR_Z1, STAIR_X1, st.h1, z1 + st.out); // South wall plinth
      // North wall plinth split by doorway [DOOR_X0 .. DOOR_X1]
      st.mat.box(STAIR_X0, st.h0, z0 - st.out, DOOR_X0, st.h1, STAIR_Z0);
      st.mat.box(DOOR_X1, st.h0, z0 - st.out, STAIR_X1, st.h1, STAIR_Z0);
      if (st.h1 > DOOR_Y1) {
        st.mat.box(DOOR_X0, Math.max(st.h0, DOOR_Y1), z0 - st.out, DOOR_X1, st.h1, STAIR_Z0);
      }
    }
  }

  // 2. Main pier shaft from y = 5.4 m up to PETIT_IMPOST (14.5 m)
  if (!isStairPier) {
    M.stone.box(x0, 5.4, z0, x1, PETIT_IMPOST, z1, { capTop: false });
  } else {
    M.stone.box(x0, 5.4, z0, STAIR_X0, PETIT_IMPOST, z1, { capTop: false });
    M.stone.box(STAIR_X1, 5.4, z0, x1, PETIT_IMPOST, z1, { capTop: false });
    M.stone.box(STAIR_X0, 5.4, STAIR_Z1, STAIR_X1, PETIT_IMPOST, z1, { capTop: false });
    M.stone.box(STAIR_X0, 5.4, z0, STAIR_X1, PETIT_IMPOST, STAIR_Z0, { capTop: false });
    // Decorative portal frame around the stairwell entrance at z = PETIT_W (4.2)
    M.stoneTrim.box(DOOR_X0 - 0.35, GROUND, z0 - 0.18, DOOR_X0, DOOR_Y1 + 0.4, z0 + 0.15);
    M.stoneTrim.box(DOOR_X1, GROUND, z0 - 0.18, DOOR_X1 + 0.35, DOOR_Y1 + 0.4, z0 + 0.15);
    M.stoneTrim.box(DOOR_X0 - 0.45, DOOR_Y1, z0 - 0.25, DOOR_X1 + 0.45, DOOR_Y1 + 0.55, z0 + 0.18);
    M.gilt.box(DOOR_X0 - 0.15, DOOR_Y1 + 0.1, z0 - 0.28, DOOR_X1 + 0.15, DOOR_Y1 + 0.38, z0 - 0.22);
    // Warm welcome lantern above the stairwell portal
    M.lamp.box((DOOR_X0 + DOOR_X1) / 2 - 0.35, DOOR_Y1 - 0.35, z0 - 0.15, (DOOR_X0 + DOOR_X1) / 2 + 0.35, DOOR_Y1 - 0.05, z0 + 0.35);
  }

  // 3. Corner pilasters and recessed panels on the pier faces
  const zFace = sz < 0 ? z0 : z1;
  const xFace = sx < 0 ? x0 : x1;
  // Outer Z-face corner pilasters
  M.stoneTrim.box(x0, 5.4, zFace - 0.22, x0 + 1.4, GRAND_IMPOST - 1.2, zFace + 0.22);
  M.stoneTrim.box(x1 - 1.4, 5.4, zFace - 0.22, x1, GRAND_IMPOST - 1.2, zFace + 0.22);
  // Outer X-face corner pilaster
  M.stoneTrim.box(xFace - 0.22, 5.4, z0, xFace + 0.22, GRAND_IMPOST - 1.2, z0 + 1.3);
  M.stoneTrim.box(xFace - 0.22, 5.4, z1 - 1.3, xFace + 0.22, GRAND_IMPOST - 1.2, z1);

  // Transverse impost molding at y = 13.4 .. 14.5 m (projecting outward on exterior & vault faces)
  const imp0 = PETIT_IMPOST - 1.1;
  const imp1 = PETIT_IMPOST;
  M.stoneTrim.box(x0 - 0.45, imp0, zFace - 0.45, x1 + 0.45, imp1, zFace + 0.45);
  const zInner = sz < 0 ? z1 : z0;
  M.stoneTrim.box(x0 - 0.35, imp0, zInner - 0.38, x1 + 0.35, imp1, zInner + 0.38);

  // Inner vault wall inscribed battle plaques (Names of 660 generals & battles)
  const xVault = sx < 0 ? x1 : x0;
  const vDir = sx < 0 ? 1 : -1;
  for (const py of [6.4, 10.2]) {
    M.stoneTrim.box(xVault - 0.08, py, z0 + 1.1, xVault + vDir * 0.14, py + 3.1, z1 - 1.1);
    M.gilt.box(xVault + vDir * 0.12, py + 0.3, z0 + 1.4, xVault + vDir * 0.17, py + 2.8, z1 - 1.4);
  }
}

for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    buildPierLeg(sx, sz);
  }
}

// ============================================================================
// PART 2.2: WALKABLE SWITCHBACK STAIRCASE INSIDE THE EAST-SOUTH PIER (y = 0.3 .. 49.5 m)
// ============================================================================
{
  const X_W0 = 9.0, X_W1 = 11.4; // West landing X range (2.4 m wide)
  const X_E0 = 18.2, X_E1 = 20.6; // East landing X range (2.4 m wide)
  const Z_N0 = 5.2, Z_N1 = 7.4; // North flight Z lane (2.2 m wide)
  const Z_S0 = 7.8, Z_S1 = 10.0; // South flight Z lane (2.2 m wide)
  const FLIGHTS = 16;
  const TOTAL_RISE = ROOF_Y - GROUND; // 49.2 m
  const DY = TOTAL_RISE / FLIGHTS; // 3.075 m per flight (slope = 3.075 / 6.8 = 0.452 < STEP_UP)
  const THICK = 0.22;

  // Central dividing spine wall between North and South lanes
  M.stoneTrim.box(X_W1, GROUND, Z_N1, X_E0, ROOF_Y + 1.25, Z_S0);

  // Helper to emit a walkable slab/ramp with ONLY top and bottom faces (no vertical step risers)
  const rampSlab = (bucket, xA, yA, xB, yB, z0, z1) => {
    const dx = xB - xA, dy = yB - yA;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const p = [
      [xA, yA, z1],
      [xB, yB, z1],
      [xB, yB, z0],
      [xA, yA, z0],
    ];
    bucket.poly(p, [nx, ny, 0]);
    const pBot = [
      [xA, yA - THICK, z0],
      [xB, yB - THICK, z0],
      [xB, yB - THICK, z1],
      [xA, yA - THICK, z1],
    ];
    M.stoneShade.poly(pBot, [-nx, -ny, 0]);
  };

  // Entrance vestibule floor from z = PETIT_W (4.2) into the first West landing (z = 5.2..7.4)
  rampSlab(M.paving, X_W0, GROUND + 0.02, X_W1, GROUND + 0.02, PETIT_W, Z_N1);

  for (let f = 0; f < FLIGHTS; f++) {
    const y0 = GROUND + 0.02 + f * DY;
    const y1 = Math.min(ROOF_Y, GROUND + 0.02 + (f + 1) * DY);
    if (f % 2 === 0) {
      // Even flight: North lane (z ∈ [Z_N0, Z_N1]), climbs East from X_W1 to X_E0
      rampSlab(M.stoneTrim, X_W1, y0, X_E0, y1, Z_N0, Z_N1);
      // East turn landing at height y1 (spanning Z_N0 .. Z_S1)
      rampSlab(M.paving, X_E0, y1, X_E1, y1, Z_N0, Z_S1);
      // Warm interior wall sconce on East landing
      M.lamp.box(X_E1 - 0.08, y1 + 1.8, (Z_N0 + Z_S1) / 2 - 0.3, X_E1, y1 + 2.2, (Z_N0 + Z_S1) / 2 + 0.3);
    } else {
      // Odd flight: South lane (z ∈ [Z_S0, Z_S1]), climbs West from X_E0 (at y0) up to X_W1 (at y1)
      rampSlab(M.stoneTrim, X_W1, y1, X_E0, y0, Z_S0, Z_S1);
      // West turn landing at height y1 (for top flight f === FLIGHTS - 1, bridge continuously onto the rooftop terrace!)
      const landingX0 = f === FLIGHTS - 1 ? 6.5 : X_W0;
      const landingZ0 = f === FLIGHTS - 1 ? 0.0 : Z_N0;
      rampSlab(M.paving, landingX0, y1, X_W1, y1, landingZ0, Z_S1);
      if (f < FLIGHTS - 1) {
        M.lamp.box(X_W0, y1 + 1.8, (Z_N0 + Z_S1) / 2 - 0.3, X_W0 + 0.08, y1 + 2.2, (Z_N0 + Z_S1) / 2 + 0.3);
      }
    }
  }
}

// ============================================================================
// PART 2.3: COFFERED BARREL VAULTS (TRANSVERSAL & GRAND CENTRAL VAULTS)
// ============================================================================

/**
 * Builds the Transverse Barrel Vaults along X (z ∈ [-4.2, +4.2], crown at y = 18.7 m)
 * and fills the solid spandrel masonry above them up to GRAND_IMPOST (21.9 m).
 * Preserves the hollow stairwell shaft in the East-South pier [STAIR_X0..STAIR_X1, STAIR_Z0..STAIR_Z1].
 */
function buildTransverseVaults() {
  const segs = 16;
  const r = PETIT_W; // 4.2 m
  const cy = PETIT_IMPOST; // 14.5 m
  const yTop = GRAND_IMPOST; // 21.9 m

  for (const sx of [-1, 1]) {
    const xStart = sx < 0 ? -W_HALF : GRAND_W;
    const xEnd = sx < 0 ? -GRAND_W : W_HALF;

    // Solid masonry blocks flanking the transverse vault from y = 14.5 .. 21.9 m
    // North side (z ∈ [-11.1, -4.2])
    M.stone.box(xStart, cy, -D_HALF, xEnd, yTop, -r, { capTop: false });
    // South side (z ∈ [4.2, 11.1]) — hollow for East-South pier stairwell
    if (sx < 0) {
      M.stone.box(xStart, cy, r, xEnd, yTop, D_HALF, { capTop: false });
    } else {
      M.stone.box(xStart, cy, r, STAIR_X0, yTop, D_HALF, { capTop: false });
      M.stone.box(STAIR_X1, cy, r, xEnd, yTop, D_HALF, { capTop: false });
      M.stone.box(STAIR_X0, cy, STAIR_Z1, STAIR_X1, yTop, D_HALF, { capTop: false });
      M.stone.box(STAIR_X0, cy, r, STAIR_X1, yTop, STAIR_Z0, { capTop: false });
    }

    // Spandrel masonry wedged between the curved transverse vault (z ∈ [-4.2, +4.2]) and y = 21.9 m
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI;
      const a1 = ((i + 1) / segs) * Math.PI;
      const z0 = Math.cos(a1) * r;
      const z1 = Math.cos(a0) * r;
      const ya0 = cy + Math.sin(a0) * r;
      const ya1 = cy + Math.sin(a1) * r;
      const ym = Math.min(ya0, ya1);
      M.stone.box(xStart, ym, z0, xEnd, yTop, z1, { capTop: false, capBottom: false });

      // Curved intrados ceiling panel + recessed coffer with sculpted rosette
      const n0 = [0, -Math.sin((a0 + a1) / 2), -Math.cos((a0 + a1) / 2)];
      M.stone.poly([[xStart, ya0, z1], [xEnd, ya0, z1], [xEnd, ya1, z0], [xStart, ya1, z0]], n0);

      // Coffer bays along X
      const bays = 5;
      const dx = (xEnd - xStart) / bays;
      for (let b = 0; b < bays; b++) {
        const bx0 = xStart + (b + 0.16) * dx;
        const bx1 = xStart + (b + 0.84) * dx;
        const zm = (z0 + z1) / 2;
        const ymCoffer = (ya0 + ya1) / 2;
        const inset = 0.08;
        M.stoneShade.poly(
          [
            [bx0, ymCoffer + n0[1] * inset, z1 - (z1 - z0) * 0.15],
            [bx1, ymCoffer + n0[1] * inset, z1 - (z1 - z0) * 0.15],
            [bx1, ymCoffer + n0[1] * inset, z0 + (z1 - z0) * 0.15],
            [bx0, ymCoffer + n0[1] * inset, z0 + (z1 - z0) * 0.15],
          ],
          n0
        );
        // Sculpted rosette boss at coffer center
        const rx = (bx0 + bx1) / 2;
        M.gilt.box(rx - 0.22, ymCoffer - 0.14, zm - 0.22, rx + 0.22, ymCoffer + 0.04, zm + 0.22, { capBottom: true });
      }
    }

    // Exterior & interior archivolt molding rings + keystone on Transverse Arches
    for (const xFace of [xStart, xEnd]) {
      const out = xFace < -15 || xFace > 15 ? (xFace > 0 ? 0.38 : -0.38) : xFace > 0 ? -0.28 : 0.28;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI;
        const a1 = ((i + 1) / segs) * Math.PI;
        const zA = Math.cos(a0) * r, yA = cy + Math.sin(a0) * r;
        const zB = Math.cos(a1) * r, yB = cy + Math.sin(a1) * r;
        const zA2 = Math.cos(a0) * (r + 0.85), yA2 = cy + Math.sin(a0) * (r + 0.85);
        const zB2 = Math.cos(a1) * (r + 0.85), yB2 = cy + Math.sin(a1) * (r + 0.85);
        const n = [out > 0 ? 1 : -1, 0, 0];
        const pts = out > 0
          ? [[xFace + out, yA, zA], [xFace + out, yA2, zA2], [xFace + out, yB2, zB2], [xFace + out, yB, zB]]
          : [[xFace + out, yB, zB], [xFace + out, yB2, zB2], [xFace + out, yA2, zA2], [xFace + out, yA, zA]];
        M.stoneTrim.poly(pts, n);
      }
      // Transverse arch keystone
      const kx0 = Math.min(xFace, xFace + out * 1.45);
      const kx1 = Math.max(xFace, xFace + out * 1.45);
      M.stoneTrim.box(kx0, cy + r - 0.2, -0.55, kx1, cy + r + 1.25, 0.55);
    }
  }
}
buildTransverseVaults();

/**
 * Builds the Grand Central Barrel Vault along Z (x ∈ [-7.3, +7.3], impost 21.9 m, crown 29.2 m)
 * and the upper pier masses flanking it from y = 21.9 m up to ENTAB_Y0 (30.2 m).
 */
function buildGrandCentralVault() {
  const y0 = GRAND_IMPOST; // 21.9 m
  const y1 = ENTAB_Y0; // 30.2 m
  const r = GRAND_W; // 7.3 m
  const segs = 24;

  // Grand Impost Cornice wrapping both main piers at y = 20.6 .. 21.9 m
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -W_HALF : GRAND_W;
    const x1 = sx < 0 ? -GRAND_W : W_HALF;
    if (sx < 0) {
      M.stoneTrim.box(x0 - 0.65, y0 - 1.3, -D_HALF - 0.65, x1 + 0.55, y0, D_HALF + 0.65);
      M.stone.box(x0, y0, -D_HALF, x1, y1, D_HALF, { capTop: false });
    } else {
      // East pier: preserve hollow stairwell shaft [STAIR_X0..STAIR_X1, STAIR_Z0..STAIR_Z1]
      M.stoneTrim.box(x0 - 0.55, y0 - 1.3, -D_HALF - 0.65, x1 + 0.65, y0, STAIR_Z0);
      M.stoneTrim.box(x0 - 0.55, y0 - 1.3, STAIR_Z1, x1 + 0.65, y0, D_HALF + 0.65);
      M.stoneTrim.box(x0 - 0.55, y0 - 1.3, STAIR_Z0, STAIR_X0, y0, STAIR_Z1);
      M.stoneTrim.box(STAIR_X1, y0 - 1.3, STAIR_Z0, x1 + 0.65, y0, STAIR_Z1);

      M.stone.box(x0, y0, -D_HALF, x1, y1, STAIR_Z0, { capTop: false });
      M.stone.box(x0, y0, STAIR_Z1, x1, y1, D_HALF, { capTop: false });
      M.stone.box(x0, y0, STAIR_Z0, STAIR_X0, y1, STAIR_Z1, { capTop: false });
      M.stone.box(STAIR_X1, y0, STAIR_Z0, x1, y1, STAIR_Z1, { capTop: false });
    }
  }

  // Grand Central Vault masonry spandrels & coffered intrados (x ∈ [-7.3, +7.3], z ∈ [-11.1, +11.1])
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI;
    const a1 = ((i + 1) / segs) * Math.PI;
    const x0 = Math.cos(a1) * r;
    const x1 = Math.cos(a0) * r;
    const ya0 = y0 + Math.sin(a0) * r;
    const ya1 = y0 + Math.sin(a1) * r;
    const ym = Math.min(ya0, ya1);
    M.stone.box(x0, ym, -D_HALF, x1, y1, D_HALF, { capTop: false, capBottom: false });

    // Curved intrados ceiling strip facing downward/inward
    const aMid = (a0 + a1) / 2;
    const n = [-Math.cos(aMid), -Math.sin(aMid), 0];
    M.stone.poly([[x1, ya0, D_HALF], [x0, ya1, D_HALF], [x0, ya1, -D_HALF], [x1, ya0, -D_HALF]], n);

    // 8 rows of deep sculpted coffers & golden/limestone roses along Z
    const bays = 8;
    const dz = (D_HALF * 2) / bays;
    for (let b = 0; b < bays; b++) {
      const bz0 = -D_HALF + (b + 0.16) * dz;
      const bz1 = -D_HALF + (b + 0.84) * dz;
      const xm = (x0 + x1) / 2;
      const ymC = (ya0 + ya1) / 2;
      const ins = 0.10;
      M.stoneShade.poly(
        [
          [x1 - (x1 - x0) * 0.14 + n[0] * ins, ya0 + n[1] * ins, bz1],
          [x0 + (x1 - x0) * 0.14 + n[0] * ins, ya1 + n[1] * ins, bz1],
          [x0 + (x1 - x0) * 0.14 + n[0] * ins, ya1 + n[1] * ins, bz0],
          [x1 - (x1 - x0) * 0.14 + n[0] * ins, ya0 + n[1] * ins, bz0],
        ],
        n
      );
      // Sculpted ceiling rose at the center of each coffer
      const zm = (bz0 + bz1) / 2;
      M.stoneTrim.box(xm - 0.34, ymC - 0.18, zm - 0.34, xm + 0.34, ymC + 0.04, zm + 0.34, { capBottom: true });
      M.gilt.box(xm - 0.18, ymC - 0.24, zm - 0.18, xm + 0.18, ymC - 0.12, zm + 0.18, { capBottom: true });
    }
  }

  // Grand Archivolt rings, giant scroll Keystone, and Pradier's Spandrel Victories (Renommées) on +Z and -Z faces
  for (const sz of [-1, 1]) {
    const zFace = sz * D_HALF;
    const out = sz * 0.48;
    const n = [0, 0, sz];
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI;
      const a1 = ((i + 1) / segs) * Math.PI;
      const xA = Math.cos(a0) * r, yA = y0 + Math.sin(a0) * r;
      const xB = Math.cos(a1) * r, yB = y0 + Math.sin(a1) * r;
      const xA2 = Math.cos(a0) * (r + 1.25), yA2 = y0 + Math.sin(a0) * (r + 1.25);
      const xB2 = Math.cos(a1) * (r + 1.25), yB2 = y0 + Math.sin(a1) * (r + 1.25);
      const pts = sz > 0
        ? [[xB, yB, zFace + out], [xB2, yB2, zFace + out], [xA2, yA2, zFace + out], [xA, yA, zFace + out]]
        : [[xA, yA, zFace + out], [xA2, yA2, zFace + out], [xB2, yB2, zFace + out], [xB, yB, zFace + out]];
      M.stoneTrim.poly(pts, n);
    }
    // Giant Scroll Keystone at the crown of the Grand Arch (y = 28.8 .. 30.6 m)
    const kz0 = Math.min(zFace, zFace + sz * 0.95);
    const kz1 = Math.max(zFace, zFace + sz * 0.95);
    M.stoneSculpt.box(-0.85, y0 + r - 0.35, kz0, 0.85, y0 + r + 1.35, kz1);
    M.stoneTrim.box(-1.05, y0 + r + 0.85, kz0 - 0.1, 1.05, y0 + r + 1.45, kz1 + 0.1);

    // Pradier's 4 Spandrel Victories (Renommées) reclining along the upper curve of the Grand Arch
    for (const sx of [-1, 1]) {
      const vx = sx * 5.2;
      const vy = y0 + 5.8;
      const vz = zFace + sz * 0.32;
      // Reclining winged torso, flowing drapery, outstretched wing and golden trumpet
      M.stoneSculpt.bar([vx - sx * 1.6, vy + 1.1, vz], [vx + sx * 1.4, vy - 1.4, vz], 0.42);
      M.stoneSculpt.cyl(vx - sx * 1.7, vz, 0.38, vy + 1.1, 0.32, vy + 1.85, 8); // head & laurel crown
      // Wing fanning into the spandrel corner
      for (let w = 0; w < 5; w++) {
        M.stoneSculpt.bar(
          [vx - sx * 0.4, vy + 0.5, vz],
          [vx + sx * (1.8 + w * 0.25), vy + 1.9 - w * 0.32, vz + sz * 0.12],
          0.16
        );
      }
      // Golden trumpet & wreath
      M.gilt.bar([vx - sx * 1.5, vy + 1.3, vz + sz * 0.18], [vx - sx * 3.1, vy + 1.7, vz + sz * 0.25], 0.07);
    }
  }
}
buildGrandCentralVault();

// ============================================================================
// PART 2.4: THE 4 MONUMENTAL HIGH-RELIEF SCULPTURAL GROUPS & 6 BAS-RELIEFS
// ============================================================================

/**
 * Builds one of the 4 iconic high-relief sculptural compositions on the main facades:
 *   - SE (+X, +Z): La Marseillaise (Le Départ de 1792) by François Rude
 *   - SW (-X, +Z): Le Triomphe de 1810 by Jean-Pierre Cortot
 *   - NW (-X, -Z): La Résistance de 1814 by Antoine Étex
 *   - NE (+X, -Z): La Paix de 1815 by Antoine Étex
 */
function buildMonumentalRelief(sx, sz) {
  const cx = sx * 14.85; // Center X of the pier face
  const zWall = sz * D_HALF;
  const dir = sz; // +1 for South (Champs-Élysées), -1 for North (Grande-Armée)

  // 1. Tall carved stone pedestal projecting 1.8 m from the pier (y = 2.1 .. 5.6 m)
  const z0 = Math.min(zWall, zWall + dir * 1.85);
  const z1 = Math.max(zWall, zWall + dir * 1.85);
  M.stoneTrim.box(cx - 3.6, 2.1, z0, cx + 3.6, 5.2, z1);
  M.stoneSculpt.box(cx - 3.9, 5.2, Math.min(zWall, zWall + dir * 2.1), cx + 3.9, 5.75, Math.max(zWall, zWall + dir * 2.1));

  // Backing architectural niche / console frame (y = 5.75 .. 17.6 m)
  M.stoneTrim.box(cx - 3.4, 5.75, Math.min(zWall, zWall + dir * 0.55), cx + 3.4, 16.8, Math.max(zWall, zWall + dir * 0.55));

  // 2. Lower register: Cluster of 7 dynamic heroic figures in deep 3D high-relief (y = 5.75 .. 12.6 m)
  const figOffsets = [-2.5, -1.65, -0.8, 0.0, 0.85, 1.7, 2.45];
  for (let i = 0; i < figOffsets.length; i++) {
    const fx = cx + figOffsets[i];
    const depth = 0.85 + (i === 3 ? 0.55 : (i % 2) * 0.32);
    const fz = zWall + dir * depth;
    const hBase = 5.75;
    const hTop = 10.6 + (i === 3 ? 1.4 : (i % 3) * 0.45);
    // Legs & drapery column
    M.stoneSculpt.cyl(fx, fz, 0.48, hBase, 0.42, hBase + 2.8, 8);
    // Heroic torso
    M.stoneSculpt.cyl(fx + (i - 3) * 0.05, fz + dir * 0.12, 0.46, hBase + 2.7, 0.52, hTop - 0.8, 8);
    // Head / helmet
    M.stoneSculpt.cyl(fx, fz + dir * 0.18, 0.30, hTop - 0.8, 0.24, hTop, 8);
    // Raised arms, shields & spears/swords
    if (i % 2 === 0) {
      M.stoneSculpt.bar([fx, hTop - 1.1, fz + dir * 0.2], [fx + sx * 0.65, hTop + 1.15, fz + dir * 0.45], 0.14);
      M.stoneTrim.bar([fx + sx * 0.65, hTop + 1.1, fz + dir * 0.45], [fx + sx * 1.1, hTop + 2.4, fz + dir * 0.55], 0.06);
    } else {
      // Round shield held forward
      M.stoneTrim.cyl(fx + 0.35, fz + dir * 0.38, 0.58, hBase + 3.0, 0.58, hBase + 4.1, 10);
    }
  }

  // 3. Upper register (y = 12.2 .. 17.8 m): The Winged Genius / Bellona / Victory
  // Especially dramatic on SE (+X, +Z: Rude's La Marseillaise with wide spread wings & sword)
  const uY = 12.4;
  const uZ = zWall + dir * 1.25;
  // Floating/charging central allegorical figure
  M.stoneSculpt.bar([cx - sx * 0.5, uY, uZ], [cx + sx * 0.3, uY + 3.6, uZ + dir * 0.35], 0.56);
  M.stoneSculpt.cyl(cx + sx * 0.35, uZ + dir * 0.4, 0.34, uY + 3.6, 0.28, uY + 4.45, 8);
  // Outstretched sword arm & pointing arm
  M.stoneSculpt.bar([cx + sx * 0.3, uY + 3.3, uZ + dir * 0.35], [cx + sx * 1.9, uY + 4.9, uZ + dir * 0.55], 0.16);
  M.gilt.bar([cx + sx * 1.9, uY + 4.9, uZ + dir * 0.55], [cx + sx * 3.1, uY + 5.6, uZ + dir * 0.6], 0.06);
  M.stoneSculpt.bar([cx + sx * 0.1, uY + 3.2, uZ + dir * 0.35], [cx - sx * 1.8, uY + 4.2, uZ + dir * 0.5], 0.16);

  // Great feathered wings spreading across the upper pier (6 layered feather struts per wing)
  for (const side of [-1, 1]) {
    for (let f = 0; f < 6; f++) {
      const span = 2.9 - f * 0.32;
      const lift = 2.4 - f * 0.42;
      M.stoneSculpt.bar(
        [cx, uY + 2.8, uZ],
        [cx + side * span, uY + 2.8 + lift, zWall + dir * (0.75 + (5 - f) * 0.08)],
        0.15
      );
    }
  }
}

for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    buildMonumentalRelief(sx, sz);
  }
}

/**
 * Builds the 6 rectangular Bas-Relief Panels (y = 22.6 .. 27.8 m):
 * 4 on the main North/South facades above the monumental groups, and 2 on the East/West narrow flanks.
 */
function buildBasReliefPanels() {
  const y0 = 22.8, y1 = 27.6;
  // 4 panels on the North (-Z) and South (+Z) facades
  for (const sz of [-1, 1]) {
    const zWall = sz * D_HALF;
    for (const sx of [-1, 1]) {
      const xA = sx < 0 ? -19.2 : 10.5;
      const xB = sx < 0 ? -10.5 : 19.2;
      // Molded frame + recessed dark backing + 14 relief figures
      M.stoneTrim.box(xA - 0.35, y0 - 0.35, zWall - 0.35, xB + 0.35, y1 + 0.35, zWall + 0.35);
      M.stoneShade.box(xA, y0, zWall - 0.42 * (sz < 0 ? 1 : 0), xB, y1, zWall + 0.42 * (sz > 0 ? 1 : 0));
      const count = 14;
      for (let k = 0; k < count; k++) {
        const fx = xA + 0.45 + ((xB - xA - 0.9) * k) / (count - 1);
        const fh = 3.1 + ((k * 7) % 5) * 0.22;
        M.stoneSculpt.cyl(fx, zWall + sz * 0.36, 0.24, y0 + 0.2, 0.20, y0 + 0.2 + fh, 6);
      }
    }
  }
  // 2 panels on the West (-X) and East (+X) flanks above the transverse arches
  for (const sx of [-1, 1]) {
    const xWall = sx * W_HALF;
    const zA = -5.6, zB = 5.6;
    M.stoneTrim.box(xWall - 0.35, y0 - 0.35, zA - 0.35, xWall + 0.35, y1 + 0.35, zB + 0.35);
    const count = 16;
    for (let k = 0; k < count; k++) {
      const fz = zA + 0.5 + ((zB - zA - 1.0) * k) / (count - 1);
      const fh = 3.1 + ((k * 5) % 4) * 0.25;
      M.stoneSculpt.cyl(xWall + sx * 0.36, fz, 0.24, y0 + 0.2, 0.20, y0 + 0.2 + fh, 6);
    }
  }
}
buildBasReliefPanels();

// ============================================================================
// PART 2.5: GRAND ENTABLATURE, GREAT FRIEZE OF THE ARMIES, ATTIC & 30 SHIELDS, ROOFTOP
// ============================================================================
{
  // Helper to build a horizontal perimeter ring from yA to yB with outward overhang `out`,
  // keeping the East-South stairwell shaft [STAIR_X0..STAIR_X1, STAIR_Z0..STAIR_Z1] completely open!
  const buildRing = (bucket, yA, yB, out = 0, capTop = false) => {
    const x0 = -W_HALF - out, x1 = W_HALF + out;
    const z0 = -D_HALF - out, z1 = D_HALF + out;
    const opts = { capTop, capBottom: out > 0.5 };
    bucket.box(x0, yA, z0, x1, yB, STAIR_Z0, opts); // Entire North & central section
    bucket.box(x0, yA, STAIR_Z1, x1, yB, z1, opts); // South strip behind stairwell
    bucket.box(x0, yA, STAIR_Z0, STAIR_X0, yB, STAIR_Z1, opts); // West of stairwell
    bucket.box(STAIR_X1, yA, STAIR_Z0, x1, yB, STAIR_Z1, opts); // East of stairwell
  };

  // 1. Triple-fascia Architrave (y = 30.2 .. 31.6 m)
  buildRing(M.stoneTrim, ENTAB_Y0, ENTAB_Y0 + 0.65, 0.45);
  buildRing(M.stoneTrim, ENTAB_Y0 + 0.65, FRIEZE_Y0, 0.72);

  // 2. Great Figurative Frieze (Le Départ et le Retour des Armées, y = 31.6 .. 34.2 m)
  buildRing(M.stone, FRIEZE_Y0, FRIEZE_Y1, 0.38);
  // Continuous procession of 128 sculpted figures in high relief around all 4 sides
  for (const sz of [-1, 1]) {
    const zF = sz * (D_HALF + 0.52);
    for (let x = -W_HALF + 0.7; x <= W_HALF - 0.7; x += 1.05) {
      M.stoneSculpt.cyl(x, zF, 0.22, FRIEZE_Y0 + 0.15, 0.19, FRIEZE_Y1 - 0.2, 6);
    }
  }
  for (const sx of [-1, 1]) {
    const xF = sx * (W_HALF + 0.52);
    for (let z = -D_HALF + 0.7; z <= D_HALF - 0.7; z += 1.05) {
      M.stoneSculpt.cyl(xF, z, 0.22, FRIEZE_Y0 + 0.15, 0.19, FRIEZE_Y1 - 0.2, 6);
    }
  }

  // 3. Bold Projecting Classical Cornice with Dentils & Scroll Modillions (y = 34.2 .. 37.8 m)
  buildRing(M.stoneTrim, FRIEZE_Y1, FRIEZE_Y1 + 0.75, 0.92); // Dentil bed
  buildRing(M.stoneTrim, FRIEZE_Y1 + 0.75, FRIEZE_Y1 + 1.85, 1.55); // Modillion band
  buildRing(M.stoneTrim, FRIEZE_Y1 + 1.85, CORNICE_Y1, 2.25, true); // Corona & cymatium overhang

  // 76 carved scroll modillion brackets under the cornice overhang around all 4 sides
  for (const sz of [-1, 1]) {
    const z0 = sz * (D_HALF + 0.85), z1 = sz * (D_HALF + 2.05);
    for (let x = -W_HALF - 0.8; x <= W_HALF + 0.8; x += 2.2) {
      M.stoneSculpt.box(x - 0.26, FRIEZE_Y1 + 0.8, Math.min(z0, z1), x + 0.26, FRIEZE_Y1 + 1.85, Math.max(z0, z1), { capBottom: true });
    }
  }
  for (const sx of [-1, 1]) {
    const x0 = sx * (W_HALF + 0.85), x1 = sx * (W_HALF + 2.05);
    for (let z = -D_HALF - 0.4; z <= D_HALF + 0.4; z += 2.2) {
      M.stoneSculpt.box(Math.min(x0, x1), FRIEZE_Y1 + 0.8, z - 0.26, Math.max(x0, x1), FRIEZE_Y1 + 1.85, z + 0.26, { capBottom: true });
    }
  }

  // 4. The Attic Story (y = 37.8 .. 46.8 m) & the 30 Inscribed Shields of Victories
  buildRing(M.stoneTrim, CORNICE_Y1, CORNICE_Y1 + 1.2, -0.35); // Attic base plinth
  buildRing(M.stone, CORNICE_Y1 + 1.2, ATTIC_Y1, -0.65); // Attic wall

  const shieldY = 42.6;
  const shieldR = 1.18;
  // Helper to place a sculpted circular shield (bouclier) & flanking sword pilaster
  const addShieldAndPilasters = (x0, z0, x1, z1, nx, nz, count) => {
    const dx = (x1 - x0) / count;
    const dz = (z1 - z0) / count;
    for (let i = 0; i <= count; i++) {
      // Pilaster with vertical sculpted Roman sword
      const px = x0 + dx * i, pz = z0 + dz * i;
      M.stoneTrim.box(px - 0.38, CORNICE_Y1 + 1.2, pz - 0.38, px + 0.38, ATTIC_Y1, pz + 0.38);
      M.gilt.bar([px + nx * 0.42, CORNICE_Y1 + 2.2, pz + nz * 0.42], [px + nx * 0.42, ATTIC_Y1 - 1.1, pz + nz * 0.42], 0.08);
    }
    for (let i = 0; i < count; i++) {
      const cx = x0 + dx * (i + 0.5) + nx * 0.25;
      const cz = z0 + dz * (i + 0.5) + nz * 0.25;
      // Recessed rectangular attic panel
      const tx = -nz, tz = nx;
      M.stoneShade.box(
        cx - Math.abs(tx) * 1.45 - Math.abs(nx) * 0.08,
        CORNICE_Y1 + 1.8,
        cz - Math.abs(tz) * 1.45 - Math.abs(nz) * 0.08,
        cx + Math.abs(tx) * 1.45 + Math.abs(nx) * 0.08,
        ATTIC_Y1 - 0.8,
        cz + Math.abs(tz) * 1.45 + Math.abs(nz) * 0.08
      );
      // Circular shield with gilt rim and central boss
      const segs = 16;
      const disk = (r, off) =>
        Array.from({ length: segs }, (_, k) => {
          const a = (k / segs) * Math.PI * 2;
          const u = Math.cos(a) * r, v = Math.sin(a) * r;
          return [cx + tx * u + nx * off, shieldY + v, cz + tz * u + nz * off];
        });
      M.gilt.poly(disk(shieldR, 0.16), [nx, 0, nz]);
      M.stoneSculpt.poly(disk(shieldR * 0.82, 0.22), [nx, 0, nz]);
      M.gilt.poly(disk(shieldR * 0.28, 0.30), [nx, 0, nz]);
    }
  };

  // 11 shields on South (+Z), 11 on North (-Z), 4 on East (+X), 4 on West (-X) = 30 shields!
  const aw = W_HALF - 0.65, ad = D_HALF - 0.65;
  addShieldAndPilasters(-aw, ad, aw, ad, 0, 1, 11);
  addShieldAndPilasters(aw, -ad, -aw, -ad, 0, -1, 11);
  addShieldAndPilasters(aw, ad, aw, -ad, 1, 0, 4);
  addShieldAndPilasters(-aw, -ad, -aw, ad, -1, 0, 4);

  // 5. Attic Crowning Cornice & Walkable Rooftop Terrace (y = 46.8 .. 49.5 m)
  buildRing(M.stoneTrim, ATTIC_Y1, ATTIC_Y1 + 1.4, 0.55, false);
  buildRing(M.paving, ATTIC_Y1 + 1.4, ROOF_Y, 0.45, true);

  // Rooftop Perimeter Acroteria Balustrade (y = 49.5 .. 50.8 m, keeps walkers safely on the terrace)
  const rx = W_HALF + 0.4, rz = D_HALF + 0.4;
  M.stoneTrim.box(-rx, ROOF_Y, rz - 0.45, rx, PARAPET_Y, rz); // South parapet (z ∈ [11.05, 11.5])
  M.stoneTrim.box(-rx, ROOF_Y, -rz, rx, PARAPET_Y, -rz + 0.45); // North parapet
  M.stoneTrim.box(-rx, ROOF_Y, -rz, -rx + 0.45, PARAPET_Y, rz); // West parapet
  M.stoneTrim.box(rx - 0.45, ROOF_Y, -rz, rx, PARAPET_Y, rz); // East parapet

  // Guardrails & glass/stone exit pavilion around the stairwell opening [11.4..20.8, 5.0..10.2]
  // Note: West side (x = 9.0..11.4) is the top landing at y = 49.5 m where the walker exits onto the terrace!
  M.stoneTrim.box(11.4, ROOF_Y, STAIR_Z0 - 0.35, STAIR_X1 + 0.2, PARAPET_Y, STAIR_Z0); // North guardrail of shaft
  M.stoneTrim.box(11.4, ROOF_Y, STAIR_Z1, STAIR_X1 + 0.2, PARAPET_Y, STAIR_Z1 + 0.35); // South guardrail of shaft
  M.stoneTrim.box(STAIR_X1, ROOF_Y, STAIR_Z0 - 0.35, STAIR_X1 + 0.35, PARAPET_Y, STAIR_Z1 + 0.35); // East guardrail
  // Warm beacon lantern at the rooftop stair landing so it is easy to find on the roof
  M.iron.cyl(11.5, STAIR_Z0 - 0.2, 0.12, PARAPET_Y, 0.09, PARAPET_Y + 2.2, 8);
  M.lamp.cyl(11.5, STAIR_Z0 - 0.2, 0.28, PARAPET_Y + 2.2, 0.28, PARAPET_Y + 2.75, 8);

  // Brass orientation tables & panoramic telescopes along the rooftop terrace
  for (const [tx, tz] of [[-12, 8.8], [0, 8.8], [-12, -8.8], [0, -8.8], [-19.8, 0], [19.8, -2.5]]) {
    M.bronze.cyl(tx, tz, 0.18, ROOF_Y, 0.14, ROOF_Y + 1.05, 8);
    M.gilt.cyl(tx, tz, 0.55, ROOF_Y + 1.05, 0.55, ROOF_Y + 1.14, 12);
  }
}

// ============================================================================
// PART 2.6: TOMB OF THE UNKNOWN SOLDIER & THE ETERNAL FLAME (AT (0, 0) UNDER GRAND VAULT)
// ============================================================================
{
  const ty = GROUND + 0.03;
  // Black/dark granite surround & bronze epitaph slab at (0, 0)
  M.granite.box(-2.4, ty, -3.4, 2.4, ty + 0.10, 3.4);
  M.bronze.box(-1.55, ty + 0.10, -2.5, 1.55, ty + 0.16, 2.5);
  M.gilt.box(-1.25, ty + 0.16, -2.1, 1.25, ty + 0.18, 0.3);

  // Sculpted bronze cannon-shield brazier (Flamme éternelle) at (0, 1.35)
  const fz = 1.35;
  M.granite.cyl(0, fz, 1.25, ty + 0.10, 1.10, ty + 0.26, 24);
  M.bronze.cyl(0, fz, 0.98, ty + 0.26, 0.72, ty + 0.48, 24);
  M.gilt.cyl(0, fz, 0.38, ty + 0.48, 0.18, ty + 0.64, 16);
  // Central sword-hilt flame nozzle + glowing ember core (animated flame sits right above this in viewer-arc.ts)
  M.flame.cyl(0, fz, 0.28, ty + 0.58, 0.06, ty + 1.28, 12);
  M.lamp.cyl(0, fz, 0.16, ty + 0.62, 0.03, ty + 1.42, 10);

  // French Tricolore floral wreath tribute at the foot of the slab (z = -2.1)
  M.flagBlue.box(-0.9, ty + 0.16, -2.35, -0.3, ty + 0.32, -1.75);
  M.flagWhite.box(-0.3, ty + 0.16, -2.35, 0.3, ty + 0.32, -1.75);
  M.flagRed.box(0.3, ty + 0.16, -2.35, 0.9, ty + 0.32, -1.75);

  // 8 low cannon-shaped bronze bollards & chains framing the sacred slab (kept <= 0.58 m so walkers can pass)
  const posts = [
    [-2.8, -3.8], [0, -3.8], [2.8, -3.8],
    [2.8, 0], [2.8, 3.8],
    [0, 3.8], [-2.8, 3.8], [-2.8, 0],
  ];
  for (let i = 0; i < posts.length; i++) {
    const [px, pz] = posts[i];
    const [nx, nz] = posts[(i + 1) % posts.length];
    M.bronze.cyl(px, pz, 0.20, ty, 0.14, ty + 0.54, 8);
    M.gilt.cyl(px, pz, 0.16, ty + 0.54, 0.08, ty + 0.60, 8);
    M.iron.bar([px, ty + 0.42, pz], [nx, ty + 0.42, nz], 0.03);
  }
}

// ============================================================================
// PART 3: THE 12 RADIATING AVENUES, HÔTELS DES MARÉCHAUX & HAUSSMANN BLOCKS
// ============================================================================

/**
 * The 12 historic avenues radiating from Place Charles de Gaulle (Place de l'Étoile),
 * ordered clockwise starting from +Z (0 rad = Avenue des Champs-Élysées):
 */
const AVENUES = [
  { name: 'Avenue des Champs-Élysées', angle: (0 * Math.PI) / 6, halfWidth: 35.0, main: true },
  { name: 'Avenue Marceau', angle: (1 * Math.PI) / 6, halfWidth: 16.5 },
  { name: "Avenue d'Iéna", angle: (2 * Math.PI) / 6, halfWidth: 16.5 },
  { name: 'Avenue Kléber', angle: (3 * Math.PI) / 6, halfWidth: 18.5 },
  { name: 'Avenue Victor-Hugo', angle: (4 * Math.PI) / 6, halfWidth: 17.0 },
  { name: 'Avenue Foch', angle: (5 * Math.PI) / 6, halfWidth: 42.0, park: true }, // Widest avenue with green pelouses
  { name: 'Avenue de la Grande-Armée', angle: (6 * Math.PI) / 6, halfWidth: 35.0, main: true },
  { name: 'Avenue Carnot', angle: (7 * Math.PI) / 6, halfWidth: 16.0 },
  { name: 'Avenue Mac-Mahon', angle: (8 * Math.PI) / 6, halfWidth: 16.5 },
  { name: 'Avenue de Wagram', angle: (9 * Math.PI) / 6, halfWidth: 18.5 },
  { name: 'Avenue Hoche', angle: (10 * Math.PI) / 6, halfWidth: 17.5 },
  { name: 'Avenue de Friedland', angle: (11 * Math.PI) / 6, halfWidth: 17.5 },
];

const EAVES = 21.8; // Hôtels des Maréchaux cornice height
const OUTER_EAVES = 25.2; // Outer Haussmannian block cornice height
const FLOOR_H = [GROUND, 7.8, 15.2, EAVES];
const BAY = 6.0;

/**
 * Draws an architectural Parisian limestone façade along any arbitrary line segment (ax, az) -> (bx, bz)
 * with outward normal (nx, nz). Supports ground-floor arcades, wrought-iron balconies, pedimented
 * piano-nobile windows, pilasters, cornices and roof balustrades.
 */
function facade(ax, az, bx, bz, nx, nz, { height = EAVES, arcade = true, y0 = GROUND } = {}) {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 3.5) return;
  const tx = (bx - ax) / len;
  const tz = (bz - az) / len;
  const P = (s, y, o) => [ax + tx * s + nx * o, y, az + tz * s + nz * o];
  const panel = (bucket, s0, s1, ya, yb, o) =>
    bucket.poly([P(s0, ya, o), P(s1, ya, o), P(s1, yb, o), P(s0, yb, o)], [nx, 0, nz]);
  const relief = (bucket, s0, s1, ya, yb, out) => {
    panel(bucket, s0, s1, ya, yb, out);
    bucket.poly([P(s0, yb, 0), P(s0, yb, out), P(s1, yb, out), P(s1, yb, 0)], [0, 1, 0]);
    bucket.poly([P(s0, ya, out), P(s0, ya, 0), P(s1, ya, 0), P(s1, ya, out)], [0, -1, 0]);
    bucket.poly([P(s0, ya, 0), P(s0, ya, out), P(s0, yb, out), P(s0, yb, 0)], [-tx, 0, -tz]);
    bucket.poly([P(s1, ya, out), P(s1, ya, 0), P(s1, yb, 0), P(s1, yb, out)], [tx, 0, tz]);
  };
  const scale = (height - y0) / (EAVES - GROUND);
  const Y = (y) => y0 + (y - GROUND) * scale;

  // Plinth, string courses, Haussmann Continuous Balconies (2nd and 5th floors), Cornice & Balustrade
  relief(M.stoneTrim, 0, len, Y(GROUND), Y(GROUND + 1.0), 0.32);
  relief(M.stoneTrim, 0, len, Y(FLOOR_H[1] - 0.55), Y(FLOOR_H[1]), 0.52);
  relief(M.iron, 0, len, Y(FLOOR_H[1]), Y(FLOOR_H[1] + 0.85), 0.46); // Continuous wrought-iron balcony
  relief(M.stoneTrim, 0, len, Y(FLOOR_H[2] - 0.45), Y(FLOOR_H[2]), 0.48);
  relief(M.iron, 0, len, Y(FLOOR_H[2]), Y(FLOOR_H[2] + 0.78), 0.42); // Upper wrought-iron balcony
  relief(M.stoneTrim, 0, len, Y(EAVES - 0.9), Y(EAVES), 0.78);
  relief(M.stoneTrim, 0, len, Y(EAVES), Y(EAVES) + 0.95, 0.52);

  const bays = Math.max(1, Math.round(len / BAY));
  const w = len / bays;
  for (let i = 0; i <= bays; i++) {
    const s = i * w;
    const half = Math.min(0.48, w * 0.09);
    const s0 = Math.max(0, s - half), s1 = Math.min(len, s + half);
    relief(M.stoneTrim, s0, s1, Y(GROUND + 1.0), Y(FLOOR_H[1] - 0.55), 0.26);
    relief(M.stoneTrim, s0, s1, Y(FLOOR_H[1]), Y(EAVES - 0.9), 0.24);
  }
  for (let i = 0; i < bays; i++) {
    const c = (i + 0.5) * w;
    const ww = Math.min(1.4, w * 0.26);
    if (arcade) {
      const top = Y(FLOOR_H[1] - 1.6);
      const spring = top - ww * 0.85;
      panel(M.stoneShade, c - ww, c + ww, Y(GROUND + 0.2), spring, 0.04);
      panel(M.window, c - ww * 0.75, c + ww * 0.75, Y(GROUND + 0.8), top - 0.3, 0.07);
      relief(M.stoneTrim, c - 0.25, c + 0.25, top - 0.2, top + 0.55, 0.38);
    } else {
      panel(M.window, c - ww, c + ww, Y(GROUND + 1.4), Y(FLOOR_H[1] - 1.6), 0.05);
    }
    // Piano nobile & intermediate floor tall French windows
    const a0 = Y(FLOOR_H[1] + 0.9), a1 = Y(FLOOR_H[2] - 1.3);
    panel(M.window, c - ww, a1 > a0 ? c + ww : c, a0, a1, 0.05);
    panel(M.stoneTrim, c - ww, c + ww, (a0 + a1) / 2 - 0.18, (a0 + a1) / 2 + 0.18, 0.12);
    // Upper floor windows
    const b0 = Y(FLOOR_H[2] + 0.85), b1 = Y(EAVES - 1.3);
    panel(M.window, c - ww * 0.82, c + ww * 0.82, b0, b1, 0.05);
  }
}

/** Dormer window sitting on a mansard roof slope facing (nx, nz). */
function dormer(x, z, nx, nz, y) {
  const tx = -nz, tz = nx;
  const P = (s, h, o) => [x + tx * s - nx * o, y + h, z + tz * s - nz * o];
  const front = [P(-0.85, 0.5, 1.0), P(0.85, 0.5, 1.0), P(0.85, 2.4, 1.0), P(0, 3.0, 1.0), P(-0.85, 2.4, 1.0)];
  M.stoneTrim.poly(front, [nx, 0, nz]);
  M.window.poly([P(-0.52, 0.8, 0.95), P(0.52, 0.8, 0.95), P(0.52, 2.2, 0.95), P(-0.52, 2.2, 0.95)], [nx, 0, nz]);
  M.lead.poly([P(-0.85, 2.4, 1.0), P(0, 3.0, 1.0), P(0, 3.0, 3.6), P(-0.85, 2.4, 3.0)]);
  M.lead.poly([P(0, 3.0, 1.0), P(0.85, 2.4, 1.0), P(0.85, 2.4, 3.0), P(0, 3.0, 3.6)]);
}

/** Parisian streetlamp standard (Style Oudry / Hittorff). */
function lampPost(x, z) {
  M.iron.cyl(x, z, 0.28, GROUND, 0.16, GROUND + 0.95, 8);
  M.iron.cyl(x, z, 0.09, GROUND + 0.95, 0.07, GROUND + 5.1, 6);
  M.iron.cyl(x, z, 0.30, GROUND + 5.1, 0.34, GROUND + 5.25, 6);
  M.lamp.cyl(x, z, 0.25, GROUND + 5.25, 0.29, GROUND + 5.85, 6);
  M.iron.cyl(x, z, 0.33, GROUND + 5.85, 0.02, GROUND + 6.25, 6);
}

/** Chestnut / Plane tree with multi-lobe canopy. */
function tree(x, z, h = 12.5, r = 4.6) {
  h *= 0.88 + rnd() * 0.28;
  r *= 0.88 + rnd() * 0.25;
  const y = GROUND;
  M.trunk.cyl(x, z, 0.46, y, 0.28, y + h * 0.45, 7);
  const cy = y + h * 0.68;
  M.foliageDark.blob(x, cy - r * 0.1, z, r * 0.8, r * 0.7, r * 0.8, rnd() * 50);
  const lobes = 5;
  const a0 = rnd() * 6.28;
  for (let k = 0; k < lobes; k++) {
    const a = a0 + (k / lobes) * 6.28;
    const rr = r * (0.5 + rnd() * 0.16);
    const sunny = -Math.cos(a) * 0.7 + Math.sin(a) * 0.6 > 0.2;
    (sunny ? M.foliageLight : M.foliage).blob(
      x + Math.cos(a) * r * 0.54,
      cy + (rnd() - 0.4) * r * 0.38,
      z + Math.sin(a) * r * 0.54,
      rr,
      rr * 0.85,
      rr,
      rnd() * 50,
      8,
      5
    );
  }
}

/**
 * Builds a custom polygonal Haussmannian / Hôtel des Maréchaux building block from a counter-clockwise
 * ring of [x, z] vertices, complete with ornate facades on every edge, mansard slate roof, dormers and chimneys.
 */
function buildPolygonBlock(pts, { height = EAVES, roof = 6.8, arcadeFront = true, cornerRotunda = false } = {}) {
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p[0], 0) / n;
  const cz = pts.reduce((s, p) => s + p[1], 0) / n;
  const shrinkRing = (dist) =>
    pts.map(([x, z]) => {
      const dx = x - cx, dz = z - cz;
      const d = Math.hypot(dx, dz) || 1;
      const f = Math.max(0.15, (d - dist) / d);
      return [cx + dx * f, cz + dz * f];
    });

  // Main limestone walls
  M.haussmann.loft(pts, 0, pts, height, { capTop: true });

  // Ornate facades & dormers on each side
  for (let i = 0; i < n; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % n];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 4) continue;
    // Outward normal for our ring winding
    let nx = -dz / len, nz = dx / len;
    const midX = (ax + bx) / 2, midZ = (az + bz) / 2;
    if (nx * (midX - cx) + nz * (midZ - cz) < 0) {
      nx = -nx;
      nz = -nz;
      facade(bx, bz, ax, az, nx, nz, { height, arcade: i === 0 && arcadeFront });
    } else {
      facade(ax, az, bx, bz, nx, nz, { height, arcade: i === 0 && arcadeFront });
    }
    const dorms = Math.max(1, Math.floor(len / 13));
    for (let d = 0; d < dorms; d++) {
      const t = (d + 0.5) / dorms;
      dormer(ax + dx * t - nx * 0.8, az + dz * t - nz * 0.8, nx, nz, height);
    }
  }

  // Mansard roof: steep lower slate slope + upper cap + lead cresting
  const r1 = shrinkRing(2.2);
  const r2 = shrinkRing(6.5);
  M.slate.loft(shrinkRing(0.7), height, r1, height + roof * 0.72, { capTop: false });
  M.slate.loft(r1, height + roof * 0.72, r2, height + roof, { capTop: true });
  M.lead.loft(r2, height + roof, shrinkRing(7.0), height + roof + 0.45, { capTop: true });

  // Corner Haussmannian Rotunda Dome on the inner corners facing the avenues/plaza
  if (cornerRotunda) {
    for (const [vx, vz] of [pts[0], pts[1]]) {
      const dx = cx - vx, dz = cz - vz;
      const d = Math.hypot(dx, dz) || 1;
      const rx = vx + (dx / d) * 3.8, rz = vz + (dz / d) * 3.8;
      M.stoneTrim.cyl(rx, rz, 4.4, GROUND, 4.2, height + 1.5, 12);
      M.slate.cyl(rx, rz, 4.2, height + 1.5, 2.6, height + roof + 3.2, 12);
      M.lead.cyl(rx, rz, 2.6, height + roof + 3.2, 0.3, height + roof + 5.8, 10);
      M.lead.cyl(rx, rz, 0.15, height + roof + 5.8, 0.03, height + roof + 8.5, 6);
    }
  }
}

// Build each of the 12 wedges between Avenue k and Avenue (k + 1)
for (let k = 0; k < 12; k++) {
  const av0 = AVENUES[k];
  const av1 = AVENUES[(k + 1) % 12];
  const a0 = av0.angle;
  const a1 = k === 11 ? Math.PI * 2 : av1.angle;

  // Angular margin for each avenue's roadway + wide tree-lined sidewalks at radius r
  const ang0 = (r, extra = 0) => a0 + Math.asin(Math.min(0.92, (av0.halfWidth + extra) / r));
  const ang1 = (r, extra = 0) => a1 - Math.asin(Math.min(0.92, (av1.halfWidth + extra) / r));

  // 1. Circular Promenade sector along Place Charles de Gaulle (r = 96.5 .. 158 m)
  const pA0 = ang0(ROUNDABOUT_R + 4, -8.5);
  const pA1 = ang1(ROUNDABOUT_R + 4, -8.5);
  if (pA1 > pA0 + 0.04) {
    sectorSlab(M.granite, ROUNDABOUT_R, TILSITT_INNER_R + 2, pA0 - 0.008, pA1 + 0.008, ROAD_Y, GROUND, 8);
    sectorSlab(M.paving, ROUNDABOUT_R + 0.9, TILSITT_INNER_R + 1.2, pA0, pA1, ROAD_Y, GROUND + 0.02, 8);

    // Double row of trees & cast-iron lamps along the circular Étoile promenade
    const arcLen = (pA1 - pA0) * (ROUNDABOUT_R + 9);
    const nTrees = Math.max(2, Math.floor(arcLen / 13));
    for (let t = 0; t < nTrees; t++) {
      const a = pA0 + ((pA1 - pA0) * (t + 0.5)) / nTrees;
      tree(Math.sin(a) * (ROUNDABOUT_R + 7.5), Math.cos(a) * (ROUNDABOUT_R + 7.5), 11.5, 4.2);
      if (t % 2 === 0) {
        lampPost(Math.sin(a) * (ROUNDABOUT_R + 3.2), Math.cos(a) * (ROUNDABOUT_R + 3.2));
      }
    }
  }

  // 2. Inner Wedge Block: Hôtel des Maréchaux (r = 118 .. 156 m, uniform neoclassical mansion)
  const mR0 = PROMENADE_R, mR1 = TILSITT_INNER_R - 2;
  const mA0_in = ang0(mR0, 0), mA1_in = ang1(mR0, 0);
  const mA0_out = ang0(mR1, 0), mA1_out = ang1(mR1, 0);
  if (mA1_in > mA0_in + 0.035 && mA1_out > mA0_out + 0.035) {
    const pts = [
      [Math.sin(mA0_in) * mR0, Math.cos(mA0_in) * mR0],
      [Math.sin(mA1_in) * mR0, Math.cos(mA1_in) * mR0],
      [Math.sin(mA1_out) * mR1, Math.cos(mA1_out) * mR1],
      [Math.sin(mA0_out) * mR1, Math.cos(mA0_out) * mR1],
    ];
    buildPolygonBlock(pts, { height: EAVES, roof: 6.4, arcadeFront: true, cornerRotunda: false });
  }

  // 3. Outer Wedge Block: Grand Haussmannian Quarter (r = 172 .. 258 m) beyond Rue de Tilsitt / Presbourg
  const hR0 = TILSITT_OUTER_R, hR1 = OUTER_BLOCK_R;
  const sA0_in = ang0(hR0, -9.0), sA1_in = ang1(hR0, -9.0);
  const sA0_out = ang0(hR1, -9.0), sA1_out = ang1(hR1, -9.0);
  if (sA1_in > sA0_in + 0.03 && sA1_out > sA0_out + 0.03) {
    // Sidewalk apron under the outer Haussmann block
    const swPts = [
      [Math.sin(sA0_in) * (hR0 - 3), Math.cos(sA0_in) * (hR0 - 3)],
      [Math.sin(sA1_in) * (hR0 - 3), Math.cos(sA1_in) * (hR0 - 3)],
      [Math.sin(sA1_out) * (hR1 + 4), Math.cos(sA1_out) * (hR1 + 4)],
      [Math.sin(sA0_out) * (hR1 + 4), Math.cos(sA0_out) * (hR1 + 4)],
    ];
    M.granite.loft(swPts, ROAD_Y, swPts, GROUND, { capTop: false });
    M.paving.loft(swPts, ROAD_Y, swPts, GROUND + 0.02, { capTop: true });

    const hA0_in = ang0(hR0, 0), hA1_in = ang1(hR0, 0);
    const hA0_out = ang0(hR1, 0), hA1_out = ang1(hR1, 0);
    if (hA1_in > hA0_in + 0.025 && hA1_out > hA0_out + 0.025) {
      const hPts = [
        [Math.sin(hA0_in) * hR0, Math.cos(hA0_in) * hR0],
        [Math.sin(hA1_in) * hR0, Math.cos(hA1_in) * hR0],
        [Math.sin(hA1_out) * hR1, Math.cos(hA1_out) * hR1],
        [Math.sin(hA0_out) * hR1, Math.cos(hA0_out) * hR1],
      ];
      buildPolygonBlock(hPts, { height: OUTER_EAVES, roof: 7.4, arcadeFront: false, cornerRotunda: true });
    }
  }

  // 4. Avenue trees, streetlamps, and (for Avenue Foch) lateral green lawns (pelouses)
  const dirX = Math.sin(a0), dirZ = Math.cos(a0);
  const perpX = Math.cos(a0), perpZ = -Math.sin(a0);
  const treeOffset = av0.halfWidth - 4.5;
  for (let r = PROMENADE_R + 8; r <= OUTER_BLOCK_R - 8; r += 19) {
    // Skip the Rue de Tilsitt ring intersection (r ∈ [154, 174])
    if (r > 152 && r < 176) continue;
    for (const side of [-1, 1]) {
      const tx = dirX * r + perpX * side * treeOffset;
      const tz = dirZ * r + perpZ * side * treeOffset;
      tree(tx, tz, av0.main ? 13.5 : 11.8, av0.main ? 4.8 : 4.2);
      if (av0.main) {
        // Second inner row of clipped plane trees on the Champs-Élysées & Grande-Armée!
        const tx2 = dirX * r + perpX * side * (av0.halfWidth - 11.5);
        const tz2 = dirZ * r + perpZ * side * (av0.halfWidth - 11.5);
        tree(tx2, tz2, 11.5, 4.0);
      }
      lampPost(
        dirX * (r + 9) + perpX * side * (av0.halfWidth - 8.2),
        dirZ * (r + 9) + perpZ * side * (av0.halfWidth - 8.2)
      );
    }
  }

  // Special feature for Avenue Foch (k = 5): Famous manicured green Pelouses (lawns) & hedges flanking the central roadway
  if (av0.park) {
    for (const side of [-1, 1]) {
      const lat0 = side * 16.0, lat1 = side * 32.5;
      for (const [rA, rB] of [[116, 154], [174, 258]]) {
        const lPts = [
          [dirX * rA + perpX * lat0, dirZ * rA + perpZ * lat0],
          [dirX * rB + perpX * lat0, dirZ * rB + perpZ * lat0],
          [dirX * rB + perpX * lat1, dirZ * rB + perpZ * lat1],
          [dirX * rA + perpX * lat1, dirZ * rA + perpZ * lat1],
        ];
        if (side < 0) lPts.reverse();
        M.granite.loft(lPts, ROAD_Y, lPts, GROUND + 0.08, { capTop: false });
        M.lawn.loft(lPts, ROAD_Y, lPts, GROUND + 0.12, { capTop: true });
      }
    }
  }
}

// ============================================================================
// PART 4: WRITE COMPRESSED GLB (public/models/arc.glb)
// ============================================================================
const doc = new Document();
doc.getRoot().getAsset().generator = 'Paris vivant Arc de Triomphe 3D builder (CC0)';
const buffer = doc.createBuffer();
const scene = doc.createScene('Arc_de_Triomphe');
let tris = 0;
let verts = 0;
for (const b of Object.values(M)) {
  if (!b.idx.length) continue;
  const material = doc
    .createMaterial(b.name)
    .setBaseColorFactor([...b.color, b.alpha])
    .setMetallicFactor(b.metal)
    .setRoughnessFactor(b.rough);
  if (b.alpha < 1) material.setAlphaMode('BLEND').setDoubleSided(true);
  if (b.emissive) material.setEmissiveFactor(b.emissive);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(b.pos)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(b.norm)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(b.idx)).setBuffer(buffer))
    .setMaterial(material);
  scene.addChild(doc.createNode(b.name).setMesh(doc.createMesh(b.name).addPrimitive(prim)));
  tris += b.idx.length / 3;
  verts += b.pos.length / 3;
}
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await doc.transform(weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 10 }));
const dir = new URL('../public/models/', import.meta.url);
mkdirSync(dir, { recursive: true });
const glb = await io.writeBinary(doc);
writeFileSync(new URL('arc.glb', dir), glb);
console.log(
  `wrote public/models/arc.glb: ${(glb.byteLength / 1e6).toFixed(2)} MB — ${Object.values(M).filter((b) => b.idx.length).length} materials, ${verts.toLocaleString()} vertices, ${tris.toLocaleString()} triangles`
);
