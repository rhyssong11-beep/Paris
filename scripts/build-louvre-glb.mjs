// Generates the Louvre: the glass pyramid and its basins in the Cour Napoléon, the palace wings with
// their pavilions, the Cour Carrée, the Arc de Triomphe du Carrousel and the Carrousel garden,
// as a glTF 2.0 binary: public/models/louvre.glb
// Usage: node scripts/build-louvre-glb.mjs [--dump <dir>]
//
// The palace itself comes from scripts/louvre/palace.mjs as a few modules (a façade bay, a chimney,
// a domed pavilion) that the file repeats with GPU instancing, so the detail costs little to download.
// --dump also writes every triangle in world space for scripts/louvre/pathtrace.mjs.
//
// Units are metres. The origin is the centre of the pyramid at ground level; +x is east along the
// palace's long axis (towards the Cour Carrée), +z is south (towards the Seine), +y is up.
// Dimensions follow the real site but are rounded, the palace is squared to the east-west axis, and
// sculpture is reduced to simple masses.
import { mkdirSync, writeFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshGPUInstancing, EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { buildPalace, expandPalace, PALACE_MATERIALS } from './louvre/palace.mjs';
import { encodePng, makeTextures } from './louvre/textures.mjs';
import { bakeOcclusion, buildBvh } from './louvre/bvh.mjs';

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
  stone: new Bucket('Arch_Stone', [0.6, 0.5, 0.35], { rough: 0.9 }), // the Carrousel arch's limestone
  stoneTrim: new Bucket('Arch_Stone_Trim', [0.66, 0.56, 0.4], { rough: 0.86 }),
  courtGlass: new Bucket('Court_Roof_Glass', [0.62, 0.76, 0.82], { rough: 0.08, metal: 0.1, alpha: 0.5 }),
  glass: new Bucket('Pyramid_Glass', [0.72, 0.86, 0.92], { rough: 0.05, metal: 0.1, alpha: 0.3 }),
  steel: new Bucket('Pyramid_Steel', [0.62, 0.65, 0.68], { rough: 0.35, metal: 0.85 }),
  glow: new Bucket('Pyramid_Glow', [0.42, 0.37, 0.29], { rough: 0.6 }), // the hall's floor, lit from within at night
  hallWall: new Bucket('Hall_Stone', [0.56, 0.49, 0.37], { rough: 0.85 }), // Burgundy limestone of the Hall Napoléon
  hallCeiling: new Bucket('Hall_Ceiling_Stone', [0.4, 0.37, 0.31], { rough: 0.9 }),
  hallSteel: new Bucket('Hall_Stair_Steel', [0.34, 0.36, 0.38], { rough: 0.45, metal: 0.6 }),
  hallShade: new Bucket('Hall_Passage_Shade', [0.06, 0.055, 0.05], { rough: 0.9 }),
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

// ---- Layout (metres) ---------------------------------------------------------------------------
const COURT_HALF = 62; // half-width of the Cour Napoléon (north-south)
const DEPTH = 22; // thickness of a range
const OUTER = 128; // distance of the outer ranges (rue de Rivoli / the Seine) from the axis
const WEST = -128; // west end of the Cour Napoléon wings
const EAST = 112; // west face of the Cour Carrée block
const CARRE = 172; // outer size of the Cour Carrée
const FAR_WEST = -470; // Pavillons de Marsan and de Flore

// Cour Carrée: a square of four ranges around a court, east of the Cour Napoléon.
{
  const x0 = EAST, x1 = EAST + CARRE, h = CARRE / 2;
  // The court itself: paving, a round lawn and a fountain basin.
  const cx = (x0 + x1) / 2;
  M.gravel.box(x0 + DEPTH, 0, -h + DEPTH, x1 - DEPTH, GROUND, h - DEPTH);
  M.granite.cyl(cx, 0, 13, GROUND, 13, GROUND + 0.55, 32);
  M.water.cyl(cx, 0, 12.2, GROUND + 0.55, 12.2, GROUND + 0.6, 32);
  M.stoneTrim.cyl(cx, 0, 1.6, GROUND + 0.6, 1.0, GROUND + 2.4, 12);
  M.stoneTrim.cyl(cx, 0, 2.6, GROUND + 2.4, 2.0, GROUND + 2.8, 16);
}

// ------------------------------------------------------------------ Cour Napoléon and the pyramid
const HALL_OPENING = 17.1; // the paving is open under the main pyramid, over the Hall Napoléon
M.paving.box(WEST - 40, 0, -COURT_HALF, -HALL_OPENING, GROUND, COURT_HALF);
M.paving.box(HALL_OPENING, 0, -COURT_HALF, EAST, GROUND, COURT_HALF);
M.paving.box(-HALL_OPENING, 0, -COURT_HALF, HALL_OPENING, GROUND, -HALL_OPENING);
M.paving.box(-HALL_OPENING, 0, HALL_OPENING, HALL_OPENING, GROUND, COURT_HALF);

/** Glass pyramid with its diamond lattice. `half` is half the base, `h` the height. */
function pyramid(cx, cz, half, h, divisions, barSize, door = false) {
  const y = GROUND + 0.35;
  const apex = [cx, y + h, cz];
  const corners = [[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([sx, sz]) => [cx + sx * half, y, cz + sz * half]);
  if (door) { // the main pyramid stands on a kerb around the opening to the hall
    const a = half + 0.5, b = HALL_OPENING;
    M.granite.box(cx - a, GROUND, cz - a, cx + a, y, cz - b); M.granite.box(cx - a, GROUND, cz + b, cx + a, y, cz + a);
    M.granite.box(cx - a, GROUND, cz - b, cx - b, y, cz + b); M.granite.box(cx + b, GROUND, cz - b, cx + a, y, cz + b);
  } else {
    M.granite.box(cx - half - 0.5, GROUND, cz - half - 0.5, cx + half + 0.5, y, cz + half + 0.5);
    M.glow.box(cx - half + 0.6, y, cz - half + 0.6, cx + half - 0.6, y + 0.05, cz + half - 0.6);
  }
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

// Hall Napoléon under the main pyramid: a room wider than the opening, 9.3 m below the court, with a
// mezzanine, the spiral stair around its open lift, escalators and the round desk. Sizes are approximate.
{
  const R = 27, FLOOR = -9, MEZZ = -4.6, O = HALL_OPENING, top = GROUND + 0.35;
  M.glow.box(-R, FLOOR - 0.3, -R, R, FLOOR, R); // the floor: pale stone by day, lit from within at night
  for (const [x0, z0, x1, z1] of [[-R, -R, R, -R + 0.4], [-R, R - 0.4, R, R], [-R, -R, -R + 0.4, R], [R - 0.4, -R, R, R]]) M.hallWall.box(x0, FLOOR, z0, x1, GROUND - 0.4, z1);
  // ceiling between the opening and the walls, coffered underneath
  for (const [x0, z0, x1, z1] of [[-R, -R, R, -O], [-R, O, R, R], [-R, -O, -O, O], [O, -O, R, O]]) {
    M.hallCeiling.box(x0, GROUND - 1.1, z0, x1, GROUND - 0.4, z1);
    for (let x = x0 + 0.5; x < x1 - 0.1; x += 3.3) M.hallCeiling.box(x, GROUND - 1.6, z0, Math.min(x + 0.5, x1), GROUND - 1.1, z1);
    for (let z = z0 + 0.5; z < z1 - 0.1; z += 3.3) M.hallCeiling.box(x0, GROUND - 1.6, z, x1, GROUND - 1.1, Math.min(z + 0.5, z1));
  }
  // openings towards the three wings, and the mezzanine round three sides
  for (const [x, z, w, d] of [[0, -R + 0.45, 9, 0.1], [0, R - 0.55, 9, 0.1], [R - 0.55, 0, 0.1, 9]]) M.hallShade.box(x - w, FLOOR, z - d, x + w, MEZZ - 0.6, z + d);
  for (const [x0, z0, x1, z1] of [[-R, -R, R, -O - 2], [-R, O + 2, R, R], [O + 2, -O - 2, R, O + 2]]) {
    M.hallWall.box(x0, MEZZ - 0.5, z0, x1, MEZZ, z1);
  }
  for (const [x0, z0, x1, z1] of [[-R, -O - 2.1, O + 2, -O - 2], [-R, O + 2, O + 2, O + 2.1], [O + 2, -O - 2, O + 2.1, O + 2]]) M.hallSteel.box(x0, MEZZ, z0, x1, MEZZ + 1.05, z1);
  for (const x of [-18, -6, 6, 18]) for (const s of [-1, 1]) M.hallWall.cyl(x, s * (O + 2.6), 0.55, FLOOR, 0.55, MEZZ - 0.5, 10);
  // landing inside the west door, then the spiral stair down around the lift
  const SX = -8.5, turns = 1.25, steps = 44, r0 = 1.9, r1 = 4.6;
  M.hallWall.box(-O, top - 0.35, -3.2, SX - r1 * 0.2, top, 3.2);
  for (let i = 0; i < steps; i++) {
    const a0 = Math.PI + (i / steps) * turns * 2 * Math.PI, a1 = Math.PI + ((i + 1.08) / steps) * turns * 2 * Math.PI, y = top - ((i + 1) / steps) * (top - FLOOR);
    const p = (r, a, yy) => [SX + Math.cos(a) * r, yy, Math.sin(a) * r];
    M.hallWall.poly([p(r0, a0, y), p(r1, a0, y), p(r1, a1, y), p(r0, a1, y)]);
    M.hallWall.poly([p(r0, a0, y - 0.22), p(r1, a0, y - 0.22), p(r1, a1, y - 0.22), p(r0, a1, y - 0.22)]);
    M.hallWall.poly([p(r0, a0, y), p(r1, a0, y), p(r1, a0, y - 0.22), p(r0, a0, y - 0.22)]);
    M.hallSteel.poly([p(r1, a0, y), p(r1, a1, y), p(r1, a1, y + 1.0), p(r1, a0, y + 1.0)]); M.hallSteel.poly([p(r0, a0, y), p(r0, a1, y), p(r0, a1, y + 1.0), p(r0, a0, y + 1.0)]);
  }
  M.hallSteel.cyl(SX, 0, 1.45, FLOOR, 1.45, FLOOR + 4.2, 20); // the open lift on its piston
  M.hallSteel.cyl(SX, 0, 1.6, FLOOR + 4.2, 1.6, FLOOR + 4.35, 20);
  // escalators up to the mezzanine on the east side, and the round information desk
  for (const s of [-1, 1]) {
    const z = s * 12, a = [9, FLOOR, z], b = [O + 2, MEZZ, z];
    M.hallShade.poly([[a[0], a[1] + 0.1, z - 1], [b[0], b[1] + 0.1, z - 1], [b[0], b[1] + 0.1, z + 1], [a[0], a[1] + 0.1, z + 1]]);
    for (const q of [-1.05, 1.05]) M.hallSteel.poly([[a[0], a[1], z + q], [b[0], b[1], z + q], [b[0], b[1] + 1, z + q], [a[0], a[1] + 1, z + q]]);
  }
  M.hallWall.cyl(6, 0, 2.6, FLOOR, 2.6, FLOOR + 1.1, 20); M.hallShade.cyl(6, 0, 2.1, FLOOR + 1.1, 2.1, FLOOR + 1.12, 20);
  // ground under the rest of the court's paving so nothing shows through at the edges
  M.hallCeiling.box(-R - 0.5, FLOOR - 0.6, -R - 0.5, R + 0.5, FLOOR - 0.3, R + 0.5);
}
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

// Glazed roofs over the inner courts between the court wings and the long outer ranges. The Richelieu
// side's courts are roofed like this; on the Denon side it stands in for courts that are partly open.
for (const s of [-1, 1]) {
  for (const [xa, xb] of [[-90, -52], [-30, 28], [50, 90]]) {
    const za = s * (COURT_HALF + DEPTH), zb = s * (OUTER - DEPTH), zc = (za + zb) / 2, eave = GROUND + 24.3, ridge = GROUND + 28.2;
    for (const z of [za, zb]) {
      M.courtGlass.poly([[xa, eave, z], [xb, eave, z], [xb, ridge, zc], [xa, ridge, zc]]);
      M.steel.bar([xa, eave, z], [xb, eave, z], 0.3);
      for (let x = xa; x <= xb + 0.01; x += (xb - xa) / Math.round((xb - xa) / 3.2)) M.steel.bar([x, eave, z], [x, ridge, zc], 0.16);
      for (const f of [1 / 3, 2 / 3]) M.steel.bar([xa, eave + (ridge - eave) * f, z + (zc - z) * f], [xb, eave + (ridge - eave) * f, z + (zc - z) * f], 0.1);
    }
    M.steel.bar([xa, ridge, zc], [xb, ridge, zc], 0.3);
    for (const x of [xa, xb]) M.courtGlass.poly([[x, eave, za], [x, eave, zb], [x, ridge, zc]]);
  }
}

// ------------------------------------------------------------------ write the file
const palace = buildPalace();
const textures = makeTextures();
const doc = new Document();
doc.getRoot().getAsset().generator = 'Paris vivant Louvre 3D builder (CC0)';
const buffer = doc.createBuffer();
const scene = doc.createScene('Musee_du_Louvre');
const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
let tris = 0;
let drawn = 0;
for (const b of Object.values(M)) {
  if (!b.idx.length) continue;
  const material = doc.createMaterial(b.name)
    .setBaseColorFactor([...b.color, b.alpha])
    .setMetallicFactor(b.metal)
    .setRoughnessFactor(b.rough);
  if (b.alpha < 1) material.setAlphaMode('BLEND').setDoubleSided(true);
  if (b.emissive) material.setEmissiveFactor(b.emissive);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(b.pos)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(b.norm)))
    .setIndices(acc('SCALAR', new Uint32Array(b.idx)))
    .setMaterial(material);
  scene.addChild(doc.createNode(b.name).setMesh(doc.createMesh(b.name).addPrimitive(prim)));
  tris += b.idx.length / 3;
}
drawn = tris;

// Every triangle in world space: the palace's modules where they stand, then the rest of the site.
const worldPalace = expandPalace(palace, GROUND);
const buckets = Object.values(M).filter((b) => b.idx.length);
const world = (() => {
  const extra = buckets.reduce((n, b) => n + b.idx.length / 3, 0), total = worldPalace.MID.length + extra;
  const P = new Float32Array(total * 9), N = new Float32Array(total * 9), UV = new Float32Array(total * 6), MID = new Uint16Array(total);
  P.set(worldPalace.P); N.set(worldPalace.N); UV.set(worldPalace.UV); MID.set(worldPalace.MID);
  let t = worldPalace.MID.length;
  buckets.forEach((b, bi) => {
    for (let i = 0; i < b.idx.length; i++) { const v = b.idx[i] * 3; P.set(b.pos.slice(v, v + 3), t * 9 + (i % 3) * 3); N.set(b.norm.slice(v, v + 3), t * 9 + (i % 3) * 3); if (i % 3 === 2) MID[t++] = palace.names.length + bi; }
  });
  return { P, N, UV, MID };
})();

// Bake how open each corner of a module is to the sky, measured where one typical copy of it stands,
// into its vertex colours: recesses, the undersides of cornices and the foot of the walls come out darker.
const { occluded } = buildBvh(world.P);
const TYPICAL = { Bay_A: [-40, 62], Bay_B: [-40, 62], Chimney: [-40, 68], Pavilion: [123, 0], Pavilion_Low: [-105, 73], Clock: [123, 0] };
for (const [name, mod] of Object.entries(palace.modules)) {
  const [tx, tz] = TYPICAL[name];
  const at = palace.placements.filter((p) => p.module === name).sort((a, b) => Math.hypot(a.x - tx, a.z - tz) - Math.hypot(b.x - tx, b.z - tz))[0];
  const one = expandPalace({ modules: palace.modules, placements: [at] }, GROUND);
  const open = bakeOcclusion(occluded, one.P, one.N);
  mod.SHADE = Float32Array.from(open, (v) => 0.42 + 0.58 * Math.min(1, v * 1.15)); // open walls stay at full brightness
}

// The palace: one mesh per module, drawn once for every place it stands.
const palaceMaterials = palace.names.map((name) => {
  const [color, rough, metal] = PALACE_MATERIALS[name];
  const m = doc.createMaterial(name).setBaseColorFactor([...color, 1]).setRoughnessFactor(rough).setMetallicFactor(metal).setDoubleSided(true);
  return m;
});
const instancing = doc.createExtension(EXTMeshGPUInstancing).setRequired(true);
for (const [name, mod] of Object.entries(palace.modules)) {
  const mesh = doc.createMesh(`Palace_${name}`);
  palace.names.forEach((_, mi) => {
    const pick = [];
    mod.MID.forEach((m, t) => { if (m === mi) pick.push(t); });
    if (!pick.length) return;
    const take = (src, n) => { const out = new Float32Array(pick.length * 3 * n); pick.forEach((t, k) => { for (let i = 0; i < 3 * n; i++) out[k * 3 * n + i] = src[t * 3 * n + i]; }); return out; };
    mesh.addPrimitive(doc.createPrimitive()
      .setAttribute('POSITION', acc('VEC3', take(mod.P, 3))).setAttribute('NORMAL', acc('VEC3', take(mod.N, 3))).setAttribute('TEXCOORD_0', acc('VEC2', take(mod.UV, 2)))
      .setAttribute('COLOR_0', acc('VEC3', (() => { const out = new Float32Array(pick.length * 9); pick.forEach((t, k) => { for (let i = 0; i < 3; i++) out.fill(mod.SHADE[t * 3 + i], k * 9 + i * 3, k * 9 + i * 3 + 3); }); return out; })()))
      .setIndices(acc('SCALAR', Uint32Array.from({ length: pick.length * 3 }, (_, i) => i)))
      .setMaterial(palaceMaterials[mi]));
  });
  const at = palace.placements.filter((p) => p.module === name);
  const T = new Float32Array(at.length * 3), R = new Float32Array(at.length * 4), S = new Float32Array(at.length * 3);
  at.forEach((p, i) => {
    const half = Math.atan2(-p.dz, p.dx) / 2;
    T.set([p.x, GROUND, p.z], i * 3); R.set([0, Math.sin(half), 0, Math.cos(half)], i * 4); S.set([p.sx, 1, p.sz], i * 3);
  });
  const batch = instancing.createInstancedMesh().setAttribute('TRANSLATION', acc('VEC3', T)).setAttribute('ROTATION', acc('VEC4', R)).setAttribute('SCALE', acc('VEC3', S));
  scene.addChild(doc.createNode(`Palace_${name}`).setMesh(mesh).setExtension('EXT_mesh_gpu_instancing', batch));
  tris += mod.MID.length;
  drawn += mod.MID.length * at.length;
}

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshGPUInstancing, EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await doc.transform(weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14 }));
const dir = new URL('../public/models/', import.meta.url);
mkdirSync(dir, { recursive: true });
const glb = await io.writeBinary(doc);
writeFileSync(new URL('louvre.glb', dir), glb);
// The viewer applies these by material name (see applyLouvreTextures), as it does for Notre-Dame.
mkdirSync(new URL('louvre/', dir), { recursive: true });
for (const [key, image] of Object.entries(textures)) writeFileSync(new URL(`louvre/${key}.png`, dir), encodePng(image));
console.log(`wrote public/models/louvre.glb: ${(glb.byteLength / 1e6).toFixed(2)} MB — ${tris.toLocaleString()} triangles stored, ${drawn.toLocaleString()} drawn (${palace.placements.length} module placements)`);

// ------------------------------------------------------------------ world-space dump for the path tracer
const dumpAt = process.argv.indexOf('--dump');
if (dumpAt > 0) {
  const out = process.argv[dumpAt + 1];
  mkdirSync(out, { recursive: true });
  const { P, N, UV, MID } = world, total = MID.length;
  const texKeys = Object.keys(textures);
  const mats = [
    ...palace.names.map((name) => { const [color, rough, metal, tex] = PALACE_MATERIALS[name]; return { name, color, rough, metal, opacity: 1, emissive: [0, 0, 0], map: tex ? texKeys.indexOf(tex) : -1, f0: /Glass/.test(name) ? 0.1 : undefined, ...(/Glass/.test(name) ? { metal: 0, rough: 0.02, color: [0.012, 0.014, 0.018] } : {}) }; }),
    ...buckets.map((b) => ({ name: b.name, color: b.color, rough: b.rough, metal: b.metal, opacity: b.alpha, emissive: [0, 0, 0], map: -1 })),
  ];
  const texs = texKeys.map((k) => ({ w: textures[k].w, h: textures[k].h, data: Array.from(textures[k].data), m: [1, 0, 0, 0, 1, 0, 0, 0, 1], flipY: false }));
  writeFileSync(`${out}/scene.json`, JSON.stringify({ mats, texs }));
  for (const [name, a] of Object.entries({ P, N, UV, MID })) writeFileSync(`${out}/${name}.bin`, Buffer.from(a.buffer));
  console.log(`dumped ${total.toLocaleString()} world-space triangles to ${out}`);
}
