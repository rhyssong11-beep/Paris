// Generates the Louvre: the glass pyramid and its basins in the Cour Napoléon, the palace wings with
// their pavilions, the Cour Carrée, the Arc de Triomphe du Carrousel and the Carrousel garden,
// as a glTF 2.0 binary: public/models/louvre.glb
// Usage: node scripts/build-louvre-glb.mjs
//
// Units are metres. The origin is the centre of the pyramid at ground level; +x is east along the
// palace's long axis (towards the Cour Carrée), +z is south (towards the Seine), +y is up.
// Dimensions follow the real site but are rounded, and sculpture is reduced to simple masses.
import { mkdirSync, writeFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

// ------------------------------------------------------------------ mesh building

/** Triangles for one material. Faces are flat-shaded unless a normal is given per vertex. */
class Bucket {
  constructor(name, color, { metal = 0, rough = 0.9, alpha = 1, emissive } = {}) {
    Object.assign(this, { name, color, metal, rough, alpha, emissive, pos: [], norm: [], idx: [] });
  }
  /** Convex polygon, counter-clockwise seen from outside. */
  poly(pts, normal) {
    const base = this.pos.length / 3;
    let n = normal;
    if (!n) {
      const [a, b, c] = pts;
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(...n) || 1;
      n = n.map((x) => x / l);
    }
    for (const p of pts) {
      this.pos.push(...p);
      this.norm.push(...n);
    }
    for (let i = 1; i + 1 < pts.length; i++) this.idx.push(base, base + i, base + i + 1);
    return this;
  }
  /**
   * Prism between a bottom outline at y0 and a top outline at y1 (same point count, [x, z] pairs,
   * wound like rect() below). Side walls plus optional caps.
   */
  loft(bottom, y0, top, y1, { capTop = true, capBottom = false } = {}) {
    const n = bottom.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = [bottom[i][0], y0, bottom[i][1]];
      const b = [bottom[j][0], y0, bottom[j][1]];
      const c = [top[j][0], y1, top[j][1]];
      const d = [top[i][0], y1, top[i][1]];
      if (Math.hypot(d[0] - c[0], d[2] - c[2]) < 1e-6) this.poly([a, b, d]);
      else this.poly([a, b, c, d]);
    }
    if (capTop) this.poly(top.map(([x, z]) => [x, y1, z]), [0, 1, 0]);
    if (capBottom) this.poly(bottom.map(([x, z]) => [x, y0, z]).reverse(), [0, -1, 0]);
    return this;
  }
  /** Axis-aligned box from (x0, y0, z0) to (x1, y1, z1). */
  box(x0, y0, z0, x1, y1, z1, caps = {}) {
    const r = rect(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1));
    return this.loft(r, y0, r, y1, caps);
  }
  /** Round or polygonal column / cone between two radii. */
  cyl(cx, cz, r0, y0, r1, y1, sides = 12, caps = {}) {
    return this.loft(ngon(cx, cz, r0, sides), y0, ngon(cx, cz, Math.max(r1, 1e-3), sides), y1, caps);
  }
  /** Thin square bar between two points, for glazing bars and railings. */
  bar(a, b, t) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...d);
    const w = d.map((x) => x / len);
    // Two unit vectors perpendicular to the bar.
    const ref = Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u = [w[1] * ref[2] - w[2] * ref[1], w[2] * ref[0] - w[0] * ref[2], w[0] * ref[1] - w[1] * ref[0]];
    const ul = Math.hypot(...u);
    u = u.map((x) => (x / ul) * t * 0.5);
    const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
    const corner = (p, su, sv) => [p[0] + u[0] * su + v[0] * sv, p[1] + u[1] * su + v[1] * sv, p[2] + u[2] * su + v[2] * sv];
    const ring = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (let i = 0; i < 4; i++) {
      const [s0, t0] = ring[i];
      const [s1, t1] = ring[(i + 1) % 4];
      this.poly([corner(a, s0, t0), corner(a, s1, t1), corner(b, s1, t1), corner(b, s0, t0)]);
    }
    return this;
  }
  /** Soft noisy ellipsoid with smooth normals, for tree crowns. */
  blob(cx, cy, cz, rx, ry, rz, seed, segs = 10, bands = 6) {
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
        const f = 1 + wobble(ux * 3, uy * 3, uz * 3);
        this.pos.push(cx + ux * rx * f, cy + uy * ry * f, cz + uz * rz * f);
        const l = Math.hypot(ux / rx, uy / ry, uz / rz) || 1;
        this.norm.push(ux / rx / l, uy / ry / l, uz / rz / l);
      }
    }
    const row = segs + 1;
    for (let b = 0; b < bands; b++)
      for (let i = 0; i < segs; i++) {
        const a = base + b * row + i;
        this.idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
      }
    return this;
  }
}
// Outlines run (x0,z0) → (x0,z1) → (x1,z1) → (x1,z0): with +y up that winds so that walls built
// from them face outwards and caps face up.
const rect = (x0, z0, x1, z1) => [[x0, z0], [x0, z1], [x1, z1], [x1, z0]];
const ngon = (cx, cz, r, n) =>
  Array.from({ length: n }, (_, i) => {
    const a = -(i / n) * Math.PI * 2; // same winding as rect()
    return [cx + r * Math.cos(a), cz + r * Math.sin(a)];
  });
/** Shrink a rectangle outline by d on every side. */
const inset = (x0, z0, x1, z1, d) => rect(x0 + d, z0 + d, x1 - d, z1 - d);

let seed = 20261889;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

// ------------------------------------------------------------------ materials
// Names matter to the viewer: *Plaza_Stone* and *Park_Lawn* get paving and grass textures, *Glass*
// and *Glow* light up at night, *Water*, *Foliage*, *Trunk*, *Curb* stay dark at night.
const M = {
  stone: new Bucket('Louvre_Stone', [0.8, 0.74, 0.62], { rough: 0.88 }), // pale Paris limestone
  stoneTrim: new Bucket('Louvre_Stone_Trim', [0.87, 0.82, 0.71], { rough: 0.82 }), // cornices, pilasters, frames
  stoneShade: new Bucket('Louvre_Stone_Shade', [0.45, 0.4, 0.33], { rough: 0.95 }), // arcade depths and reveals
  slate: new Bucket('Louvre_Roof_Slate', [0.3, 0.34, 0.4], { rough: 0.55, metal: 0.25 }), // zinc and slate roofs
  lead: new Bucket('Louvre_Roof_Lead', [0.52, 0.55, 0.57], { rough: 0.5, metal: 0.4 }), // ridge cresting and dormer caps
  window: new Bucket('Palace_Window_Glass', [0.13, 0.17, 0.22], { rough: 0.15, metal: 0.6 }),
  glass: new Bucket('Pyramid_Glass', [0.72, 0.86, 0.92], { rough: 0.05, metal: 0.1, alpha: 0.3 }),
  steel: new Bucket('Pyramid_Steel', [0.62, 0.65, 0.68], { rough: 0.35, metal: 0.85 }),
  glow: new Bucket('Pyramid_Glow', [0.93, 0.9, 0.82], { rough: 0.6 }), // the lit hall seen through the glass
  granite: new Bucket('Basin_Curb', [0.3, 0.31, 0.33], { rough: 0.5 }),
  water: new Bucket('Basin_Water', [0.2, 0.36, 0.43], { rough: 0.08, metal: 0.3 }),
  paving: new Bucket('Plaza_Stone', [0.66, 0.62, 0.54], { rough: 0.92 }),
  gravel: new Bucket('Plaza_Gravel', [0.74, 0.69, 0.58], { rough: 1 }),
  lawn: new Bucket('Park_Lawn', [0.27, 0.43, 0.17], { rough: 1 }),
  hedge: new Bucket('Park_Foliage_Hedge', [0.14, 0.27, 0.1], { rough: 0.95 }),
  foliage: new Bucket('Park_Foliage', [0.2, 0.36, 0.13], { rough: 0.9 }),
  foliageDark: new Bucket('Park_Foliage_Dark', [0.12, 0.25, 0.09], { rough: 0.95 }),
  foliageLight: new Bucket('Park_Foliage_Light', [0.34, 0.48, 0.16], { rough: 0.85 }),
  trunk: new Bucket('Tree_Trunk', [0.3, 0.23, 0.17], { rough: 0.95 }),
  marble: new Bucket('Arch_Marble_Rose', [0.72, 0.47, 0.42], { rough: 0.4 }), // the Carrousel arch's pink columns
  bronze: new Bucket('Arch_Bronze', [0.2, 0.33, 0.27], { rough: 0.5, metal: 0.7 }), // verdigris statuary
  gilt: new Bucket('Arch_Gilt', [0.86, 0.68, 0.25], { rough: 0.3, metal: 0.9 }),
  iron: new Bucket('Lamp_Iron', [0.12, 0.13, 0.13], { rough: 0.5, metal: 0.6 }),
  lamp: new Bucket('Lamp_Glow', [1, 0.93, 0.75], { rough: 0.2, emissive: [0.5, 0.42, 0.22] }),
};

// ------------------------------------------------------------------ the palace
const GROUND = 0.3; // courtyard paving level
const FLOOR = [GROUND, 9.2, 17.2, 23.2]; // ground floor, piano nobile, attic, cornice
const EAVES = FLOOR[3];
const BAY = 6.2; // spacing of windows along a façade

/**
 * One façade: a vertical strip of wall from (ax, az) to (bx, bz) decorated on the side given by the
 * outward normal (nx, nz). Draws, for each bay, an arcade arch, a tall first-floor window with a
 * pediment and a square attic window, separated by pilasters and tied together by string courses.
 */
function facade(ax, az, bx, bz, nx, nz, { height = EAVES, arcade = true, y0 = GROUND } = {}) {
  const len = Math.hypot(bx - ax, bz - az);
  const tx = (bx - ax) / len;
  const tz = (bz - az) / len;
  // Point at distance s along the façade, height y, pushed out from the wall by o.
  const P = (s, y, o) => [ax + tx * s + nx * o, y, az + tz * s + nz * o];
  // Upright rectangle from s0..s1, y0..y1 at offset o, facing outwards.
  const panel = (bucket, s0, s1, ya, yb, o) => bucket.poly([P(s0, ya, o), P(s1, ya, o), P(s1, yb, o), P(s0, yb, o)], [nx, 0, nz]);
  // Box standing proud of the wall by `out`: its front and the four thin sides.
  const relief = (bucket, s0, s1, ya, yb, out) => {
    panel(bucket, s0, s1, ya, yb, out);
    bucket.poly([P(s0, yb, 0), P(s0, yb, out), P(s1, yb, out), P(s1, yb, 0)], [0, 1, 0]); // top
    bucket.poly([P(s0, ya, out), P(s0, ya, 0), P(s1, ya, 0), P(s1, ya, out)], [0, -1, 0]); // underside
    bucket.poly([P(s0, ya, 0), P(s0, ya, out), P(s0, yb, out), P(s0, yb, 0)], [-tx, 0, -tz]);
    bucket.poly([P(s1, ya, out), P(s1, ya, 0), P(s1, yb, 0), P(s1, yb, out)], [tx, 0, tz]);
  };
  const scale = (height - y0) / (EAVES - GROUND);
  const Y = (y) => y0 + (y - GROUND) * scale;

  // Continuous horizontal elements.
  relief(M.stoneTrim, 0, len, Y(GROUND), Y(GROUND + 1.1), 0.35); // plinth
  relief(M.stoneTrim, 0, len, Y(FLOOR[1] - 0.7), Y(FLOOR[1]), 0.5); // string course over the arcade
  relief(M.stoneTrim, 0, len, Y(FLOOR[2] - 0.45), Y(FLOOR[2]), 0.35);
  relief(M.stoneTrim, 0, len, Y(EAVES - 1.0), Y(EAVES - 0.35), 0.55); // cornice
  relief(M.stoneTrim, 0, len, Y(EAVES - 0.35), Y(EAVES), 0.85);
  // Balustrade along the roof edge.
  relief(M.stoneTrim, 0, len, Y(EAVES), Y(EAVES) + 0.25, 0.6);
  relief(M.stoneTrim, 0, len, Y(EAVES) + 1.05, Y(EAVES) + 1.3, 0.6);

  const bays = Math.max(1, Math.round(len / BAY));
  const w = len / bays;
  for (let i = 0; i <= bays; i++) {
    // Pilaster on every bay line, with a simple capital; balustrade post above it.
    const s = i * w;
    const half = Math.min(0.55, w * 0.1);
    const s0 = Math.max(0, s - half);
    const s1 = Math.min(len, s + half);
    relief(M.stoneTrim, s0, s1, Y(GROUND + 1.1), Y(FLOOR[1] - 0.7), 0.3);
    relief(M.stoneTrim, s0, s1, Y(FLOOR[1]), Y(EAVES - 1.0), 0.28);
    relief(M.stoneTrim, Math.max(0, s0 - 0.12), Math.min(len, s1 + 0.12), Y(FLOOR[2] - 1.1), Y(FLOOR[2] - 0.45), 0.4);
    relief(M.stoneTrim, s0, s1, Y(EAVES) + 0.25, Y(EAVES) + 1.05, 0.55);
  }
  for (let i = 0; i < bays; i++) {
    const c = (i + 0.5) * w;
    const ww = Math.min(1.5, w * 0.27); // half-width of openings
    if (arcade) {
      // Round-headed arch: a dark recess with a keystone.
      const top = Y(FLOOR[1] - 2.2);
      const spring = top - ww;
      panel(M.stoneShade, c - ww, c + ww, Y(GROUND + 0.25), spring, 0.04);
      const fan = [P(c + ww, spring, 0.04)];
      for (let k = 1; k <= 7; k++) {
        const a = (k / 8) * Math.PI;
        fan.push(P(c + Math.cos(a) * ww, spring + Math.sin(a) * ww, 0.04));
      }
      fan.push(P(c - ww, spring, 0.04));
      M.stoneShade.poly(fan, [nx, 0, nz]);
      relief(M.stoneTrim, c - 0.28, c + 0.28, top - 0.25, top + 0.75, 0.42);
      panel(M.window, c - ww * 0.72, c + ww * 0.72, Y(GROUND + 1.0), spring - 0.3, 0.07);
    } else {
      panel(M.window, c - ww, c + ww, Y(GROUND + 2.2), Y(FLOOR[1] - 2.4), 0.05);
      relief(M.stoneTrim, c - ww - 0.3, c + ww + 0.3, Y(GROUND + 1.9), Y(GROUND + 2.2), 0.3);
      relief(M.stoneTrim, c - ww - 0.3, c + ww + 0.3, Y(FLOOR[1] - 2.4), Y(FLOOR[1] - 2.05), 0.35);
    }
    // First floor: tall window, sill, and a pediment that alternates triangular / flat.
    const a0 = Y(FLOOR[1] + 1.1);
    const a1 = Y(FLOOR[2] - 2.3);
    panel(M.window, c - ww, c + ww, a0, a1, 0.05);
    panel(M.stoneTrim, c - 0.07, c + 0.07, a0, a1, 0.09); // mullion
    panel(M.stoneTrim, c - ww, c + ww, a0 + (a1 - a0) * 0.62, a0 + (a1 - a0) * 0.62 + 0.14, 0.09); // transom
    relief(M.stoneTrim, c - ww - 0.35, c + ww + 0.35, a0 - 0.32, a0, 0.4);
    relief(M.stoneTrim, c - ww - 0.3, c - ww, a0, a1, 0.2);
    relief(M.stoneTrim, c + ww, c + ww + 0.3, a0, a1, 0.2);
    relief(M.stoneTrim, c - ww - 0.45, c + ww + 0.45, a1, a1 + 0.3, 0.45);
    if (i % 2 === 0) {
      const apex = a1 + 0.3 + ww * 0.55;
      M.stoneTrim.poly([P(c - ww - 0.45, a1 + 0.3, 0.45), P(c + ww + 0.45, a1 + 0.3, 0.45), P(c, apex, 0.45)], [nx, 0, nz]);
      M.stoneTrim.poly([P(c - ww - 0.45, a1 + 0.3, 0), P(c - ww - 0.45, a1 + 0.3, 0.45), P(c, apex, 0.45), P(c, apex, 0)]);
      M.stoneTrim.poly([P(c + ww + 0.45, a1 + 0.3, 0.45), P(c + ww + 0.45, a1 + 0.3, 0), P(c, apex, 0), P(c, apex, 0.45)]);
    }
    // Attic: square window with a frame.
    const b0 = Y(FLOOR[2] + 1.0);
    const b1 = Y(EAVES - 1.6);
    panel(M.window, c - ww * 0.8, c + ww * 0.8, b0, b1, 0.05);
    relief(M.stoneTrim, c - ww * 0.8 - 0.25, c + ww * 0.8 + 0.25, b0 - 0.25, b0, 0.3);
    relief(M.stoneTrim, c - ww * 0.8 - 0.25, c + ww * 0.8 + 0.25, b1, b1 + 0.25, 0.3);
  }
}

/** Dormer window sitting on a roof slope, facing along (nx, nz), centred at (x, z) on the eaves line. */
function dormer(x, z, nx, nz, y) {
  const tx = -nz;
  const tz = nx;
  const P = (s, h, o) => [x + tx * s - nx * o, y + h, z + tz * s - nz * o];
  const front = [P(-0.9, 0.6, 1.2), P(0.9, 0.6, 1.2), P(0.9, 2.6, 1.2), P(0, 3.3, 1.2), P(-0.9, 2.6, 1.2)];
  M.stoneTrim.poly(front, [nx, 0, nz]);
  M.window.poly([P(-0.55, 0.9, 1.14), P(0.55, 0.9, 1.14), P(0.55, 2.4, 1.14), P(-0.55, 2.4, 1.14)], [nx, 0, nz]);
  // Cheeks and the little pitched roof running back into the slope.
  M.stoneTrim.poly([P(-0.9, 0.6, 1.2), P(-0.9, 2.6, 1.2), P(-0.9, 2.6, 3.4)]);
  M.stoneTrim.poly([P(0.9, 2.6, 1.2), P(0.9, 0.6, 1.2), P(0.9, 2.6, 3.4)]);
  M.lead.poly([P(-0.9, 2.6, 1.2), P(0, 3.3, 1.2), P(0, 3.3, 4.2), P(-0.9, 2.6, 3.4)]);
  M.lead.poly([P(0, 3.3, 1.2), P(0.9, 2.6, 1.2), P(0.9, 2.6, 3.4), P(0, 3.3, 4.2)]);
}

/**
 * A range of the palace: a long building between (x0, z0) and (x1, z1) with façades on all four
 * sides (or only those listed), a mansard roof with dormers, a lead ridge and chimneys.
 */
function wing(x0, z0, x1, z1, { sides = 'nsew', arcade = 'nsew', height = EAVES, roof = 7.5 } = {}) {
  M.stone.box(x0, 0, z0, x1, height, z1, { capTop: false });
  const fac = (side, ...args) => sides.includes(side) && facade(...args, { height, arcade: arcade.includes(side) });
  fac('n', x1, z0, x0, z0, 0, -1);
  fac('s', x0, z1, x1, z1, 0, 1);
  fac('w', x0, z0, x0, z1, -1, 0);
  fac('e', x1, z1, x1, z0, 1, 0);
  // Mansard: steep lower slope, then a shallow cap.
  const d1 = 2.2;
  const d2 = Math.min(5.5, (Math.min(x1 - x0, z1 - z0) / 2) * 0.8);
  M.stone.box(x0, height, z0, x1, height + 0.02, z1); // gutter level behind the balustrade
  M.slate.loft(inset(x0, z0, x1, z1, 0.9), height, inset(x0, z0, x1, z1, 0.9 + d1), height + roof * 0.72, { capTop: false });
  M.slate.loft(inset(x0, z0, x1, z1, 0.9 + d1), height + roof * 0.72, inset(x0, z0, x1, z1, 0.9 + d2), height + roof);
  M.lead.loft(inset(x0, z0, x1, z1, 0.6 + d2), height + roof, inset(x0, z0, x1, z1, 0.9 + d2), height + roof + 0.5);
  const long = x1 - x0 > z1 - z0;
  const length = long ? x1 - x0 : z1 - z0;
  const count = Math.max(1, Math.round(length / (BAY * 2)));
  for (let i = 0; i < count; i++) {
    const s = ((i + 0.5) / count) * length;
    if (long) {
      if (sides.includes('n')) dormer(x0 + s, z0 + 0.9, 0, -1, height);
      if (sides.includes('s')) dormer(x0 + s, z1 - 0.9, 0, 1, height);
    } else {
      if (sides.includes('w')) dormer(x0 + 0.9, z0 + s, -1, 0, height);
      if (sides.includes('e')) dormer(x1 - 0.9, z0 + s, 1, 0, height);
    }
    if (i % 3 === 1) {
      // Chimney stack on the ridge.
      const cx = long ? x0 + s + BAY : (x0 + x1) / 2;
      const cz = long ? (z0 + z1) / 2 : z0 + s + BAY;
      M.stoneTrim.box(cx - 0.9, height + roof - 0.5, cz - 0.6, cx + 0.9, height + roof + 2.6, cz + 0.6);
      M.stoneShade.box(cx - 1.05, height + roof + 2.6, cz - 0.75, cx + 1.05, height + roof + 2.9, cz + 0.75);
    }
  }
}

/**
 * A pavilion: a taller block that punctuates the wings, with a steep square dome and a lantern.
 * `out` pushes it forward of the wing line on the listed sides so it reads as a projection.
 */
function pavilion(cx, cz, w, d, { height = 31, dome = 13, sides = 'nsew', clock = false } = {}) {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  M.stone.box(x0, 0, z0, x1, height, z1, { capTop: false });
  const fac = (side, ...args) => sides.includes(side) && facade(...args, { height, arcade: true });
  fac('n', x1, z0, x0, z0, 0, -1);
  fac('s', x0, z1, x1, z1, 0, 1);
  fac('w', x0, z0, x0, z1, -1, 0);
  fac('e', x1, z1, x1, z0, 1, 0);
  // Corner piers to make the block read as heavier than the wings.
  for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) M.stoneTrim.box(px - 0.7, 0, pz - 0.7, px + 0.7, height + 1.3, pz + 0.7);
  // Square dome: four curved slopes built from stacked rings.
  M.stone.box(x0, height, z0, x1, height + 0.02, z1);
  const rings = 6;
  let prev = inset(x0, z0, x1, z1, 1.0);
  let prevY = height;
  for (let k = 1; k <= rings; k++) {
    const t = k / rings;
    const shrink = 1.0 + (Math.min(w, d) / 2 - 3.2) * (1 - Math.cos((t * Math.PI) / 2));
    const y = height + dome * Math.sin((t * Math.PI) / 2);
    const next = inset(x0, z0, x1, z1, shrink);
    M.slate.loft(prev, prevY, next, y, { capTop: k === rings });
    prev = next;
    prevY = y;
  }
  // Lantern and cresting.
  M.lead.loft(inset(x0, z0, x1, z1, Math.min(w, d) / 2 - 2.6), prevY, inset(x0, z0, x1, z1, Math.min(w, d) / 2 - 2.2), prevY + 1.6);
  M.lead.cyl(cx, cz, 0.5, prevY + 1.6, 0.05, prevY + 5.5, 6);
  // Round "oeil-de-boeuf" windows in the dome.
  for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const side = nx ? (nx < 0 ? 'w' : 'e') : nz < 0 ? 'n' : 's';
    if (!sides.includes(side)) continue;
    dormer(cx + nx * (w / 2 - 1.0), cz + nz * (d / 2 - 1.0), nx, nz, height + 0.4);
  }
  if (clock) {
    // The Pavillon de l'Horloge's clock on its west face.
    const y = height - 4.5;
    const face = Array.from({ length: 16 }, (_, k) => {
      const a = (k / 16) * Math.PI * 2;
      return [x0 - 0.62, y + Math.sin(a) * 1.9, cz + Math.cos(a) * 1.9];
    });
    M.gilt.poly(face, [-1, 0, 0]);
    M.stoneTrim.box(x0 - 0.6, y - 2.6, cz - 2.6, x0, y + 2.6, cz + 2.6);
  }
}

// ---- Layout (metres) ---------------------------------------------------------------------------
const COURT_HALF = 62; // half-width of the Cour Napoléon (north-south)
const DEPTH = 22; // thickness of a range
const OUTER = 128; // distance of the outer ranges (rue de Rivoli / the Seine) from the axis
const WEST = -128; // west end of the Cour Napoléon wings
const EAST = 112; // west face of the Cour Carrée block
const CARRE = 172; // outer size of the Cour Carrée
const FAR_WEST = -470; // Pavillons de Marsan and de Flore

// Cour Napoléon: inner ranges facing the pyramid (Richelieu to the north, Denon to the south).
for (const s of [-1, 1]) {
  const zi = s * COURT_HALF; // façade on the courtyard
  const zo = s * (COURT_HALF + DEPTH);
  wing(WEST + 16, Math.min(zi, zo), EAST, Math.max(zi, zo), { sides: 'ns' });
  // Outer range along the street / the river, running the whole length of the palace.
  const oi = s * (OUTER - DEPTH);
  const oo = s * OUTER;
  wing(FAR_WEST + 16, Math.min(oi, oo), EAST + CARRE, Math.max(oi, oo), { sides: 'ns', arcade: s < 0 ? 'n' : '' });
  // Cross ranges closing the three inner courts on each side.
  for (const x of [WEST + 16, -52, 28, EAST - DEPTH]) {
    wing(x, Math.min(zo, oi), x + DEPTH, Math.max(zo, oi), { sides: 'ew', arcade: '' });
  }
  // Pavilions: ends and centres of the courtyard ranges (Turgot/Richelieu/Colbert, Mollien/Denon/Daru).
  pavilion(WEST + 8, s * (COURT_HALF + DEPTH / 2 + 4), 30, DEPTH + 14, { sides: 'nsw' });
  pavilion(-8, s * (COURT_HALF + DEPTH / 2 - 1.5), 34, DEPTH + 3, { height: 33, dome: 14, sides: s < 0 ? 's' : 'n' });
  pavilion(EAST - 26, s * (COURT_HALF + DEPTH / 2 - 1.5), 26, DEPTH + 3, { sides: s < 0 ? 's' : 'n' });
  // Far-west end pavilions (Marsan to the north, Flore to the south) and mid-length ones.
  pavilion(FAR_WEST + 4, s * (OUTER - DEPTH / 2 - 4), 34, DEPTH + 14, { height: 33, dome: 15 });
  pavilion(-300, s * (OUTER - DEPTH / 2), 28, DEPTH + 5, { sides: 'ns' });
  pavilion(WEST + 8, s * (OUTER - DEPTH / 2), 28, DEPTH + 5, { sides: 'ns' });
}

// Cour Carrée: a square of four ranges around a court, east of the Cour Napoléon.
{
  const x0 = EAST, x1 = EAST + CARRE, h = CARRE / 2;
  wing(x0, -h + DEPTH, x0 + DEPTH, h - DEPTH, { sides: 'ew' }); // west range (Sully)
  wing(x1 - DEPTH, -h + DEPTH, x1, h - DEPTH, { sides: 'ew' }); // east range (the Colonnade side)
  wing(x0, -h, x1, -h + DEPTH, { sides: 'ns' });
  wing(x0, h - DEPTH, x1, h, { sides: 'ns' });
  // Link the square to the outer ranges, which sit further out than the Cour Carrée's own.
  for (const s of [-1, 1]) wing(x0, Math.min(s * h, s * (OUTER - DEPTH)), x0 + DEPTH, Math.max(s * h, s * (OUTER - DEPTH)), { sides: 'ew', arcade: '' });
  // Pavillon de l'Horloge facing the pyramid, the matching east pavilion, and the centres of the other sides.
  pavilion(x0 + DEPTH / 2, 0, DEPTH + 6, 36, { height: 36, dome: 16, clock: true });
  pavilion(x1 - DEPTH / 2, 0, DEPTH + 6, 32, { height: 33, dome: 13 });
  pavilion((x0 + x1) / 2, -h + DEPTH / 2, 30, DEPTH + 5, { sides: 'ns' });
  pavilion((x0 + x1) / 2, h - DEPTH / 2, 30, DEPTH + 5, { sides: 'ns' });
  for (const [sx, sz] of [[0, -1], [1, -1], [0, 1], [1, 1]]) pavilion(sx ? x1 - DEPTH / 2 : x0 + DEPTH / 2, sz * (h - DEPTH / 2), DEPTH + 5, DEPTH + 5);
  // The court itself: paving, a round lawn and a fountain basin.
  const cx = (x0 + x1) / 2;
  M.gravel.box(x0 + DEPTH, 0, -h + DEPTH, x1 - DEPTH, GROUND, h - DEPTH);
  M.granite.cyl(cx, 0, 13, GROUND, 13, GROUND + 0.55, 32);
  M.water.cyl(cx, 0, 12.2, GROUND + 0.55, 12.2, GROUND + 0.6, 32);
  M.stoneTrim.cyl(cx, 0, 1.6, GROUND + 0.6, 1.0, GROUND + 2.4, 12);
  M.stoneTrim.cyl(cx, 0, 2.6, GROUND + 2.4, 2.0, GROUND + 2.8, 16);
}

// ------------------------------------------------------------------ Cour Napoléon and the pyramid
M.paving.box(WEST - 40, 0, -COURT_HALF, EAST, GROUND, COURT_HALF);

/** Glass pyramid with its diamond lattice. `half` is half the base, `h` the height. */
function pyramid(cx, cz, half, h, divisions, barSize, door = false) {
  const y = GROUND + 0.35;
  const apex = [cx, y + h, cz];
  const corners = [[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([sx, sz]) => [cx + sx * half, y, cz + sz * half]);
  M.granite.box(cx - half - 0.5, GROUND, cz - half - 0.5, cx + half + 0.5, y, cz + half + 0.5);
  M.glow.box(cx - half + 0.6, y, cz - half + 0.6, cx + half - 0.6, y + 0.05, cz + half - 0.6);
  const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  for (let f = 0; f < 4; f++) {
    const b = corners[f];
    const c = corners[(f + 1) % 4];
    M.glass.poly([b, c, apex]);
    M.steel.bar(b, apex, barSize * 2.2); // hip
    M.steel.bar(b, c, barSize * 2.2); // base rail
    for (let i = 1; i < divisions; i++) {
      const t = i / divisions;
      // Bars parallel to each sloping edge, which together make the diamond panes.
      M.steel.bar(lerp(b, c, t), lerp(apex, c, t), barSize);
      M.steel.bar(lerp(c, b, t), lerp(apex, b, t), barSize);
    }
  }
  if (door) {
    // Entrance on the west face: a steel portal frame.
    const x = cx - half * 0.86;
    M.steel.box(x - 1.2, y, cz - 2.6, x + 0.4, y + 3.0, cz - 2.3);
    M.steel.box(x - 1.2, y, cz + 2.3, x + 0.4, y + 3.0, cz + 2.6);
    M.steel.box(x - 1.2, y + 3.0, cz - 2.6, x + 0.4, y + 3.3, cz + 2.6);
  }
}
pyramid(0, 0, 17.7, 21.6, 18, 0.14, true);
for (const [x, z] of [[0, -40], [0, 40], [44, 0]]) pyramid(x, z, 4, 4.9, 5, 0.09);

// Triangular basins of dark granite around the pyramid, each brim-full of water. Pairs of them
// flank the three small pyramids, their long sides forming a V that points at each one.
{
  const basin = (pts) => {
    // Put the outline in this file's winding (see rect()).
    const [a, b, c] = pts;
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) > 0) pts = [a, c, b];
    const mid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
    const shrink = (k) => pts.map((p) => [mid[0] + (p[0] - mid[0]) * k, mid[1] + (p[1] - mid[1]) * k]);
    M.granite.loft(pts, GROUND, pts, GROUND + 0.6);
    M.water.loft(shrink(0.93), GROUND + 0.6, shrink(0.93), GROUND + 0.63);
  };
  for (const s of [-1, 1]) {
    basin([[-26, s * 24], [-5, s * 24], [-26, s * 50]]); // north and south pairs
    basin([[26, s * 24], [5, s * 24], [26, s * 50]]);
    basin([[30, s * 20], [30, s * 4], [52, s * 20]]); // east pair
  }
}
// Fountain jets in the basins (a low cluster of pale cones).
for (const [x, z] of [[-19, -32], [19, -32], [-19, 32], [19, 32], [37, -14], [37, 14]]) {
  for (let k = 0; k < 5; k++) M.water.cyl(x + (k - 2) * 1.3, z, 0.1, GROUND + 0.63, 0.02, GROUND + 1.5 + (k % 2) * 0.5, 5);
}

// Lamp standards around the courtyard.
function lampPost(x, z) {
  M.iron.cyl(x, z, 0.28, GROUND, 0.16, GROUND + 0.9, 8);
  M.iron.cyl(x, z, 0.09, GROUND + 0.9, 0.07, GROUND + 5.2, 6);
  M.iron.cyl(x, z, 0.3, GROUND + 5.2, 0.34, GROUND + 5.35, 6);
  M.lamp.cyl(x, z, 0.26, GROUND + 5.35, 0.3, GROUND + 5.95, 6);
  M.iron.cyl(x, z, 0.34, GROUND + 5.95, 0.02, GROUND + 6.35, 6);
}
for (let x = WEST + 30; x <= EAST - 14; x += 26) for (const s of [-1, 1]) lampPost(x, s * (COURT_HALF - 7));
for (const z of [-30, 0, 30]) lampPost(EAST - 9, z);

// ------------------------------------------------------------------ Carrousel garden and arch
function tree(x, z, h = 12, r = 4.6) {
  h *= 0.85 + rnd() * 0.35;
  r *= 0.85 + rnd() * 0.3;
  const y = GROUND;
  M.trunk.cyl(x, z, 0.5, y, 0.3, y + h * 0.45, 7);
  const cy = y + h * 0.68;
  M.foliageDark.blob(x, cy - r * 0.1, z, r * 0.8, r * 0.7, r * 0.8, rnd() * 50);
  const lobes = 5 + Math.floor(rnd() * 2);
  const a0 = rnd() * 6.28;
  for (let k = 0; k < lobes; k++) {
    const a = a0 + (k / lobes) * 6.28;
    const rr = r * (0.5 + rnd() * 0.18);
    const sunny = -Math.cos(a) * 0.8 + Math.sin(a) * 0.55 > 0.25;
    (sunny ? M.foliageLight : M.foliage).blob(x + Math.cos(a) * r * 0.55, cy + (rnd() - 0.4) * r * 0.4, z + Math.sin(a) * r * 0.55, rr, rr * 0.85, rr, rnd() * 50, 9, 5);
  }
  M.foliage.blob(x, cy + r * 0.45, z, r * 0.6, r * 0.48, r * 0.6, rnd() * 50, 9, 5);
}
{
  const x0 = FAR_WEST - 30, x1 = WEST - 40, zi = OUTER - DEPTH;
  M.gravel.box(x0, 0, -zi, x1, GROUND - 0.05, zi);
  // Radiating hedged lawns (simplified to a fan of wedges) west of the arch, and plain lawns beside it.
  const ARCH_X = -262;
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const za = s * (10 + k * 23);
      const zb = s * (28 + k * 23);
      const z0 = Math.min(za, zb), z1 = Math.max(za, zb);
      M.lawn.box(x0 + 18, GROUND - 0.05, z0, ARCH_X - 32, GROUND + 0.1, z1);
      M.hedge.box(x0 + 18, GROUND + 0.1, z0, ARCH_X - 32, GROUND + 1.5, z0 + 1.6);
      M.hedge.box(x0 + 18, GROUND + 0.1, z1 - 1.6, ARCH_X - 32, GROUND + 1.5, z1);
      M.lawn.box(ARCH_X + 34, GROUND - 0.05, z0, x1 - 8, GROUND + 0.1, z1);
    }
    for (let x = x0 + 30; x < x1 - 10; x += 21) tree(x + (rnd() - 0.5) * 3, s * (zi - 9));
    for (let x = x0 + 40; x < ARCH_X - 40; x += 34) tree(x, s * 52, 10, 3.8);
  }

  // Arc de Triomphe du Carrousel: three arches, eight rose marble columns, a bronze quadriga.
  const AW = 23, AD = 7.3, AH = 14.6; // width (north-south), depth (east-west), height to the attic top
  const ax0 = ARCH_X - AD / 2, ax1 = ARCH_X + AD / 2;
  const base = GROUND;
  for (const [za, zb] of [[-AW / 2, -8.2], [-4.9, -3.3], [3.3, 4.9], [8.2, AW / 2]]) M.stone.box(ax0, base, za, ax1, base + 9.4, zb);
  // Arch heads: fill above the side arches (lower) and the central arch (taller), then the entablature and attic.
  M.stone.box(ax0, base + 6.4, -8.2, ax1, base + 9.4, -4.9);
  M.stone.box(ax0, base + 6.4, 4.9, ax1, base + 9.4, 8.2);
  M.stone.box(ax0, base + 8.6, -3.3, ax1, base + 9.4, 3.3);
  M.stoneTrim.box(ax0 - 0.5, base + 9.4, -AW / 2 - 0.5, ax1 + 0.5, base + 10.5, AW / 2 + 0.5);
  M.stone.box(ax0 + 0.2, base + 10.5, -AW / 2 + 0.3, ax1 - 0.2, base + AH, AW / 2 - 0.3);
  M.stoneTrim.box(ax0 - 0.2, base + AH, -AW / 2 - 0.1, ax1 + 0.2, base + AH + 0.5, AW / 2 + 0.1);
  for (const face of [-1, 1]) {
    const x = face < 0 ? ax0 : ax1;
    for (const z of [-AW / 2 + 0.9, -4.1, 4.1, AW / 2 - 0.9]) {
      // Column on a pedestal carrying a statue of a soldier of the Grande Armée.
      M.stoneTrim.box(x + face * 0.2, base, z - 0.75, x + face * 1.7, base + 2.3, z + 0.75);
      M.marble.cyl(x + face * 0.95, z, 0.43, base + 2.3, 0.38, base + 8.6, 12, { capTop: false });
      M.gilt.cyl(x + face * 0.95, z, 0.5, base + 8.6, 0.62, base + 9.4, 12);
      M.stoneTrim.box(x + face * 0.2, base + 10.5, z - 0.6, x + face * 1.5, base + 11.0, z + 0.6);
      M.stoneTrim.cyl(x + face * 0.9, z, 0.42, base + 11.0, 0.3, base + 13.3, 6);
    }
    // Bas-relief panels above the side arches.
    M.marble.box(x + face * 0.02, base + 10.9, -8.0, x + face * 0.14, base + 13.9, -5.1);
    M.marble.box(x + face * 0.02, base + 10.9, 5.1, x + face * 0.14, base + 13.9, 8.0);
  }
  // Quadriga: chariot, four horses and two flanking figures, as simple bronze and gilt masses.
  const top = base + AH + 0.5;
  M.bronze.box(ARCH_X - 1.6, top, -1.2, ARCH_X + 0.6, top + 1.5, 1.2);
  for (const z of [-2.7, -0.9, 0.9, 2.7]) {
    M.bronze.box(ARCH_X + 0.8, top + 0.9, z - 0.35, ARCH_X + 3.0, top + 2.0, z + 0.35);
    M.bronze.box(ARCH_X + 2.6, top + 1.8, z - 0.25, ARCH_X + 3.4, top + 3.0, z + 0.25);
    for (const lx of [1.0, 2.7]) M.bronze.box(ARCH_X + lx, top, z - 0.15, ARCH_X + lx + 0.3, top + 0.9, z + 0.15);
  }
  M.bronze.cyl(ARCH_X - 0.5, 0, 0.45, top + 1.5, 0.3, top + 3.6, 6);
  for (const z of [-5.2, 5.2]) M.gilt.cyl(ARCH_X + 1.2, z, 0.45, top, 0.25, top + 3.2, 6);
}

// Aprons outside the palace so the ground reads as quay and street rather than bare earth.
M.paving.box(FAR_WEST - 30, 0, -OUTER - 26, EAST + CARRE + 30, GROUND - 0.1, -OUTER); // rue de Rivoli side
M.paving.box(FAR_WEST - 30, 0, OUTER, EAST + CARRE + 30, GROUND - 0.1, OUTER + 22); // quai
M.paving.box(EAST + CARRE, 0, -OUTER, EAST + CARRE + 30, GROUND - 0.1, OUTER); // place du Louvre
for (let x = FAR_WEST; x < EAST + CARRE + 20; x += 24) tree(x + (rnd() - 0.5) * 4, OUTER + 14, 11, 4.2);
// Inner courts of the Richelieu and Denon wings.
for (const s of [-1, 1]) {
  const za = s * (COURT_HALF + DEPTH), zb = s * (OUTER - DEPTH);
  M.gravel.box(WEST + 16, 0, Math.min(za, zb), EAST, GROUND - 0.05, Math.max(za, zb));
}

// ------------------------------------------------------------------ write the file
const doc = new Document();
doc.getRoot().getAsset().generator = 'Paris vivant Louvre 3D builder (CC0)';
const buffer = doc.createBuffer();
const scene = doc.createScene('Musee_du_Louvre');
let tris = 0;
let verts = 0;
for (const b of Object.values(M)) {
  if (!b.idx.length) continue;
  const material = doc.createMaterial(b.name)
    .setBaseColorFactor([...b.color, b.alpha])
    .setMetallicFactor(b.metal)
    .setRoughnessFactor(b.rough);
  if (b.alpha < 1) material.setAlphaMode('BLEND').setDoubleSided(true);
  if (b.emissive) material.setEmissiveFactor(b.emissive);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(b.pos)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(b.norm)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(b.idx)).setBuffer(buffer))
    .setMaterial(material);
  scene.addChild(doc.createNode(b.name).setMesh(doc.createMesh(b.name).addPrimitive(prim)));
  tris += b.idx.length / 3;
  verts += b.pos.length / 3;
}
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await doc.transform(weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 10 }));
const dir = new URL('../public/models/', import.meta.url);
mkdirSync(dir, { recursive: true });
const glb = await io.writeBinary(doc);
writeFileSync(new URL('louvre.glb', dir), glb);
console.log(`wrote public/models/louvre.glb: ${(glb.byteLength / 1e6).toFixed(2)} MB — ${Object.values(M).filter((b) => b.idx.length).length} materials, ${verts.toLocaleString()} vertices, ${tris.toLocaleString()} triangles`);
