/**
 * Detailed 3D miniature models of all 26 Paris landmarks, drawn on top of the flat map.
 *
 * The map is seen from above with an oblique projection: a point's height shifts it up the
 * screen (north). Because the view direction never changes, backface culling, multi-light
 * shading (warm sun + cool sky ambient + height ambient occlusion + specular highlights),
 * and depth sorting are computed once when a model is built.
 *
 * Model coordinates are metres: x along the building's main axis, y to its left, z up.
 */

/** Screen shift per metre of height, relative to a metre on the ground. */
export const Z_SCALE = 0.85;
const SUN = normalize([-0.48, -0.52, 0.71]); // warm sunlight from the south-west
const SKY = normalize([0.35, 0.45, 0.82]); // cool sky fill from the north-east
const VIEW: Vec3 = [0, -Z_SCALE, 1]; // projection ray direction towards the viewer
const VIEW_DIR = normalize([0, -1, Z_SCALE]); // unit surface-to-camera vector
const HALF_VEC = normalize([SUN[0] + VIEW_DIR[0], SUN[1] + VIEW_DIR[1], SUN[2] + VIEW_DIR[2]]);

type Vec2 = [number, number];
type Vec3 = [number, number, number];
export type Material = 'matte' | 'stone' | 'metal' | 'gold' | 'glass' | 'water' | 'foliage' | 'glow';

interface PolyOpts {
  mat?: Material;
  twoSided?: boolean;
  alpha?: number;
  stroke?: string;
  bias?: number;
}

export interface Face {
  /** flat x, y, z */
  pts: number[];
  fill: string;
  nightFill?: string;
  stroke?: string;
  alpha?: number;
}

export interface Model {
  /** sorted far to near */
  faces: Face[];
  height: number;
  /** largest horizontal distance from the origin */
  radius: number;
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function clamp(v: number, lo = 0, hi = 255) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shadeColor(hex: string, unit: Vec3, zAvg: number, mat: Material): { day: string; night?: string; stroke?: string } {
  const [r, g, b] = parseHex(hex);
  const ndotl = Math.max(0, unit[0] * SUN[0] + unit[1] * SUN[1] + unit[2] * SUN[2]);
  const ndotsky = Math.max(0, unit[0] * SKY[0] + unit[1] * SKY[1] + unit[2] * SKY[2]);
  const ndoth = Math.max(0, unit[0] * HALF_VEC[0] + unit[1] * HALF_VEC[1] + unit[2] * HALF_VEC[2]);
  const ao = 0.84 + 0.16 * Math.min(1, Math.max(0, zAvg / 45));

  if (mat === 'glow') {
    const lit = 0.72 + 0.28 * ndotl;
    return {
      day: `rgb(${clamp(r * lit)},${clamp(g * lit)},${clamp(b * lit)})`,
      night: `rgb(${clamp(r * 1.15 + 35)},${clamp(g * 1.1 + 25)},${clamp(b * 0.95 + 10)})`,
    };
  }

  let spec = 0;
  let warm = 0;
  let cool = 0;
  switch (mat) {
    case 'gold':
      spec = Math.pow(ndoth, 14) * 75 + Math.pow(ndoth, 4) * 22;
      warm = ndotl * 18;
      break;
    case 'metal':
      spec = Math.pow(ndoth, 12) * 52 + Math.pow(ndoth, 3) * 14;
      cool = ndotsky * 12;
      break;
    case 'glass':
      spec = Math.pow(ndoth, 16) * 85 + Math.pow(ndoth, 4) * 20;
      cool = ndotsky * 18;
      break;
    case 'water':
      spec = Math.pow(ndoth, 20) * 65;
      cool = 10;
      break;
    case 'foliage':
      warm = ndotl * 10;
      break;
    default:
      warm = ndotl * 11;
      cool = ndotsky * 8;
      break;
  }

  const baseLit = (0.46 + 0.48 * ndotl + 0.12 * ndotsky) * ao;
  const dr = clamp(r * baseLit + warm + spec - cool * 0.25);
  const dg = clamp(g * baseLit + warm * 0.7 + spec * 0.95 + cool * 0.15);
  const db = clamp(b * baseLit - warm * 0.25 + spec * 0.85 + cool);

  // Warm architectural uplighting at night on lower/vertical faces.
  const vert = 1 - Math.abs(unit[2]);
  const upGlow = vert * Math.max(0, 1 - zAvg / 140) * 0.35 + (mat === 'gold' ? 0.35 : 0);
  const nr = clamp(dr * 0.58 + r * upGlow * 0.65 + 22 * upGlow);
  const ng = clamp(dg * 0.56 + g * upGlow * 0.52 + 14 * upGlow);
  const nb = clamp(db * 0.64 + b * upGlow * 0.3);

  return { day: `rgb(${dr},${dg},${db})`, night: `rgb(${nr},${ng},${nb})` };
}

function rect(cx: number, cy: number, w: number, d: number, rot = 0): Vec2[] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as Vec2[]).map(([u, v]) => {
    const x = (u * w) / 2;
    const y = (v * d) / 2;
    return [cx + x * c - y * s, cy + x * s + y * c];
  });
}

function ngon(cx: number, cy: number, r: number, n: number, rot = 0): Vec2[] {
  return Array.from({ length: n }, (_, i) => {
    const a = rot + (i / n) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Vec2;
  });
}

function ellipseRing(cx: number, cy: number, rx: number, ry: number, n: number, rot = 0): Vec2[] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const x = rx * Math.cos(a);
    const y = ry * Math.sin(a);
    return [cx + x * c - y * s, cy + x * s + y * c] as Vec2;
  });
}

class Builder {
  private polys: { pts: Vec3[]; color: string; opts: PolyOpts }[] = [];

  poly(pts: Vec3[], color: string, opts: PolyOpts = {}) {
    this.polys.push({ pts, color, opts });
    return this;
  }

  /** Flat horizontal pad/plaza on plane z. */
  pad(outline: Vec2[], z: number, color: string, opts: PolyOpts = {}) {
    return this.poly(outline.map(([x, y]) => [x, y, z] as Vec3), color, { bias: -4, ...opts });
  }

  /** Solid between a CCW bottom outline at z0 and a CCW top outline (same point count) at z1. */
  loft(bottom: Vec2[], z0: number, top: Vec2[], z1: number, color: string, opts: PolyOpts = {}, capTop = true) {
    const n = bottom.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.poly([[...bottom[i], z0], [...bottom[j], z0], [...top[j], z1], [...top[i], z1]], color, opts);
    }
    if (capTop) this.poly(top.map((p) => [...p, z1] as Vec3), color, opts);
    return this;
  }

  /** Loft between two general 3D rings of equal length. */
  loft3(bottom: Vec3[], top: Vec3[], color: string, opts: PolyOpts = {}, capTop = false) {
    const n = bottom.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.poly([bottom[i], bottom[j], top[j], top[i]], color, opts);
    }
    if (capTop) this.poly(top, color, opts);
    return this;
  }

  box(cx: number, cy: number, w: number, d: number, z0: number, z1: number, color: string, rot = 0, opts: PolyOpts = {}) {
    const r = rect(cx, cy, w, d, rot);
    return this.loft(r, z0, r, z1, color, opts);
  }

  /** Box with an overhanging cornice/roof trim at the top. */
  corniceBox(
    cx: number,
    cy: number,
    w: number,
    d: number,
    z0: number,
    z1: number,
    color: string,
    trimColor: string,
    rot = 0,
    overhang = 1.6,
    trimH = 1.8,
  ) {
    this.box(cx, cy, w, d, z0, z1 - trimH, color, rot);
    return this.box(cx, cy, w + overhang * 2, d + overhang * 2, z1 - trimH, z1, trimColor, rot);
  }

  /** Rectangular solid that tapers from (w0, d0) at z0 to (w1, d1) at z1. */
  taper(
    cx: number,
    cy: number,
    w0: number,
    d0: number,
    z0: number,
    w1: number,
    d1: number,
    z1: number,
    color: string,
    rot = 0,
    opts: PolyOpts = {},
    capTop = true,
  ) {
    return this.loft(rect(cx, cy, w0, d0, rot), z0, rect(cx, cy, w1, d1, rot), z1, color, opts, capTop);
  }

  /** Pyramid (4-sided or n-sided) meeting at an apex. */
  pyramid(cx: number, cy: number, w: number, d: number, z0: number, z1: number, color: string, rot = 0, opts: PolyOpts = {}) {
    const base = rect(cx, cy, w, d, rot);
    const apex: Vec3 = [cx, cy, z1];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.poly([[...base[i], z0], [...base[j], z0], apex], color, opts);
    }
    return this;
  }

  cylinder(
    cx: number,
    cy: number,
    r0: number,
    z0: number,
    z1: number,
    color: string,
    r1 = r0,
    n = 16,
    opts: PolyOpts = {},
    capTop = true,
    rot = 0,
  ) {
    return this.loft(ngon(cx, cy, r0, n, rot), z0, ngon(cx, cy, r1, n, rot), z1, color, opts, capTop);
  }

  ellipseCylinder(
    cx: number,
    cy: number,
    rx0: number,
    ry0: number,
    z0: number,
    z1: number,
    color: string,
    rx1 = rx0,
    ry1 = ry0,
    n = 18,
    rot = 0,
    opts: PolyOpts = {},
  ) {
    return this.loft(ellipseRing(cx, cy, rx0, ry0, n, rot), z0, ellipseRing(cx, cy, rx1, ry1, n, rot), z1, color, opts);
  }

  /** Half-ellipsoid of radius r and height h sitting on z0. */
  dome(cx: number, cy: number, r: number, z0: number, h: number, color: string, n = 16, bands = 6, opts: PolyOpts = {}) {
    for (let b = 0; b < bands; b++) {
      const a0 = (b / bands) * (Math.PI / 2);
      const a1 = ((b + 1) / bands) * (Math.PI / 2);
      const r0 = r * Math.cos(a0);
      const r1 = Math.max(0.05, r * Math.cos(a1));
      this.loft(ngon(cx, cy, r0, n), z0 + h * Math.sin(a0), ngon(cx, cy, r1, n), z0 + h * Math.sin(a1), color, opts, b === bands - 1);
    }
    return this;
  }

  sphere(cx: number, cy: number, r: number, zc: number, color: string, n = 18, bands = 6, opts: PolyOpts = {}) {
    for (let b = -bands; b < bands; b++) {
      const a0 = (b / bands) * (Math.PI / 2);
      const a1 = ((b + 1) / bands) * (Math.PI / 2);
      const r0 = Math.max(0.05, r * Math.cos(a0));
      const r1 = Math.max(0.05, r * Math.cos(a1));
      this.loft(ngon(cx, cy, r0, n), zc + r * Math.sin(a0), ngon(cx, cy, r1, n), zc + r * Math.sin(a1), color, opts, b === bands - 1);
    }
    return this;
  }

  /** Pitched roof over a rectangle, ridge along the rectangle's long (w) side. */
  gable(cx: number, cy: number, w: number, d: number, z0: number, h: number, color: string, rot = 0, opts: PolyOpts = {}) {
    const [a, b, c, e] = rect(cx, cy, w, d, rot);
    const [r1, r2] = rect(cx, cy, w, 0, rot); // r1 is near a/e (-w/2), r2 is near b/c (+w/2)
    const z1 = z0 + h;
    this.poly([[...a, z0], [...b, z0], [...r2, z1], [...r1, z1]], color, opts);
    this.poly([[...c, z0], [...e, z0], [...r1, z1], [...r2, z1]], color, opts);
    this.poly([[...e, z0], [...a, z0], [...r1, z1]], color, opts);
    return this.poly([[...b, z0], [...c, z0], [...r2, z1]], color, opts);
  }

  /** Mansard (hipped/truncated) roof typical of Paris Haussmann & palace buildings. */
  mansard(
    cx: number,
    cy: number,
    w: number,
    d: number,
    z0: number,
    h: number,
    inset: number,
    slateColor: string,
    flatColor = slateColor,
    rot = 0,
    opts: PolyOpts = {},
  ) {
    const w1 = Math.max(0.5, w - inset * 2);
    const d1 = Math.max(0.5, d - inset * 2);
    this.loft(rect(cx, cy, w, d, rot), z0, rect(cx, cy, w1, d1, rot), z0 + h, slateColor, opts, false);
    return this.poly(rect(cx, cy, w1, d1, rot).map((p) => [...p, z0 + h] as Vec3), flatColor, opts);
  }

  /** Semi-cylindrical barrel vault roof along the local w-axis (rotated by rot). */
  barrelVault(
    cx: number,
    cy: number,
    w: number,
    d: number,
    z0: number,
    h: number,
    color: string,
    rot = 0,
    segs = 8,
    opts: PolyOpts = {},
  ) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const toW = (lx: number, ly: number, lz: number): Vec3 => [cx + lx * c - ly * s, cy + lx * s + ly * c, lz];
    const hw = w / 2;
    const hd = d / 2;
    const frontFace: Vec3[] = [];
    const backFace: Vec3[] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI;
      const y0 = -hd * Math.cos(a);
      const z = z0 + h * Math.sin(a);
      frontFace.push(toW(hw, y0, z));
      backFace.unshift(toW(-hw, y0, z));
      if (i < segs) {
        const a1 = ((i + 1) / segs) * Math.PI;
        const y1 = -hd * Math.cos(a1);
        const z1 = z0 + h * Math.sin(a1);
        this.poly([toW(-hw, y0, z), toW(hw, y0, z), toW(hw, y1, z1), toW(-hw, y1, z1)], color, opts);
      }
    }
    this.poly(frontFace, color, opts);
    this.poly(backFace, color, opts);
    return this;
  }

  /** 3D tube/beam between two 3D points with rectangular cross-section. */
  beam(p0: Vec3, p1: Vec3, radius: number, color: string, sides = 6, opts: PolyOpts = {}) {
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const dir: Vec3 = [dx / len, dy / len, dz / len];
    const up: Vec3 = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const ux = dir[1] * up[2] - dir[2] * up[1];
    const uy = dir[2] * up[0] - dir[0] * up[2];
    const uz = dir[0] * up[1] - dir[1] * up[0];
    const u = normalize([ux, uy, uz]);
    const v: Vec3 = [dir[1] * u[2] - dir[2] * u[1], dir[2] * u[0] - dir[0] * u[2], dir[0] * u[1] - dir[1] * u[0]];
    const ring = (p: Vec3): Vec3[] =>
      Array.from({ length: sides }, (_, i) => {
        const a = (i / sides) * Math.PI * 2;
        const ca = Math.cos(a) * radius;
        const sa = Math.sin(a) * radius;
        return [p[0] + u[0] * ca + v[0] * sa, p[1] + u[1] * ca + v[1] * sa, p[2] + u[2] * ca + v[2] * sa];
      });
    return this.loft3(ring(p0), ring(p1), color, opts, true);
  }

  /** Stylized lush tree (trunk + layered foliage crown). */
  tree(x: number, y: number, z0: number, h = 11, r = 4.2, foliageColor = '#3b7a4a') {
    this.cylinder(x, y, r * 0.18, z0, z0 + h * 0.35, '#5c4636', r * 0.14, 6);
    this.dome(x, y, r, z0 + h * 0.28, h * 0.72, foliageColor, 8, 3, { mat: 'foliage' });
    this.dome(x, y, r * 0.85, z0 + h * 0.28, -h * 0.18, foliageColor, 8, 2, { mat: 'foliage' });
    return this;
  }

  /** Rotate the whole model by `rot` (radians, counter-clockwise from east), then cull, shade, and sort. */
  build(rot: number): Model {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    let height = 0;
    let radius = 0;
    const faces: (Face & { depth: number })[] = [];

    for (const { pts, color, opts } of this.polys) {
      const p = pts.map(([x, y, z]) => [x * c - y * s, x * s + y * c, z] as Vec3);
      // Newell's method: robust outward normal for any planar polygon.
      const n: Vec3 = [0, 0, 0];
      let depth = 0;
      let zAvg = 0;
      p.forEach((a, i) => {
        const b = p[(i + 1) % p.length];
        n[0] += (a[1] - b[1]) * (a[2] + b[2]);
        n[1] += (a[2] - b[2]) * (a[0] + b[0]);
        n[2] += (a[0] - b[0]) * (a[1] + b[1]);
        depth += a[1] * VIEW[1] + a[2] * VIEW[2];
        zAvg += a[2];
        height = Math.max(height, a[2]);
        radius = Math.max(radius, Math.hypot(a[0], a[1]));
      });
      let unit = normalize(n);
      const facing = unit[0] * VIEW[0] + unit[1] * VIEW[1] + unit[2] * VIEW[2];
      // Backface culling for closed solids prevents far faces from bleeding through near faces.
      if (!opts.twoSided && facing < -0.03) continue;
      if (facing < 0) unit = [-unit[0], -unit[1], -unit[2]];

      zAvg /= p.length;
      const shaded = shadeColor(color, unit, zAvg, opts.mat ?? 'stone');
      faces.push({
        pts: p.flat(),
        fill: shaded.day,
        nightFill: shaded.night,
        stroke: opts.stroke,
        alpha: opts.alpha,
        depth: depth / p.length + facing * 0.35 + (opts.bias ?? 0),
      });
    }

    faces.sort((a, b) => a.depth - b.depth);
    return {
      faces: faces.map(({ pts, fill, nightFill, stroke, alpha }) => ({ pts, fill, nightFill, stroke, alpha })),
      height,
      radius,
    };
  }
}

const deg = (d: number) => (d * Math.PI) / 180;
const STONE = '#dfd5be';
const WARM_STONE = '#e8dec6';
const DARK_STONE = '#b5aa93';
const PALE = '#f3efe4';
const SLATE = '#5c6b78';
const DARK_SLATE = '#424e59';
const COPPER = '#6ea894';
const GOLD = '#eab93b';
const BRONZE = '#8a6f48';
const IRON = '#9e7f5b';
const DARK_IRON = '#785e40';
const GLASS = '#8ecae6';
const WATER = '#2c7da0';
const LAWN = '#2d5a3c';
const PLAZA = '#383f4d';
const WARM_GLOW = '#ffe194';
const corners: Vec2[] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];

/** Keyed by the landmark names used in the city data. */
const BUILDERS: Record<string, () => Model> = {
  // ------------------------------------------------------------------ 1. Tour Eiffel
  'Tour Eiffel': () => {
    const b = new Builder();
    // Champ de Mars garden plaza base
    b.box(0, 0, 128, 128, 0, 2, PLAZA);
    b.box(0, 0, 114, 114, 2, 3, LAWN, 0, { mat: 'foliage' });
    b.box(0, 0, 36, 116, 2.2, 3.2, DARK_STONE).box(0, 0, 116, 36, 2.2, 3.2, DARK_STONE);

    // Four masonry anchor plinths + curved exponential lattice legs (3 stages up to 2nd floor)
    const legStages: [number, number, number][] = [
      [48, 24, 3],
      [34, 19, 30],
      [25, 16, 57],
      [19, 13, 86],
      [13.5, 10.5, 115],
    ];
    for (const [sx, sy] of corners) {
      b.box(sx * 50, sy * 50, 26, 26, 3, 9, STONE);
      for (let s = 0; s < legStages.length - 1; s++) {
        const [p0, w0, z0] = legStages[s];
        const [p1, w1, z1] = legStages[s + 1];
        b.loft(
          rect(sx * p0, sy * p0, w0, w0),
          z0,
          rect(sx * p1, sy * p1, w1, w1),
          z1,
          IRON,
          { mat: 'metal', stroke: DARK_IRON },
          false,
        );
      }
    }

    // Four grand decorative arches spanning between the legs below the 1st platform
    const archSegs = 8;
    for (const [axis, sign] of [
      ['x', 1],
      ['x', -1],
      ['y', 1],
      ['y', -1],
    ] as const) {
      for (let i = 0; i < archSegs; i++) {
        const a0 = (i / archSegs) * Math.PI;
        const a1 = ((i + 1) / archSegs) * Math.PI;
        const u0 = -34 * Math.cos(a0);
        const u1 = -34 * Math.cos(a1);
        const z0 = 10 + 36 * Math.sin(a0);
        const z1 = 10 + 36 * Math.sin(a1);
        const pos = (t: number) => 45 - (t / 46) * 10;
        const p0: Vec3 = axis === 'x' ? [u0, sign * pos(z0 - 10), z0] : [sign * pos(z0 - 10), u0, z0];
        const p1: Vec3 = axis === 'x' ? [u1, sign * pos(z1 - 10), z1] : [sign * pos(z1 - 10), u1, z1];
        b.beam(p0, p1, 2.6, DARK_IRON, 6, { mat: 'metal' });
      }
    }

    // 1st platform (57 m) double-deck with glowing observation gallery
    b.box(0, 0, 74, 74, 54, 58.5, DARK_IRON, 0, { mat: 'metal' });
    b.box(0, 0, 68, 68, 58.5, 62.5, WARM_GLOW, 0, { mat: 'glow' });
    b.box(0, 0, 72, 72, 62.5, 65, IRON, 0, { mat: 'metal' });

    // Middle horizontal truss belt at 86 m
    b.box(0, 0, 50, 50, 84, 88, DARK_IRON, 0, { mat: 'metal' });

    // 2nd platform (115 m) double-deck
    b.box(0, 0, 44, 44, 113, 117, DARK_IRON, 0, { mat: 'metal' });
    b.box(0, 0, 39, 39, 117, 120.5, WARM_GLOW, 0, { mat: 'glow' });
    b.box(0, 0, 42, 42, 120.5, 123, IRON, 0, { mat: 'metal' });

    // Upper tower shaft: curved 4-stage taper with horizontal lattice rings
    const shaft: [number, number][] = [
      [28, 123],
      [21, 160],
      [15.5, 200],
      [11.5, 240],
      [9.5, 274],
    ];
    for (let i = 0; i < shaft.length - 1; i++) {
      const [w0, z0] = shaft[i];
      const [w1, z1] = shaft[i + 1];
      b.taper(0, 0, w0, w0, z0, w1, w1, z1, IRON, 0, { mat: 'metal', stroke: DARK_IRON }, false);
      b.box(0, 0, w1 + 2.2, w1 + 2.2, z1 - 2.2, z1 + 0.8, DARK_IRON, 0, { mat: 'metal' });
    }

    // 3rd platform (summit observation deck, lantern cupola & golden beacon, 330 m spire)
    b.box(0, 0, 16, 16, 274, 279, DARK_IRON, 0, { mat: 'metal' });
    b.box(0, 0, 13.5, 13.5, 279, 285, WARM_GLOW, 0, { mat: 'glow' });
    b.box(0, 0, 15, 15, 285, 288, IRON, 0, { mat: 'metal' });
    b.cylinder(0, 0, 5.5, 288, 296, IRON, 4.2, 12, { mat: 'metal' });
    b.dome(0, 0, 4.5, 296, 6, GOLD, 12, 4, { mat: 'gold' });
    b.cylinder(0, 0, 1.4, 302, 330, '#e5e7eb', 0.3, 8, { mat: 'metal' });
    return b.build(deg(-42));
  },

  // ------------------------------------------------------------------ 2. Arc de Triomphe
  'Arc de Triomphe': () => {
    const b = new Builder();
    // Place Charles de Gaulle circular star plaza & Tomb of the Unknown Soldier
    b.cylinder(0, 0, 38, 0, 1.8, PLAZA, 38, 24);
    b.cylinder(0, 0, 28, 1.8, 2.8, DARK_STONE, 28, 24);
    b.cylinder(0, 0, 3.2, 2.8, 3.6, BRONZE, 3.2, 12, { mat: 'metal' });
    b.sphere(0, 0, 1.2, 4.2, '#ff9f1c', 10, 3, { mat: 'glow' });

    // Four corner piers with base pedestals and side transverse arches
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        b.box(sx * 16, sy * 6.5, 15, 10, 2.8, 8, DARK_STONE);
        b.box(sx * 15.5, sy * 6.2, 13.5, 9, 8, 26, STONE);
      }
      // Upper wall closing above the transverse side arches (z = 19..30)
      b.box(sx * 15.5, 0, 13.5, 21.5, 19, 30, STONE);
      // Four famous high-relief sculptures on the main piers (La Marseillaise, etc.)
      for (const sy of [-1, 1]) {
        b.box(sx * 15.5, sy * 11.2, 7.5, 1.8, 9, 21, WARM_STONE);
      }
    }

    // Curved main central vault (spanning x = -9..9, z = 20..30)
    const vaultSegs = 8;
    for (let i = 0; i < vaultSegs; i++) {
      const a0 = (i / vaultSegs) * Math.PI;
      const a1 = ((i + 1) / vaultSegs) * Math.PI;
      const x0 = -9 * Math.cos(a0);
      const x1 = -9 * Math.cos(a1);
      const z0 = 20 + 9.5 * Math.sin(a0);
      const z1 = 20 + 9.5 * Math.sin(a1);
      const top = 30.5;
      b.poly(
        [
          [x0, -10.8, z0],
          [x1, -10.8, z1],
          [x1, -10.8, top],
          [x0, -10.8, top],
        ],
        STONE,
        { twoSided: true },
      );
      b.poly(
        [
          [x1, 10.8, z1],
          [x0, 10.8, z0],
          [x0, 10.8, top],
          [x1, 10.8, top],
        ],
        STONE,
        { twoSided: true },
      );
      b.poly(
        [
          [x0, 10.8, z0],
          [x1, 10.8, z1],
          [x1, -10.8, z1],
          [x0, -10.8, z0],
        ],
        DARK_STONE,
        { twoSided: true },
      );
    }

    // Main entablature, frieze, projecting cornice, and ornate attic story
    b.box(0, 0, 45, 22, 30, 35.5, STONE);
    b.box(0, 0, 47.5, 24.5, 35.5, 38, WARM_STONE); // main dentil cornice
    b.box(0, 0, 43.5, 20.5, 38, 46.5, STONE); // attic story
    // Gold/stone shields along the attic frieze
    for (let x = -16; x <= 16; x += 5.3) {
      for (const sy of [-1, 1]) b.box(x, sy * 10.6, 2.2, 0.8, 40.5, 44, WARM_STONE);
    }
    b.box(0, 0, 45.5, 22.5, 46.5, 48.5, WARM_STONE); // top balustrade cornice
    b.box(0, 0, 39, 16, 48.5, 50.5, DARK_STONE); // roof viewing platform
    return b.build(deg(64));
  },

  // ------------------------------------------------------------------ 3. Notre-Dame
  'Notre-Dame': () => {
    const b = new Builder();
    // Parvis Notre-Dame & Île de la Cité stone terrace
    b.box(0, 0, 144, 62, 0, 2, PLAZA);

    // Side aisles & double ambulatories (lower level, z = 2..18)
    b.box(6, 0, 96, 38, 2, 16, STONE);
    b.mansard(6, 0, 96, 38, 16, 4, 3, SLATE);
    // Semicircular eastern apse (chevet) at x = 54
    b.cylinder(54, 0, 19, 2, 16, STONE, 19, 14);
    b.dome(54, 0, 19, 16, 5, SLATE, 14, 3);
    b.cylinder(54, 0, 12, 16, 33, STONE, 12, 14);
    b.dome(54, 0, 12, 33, 10, SLATE, 14, 4);

    // High nave clerestory (z = 16..34) & pitched lead roof (z = 34..44)
    b.box(6, 0, 96, 22, 16, 34, STONE);
    b.gable(6, 0, 96, 22, 34, 10.5, SLATE);

    // North & South transept arms with glowing stained-glass Rose Windows
    b.box(14, 0, 18, 48, 2, 34, STONE);
    b.gable(14, 0, 48, 18, 34, 10.5, SLATE, deg(90));
    for (const sy of [-1, 1]) {
      b.cylinder(14, sy * 24.3, 6.2, 17, 29, '#6a4c93', 6.2, 12, { mat: 'glow' });
      b.box(14, sy * 24.2, 18, 1.2, 31, 34, WARM_STONE);
      // Corner transept pinnacles
      for (const sx of [-1, 1]) {
        b.box(14 + sx * 8.5, sy * 23.5, 2.5, 2.5, 2, 38, WARM_STONE);
        b.pyramid(14 + sx * 8.5, sy * 23.5, 2.8, 2.8, 38, 43, SLATE);
      }
    }

    // Iconic Gothic flying buttresses along both sides of the nave and choir
    for (const x of [-28, -16, -4, 30, 40, 50]) {
      for (const sy of [-1, 1]) {
        // Outer buttress pier + spire pinnacle
        b.box(x, sy * 20, 2.6, 3.2, 2, 25, WARM_STONE);
        b.pyramid(x, sy * 20, 2.8, 2.8, 25, 31, SLATE);
        // Flying arch beam leaping to the high nave wall
        b.beam([x, sy * 19.5, 21], [x, sy * 11, 31], 1.1, STONE, 4);
      }
    }

    // West facade: Twin bell towers (69 m), 3 recessed portals, Gallery of Kings, West Rose Window
    b.box(-46, 0, 15, 41, 2, 43, STONE); // lower facade mass
    // Three recessed Gothic portals on the west front (x = -53.5)
    for (const py of [-13, 0, 13]) {
      b.box(-53.5, py, 2.5, 8.5, 2, 14, DARK_STONE);
      b.gable(-53.5, py, 8.5, 2.5, 14, 3.5, WARM_STONE, deg(90));
    }
    // Gallery of Kings horizontal frieze + West Rose Window + open arcade colonnade
    b.box(-53.2, 0, 2, 41.5, 17.5, 21, WARM_STONE);
    b.box(-46, 0, 14, 13, 21, 36, STONE);
    b.box(-53.6, 0, 1.2, 9.5, 22.5, 32, '#7b5ea7', 0, { mat: 'glow' }); // West Rose Window glow
    b.box(-46, 0, 15.5, 42, 37, 43, WARM_STONE); // Galerie des Chimères balustrade

    // Twin North & South Bell Towers (z = 43..69) with gothic louver lancets & corner turrets
    for (const sy of [-1, 1]) {
      const ty = sy * 13.5;
      b.box(-46, ty, 14.5, 14.5, 43, 68, STONE);
      b.box(-53.4, ty - 2.6, 0.8, 2.8, 46, 63, DARK_SLATE);
      b.box(-53.4, ty + 2.6, 0.8, 2.8, 46, 63, DARK_SLATE);
      b.box(-46, ty, 15.8, 15.8, 68, 70, WARM_STONE);
      for (const [cx, cy] of corners) {
        b.box(-46 + cx * 6.8, ty + cy * 6.8, 2.4, 2.4, 43, 72.5, WARM_STONE);
      }
    }

    // Viollet-le-Duc's central crossing spire (Flèche, 96 m)
    b.cylinder(14, 0, 5.2, 42, 52, WARM_STONE, 4.2, 8);
    b.cylinder(14, 0, 4.2, 52, 62, SLATE, 2.8, 8);
    b.cylinder(14, 0, 2.8, 62, 96, DARK_SLATE, 0.25, 8);
    b.sphere(14, 0, 1.1, 96.5, GOLD, 8, 3, { mat: 'gold' });
    return b.build(deg(-25));
  },

  // ------------------------------------------------------------------ 4. Sacré-Cœur
  'Sacré-Cœur': () => {
    const b = new Builder();
    // Montmartre terraced hillside steps & green embankments at the front (-x)
    b.box(-6, 0, 108, 68, 0, 3, PLAZA);
    b.box(-46, 0, 24, 52, 3, 7, LAWN, 0, { mat: 'foliage' });
    b.box(-46, 0, 24, 22, 3.2, 8.5, STONE); // grand front stairway
    b.box(4, 0, 82, 56, 3, 8, DARK_STONE); // upper basilica plinth

    // Main Romanesque-Byzantine white travertine cross body
    b.box(0, 0, 68, 34, 8, 31, PALE);
    b.box(0, 0, 34, 52, 8, 31, PALE);
    b.gable(0, 0, 68, 34, 31, 6, PALE);
    b.gable(0, 0, 52, 34, 31, 6, PALE, deg(90));

    // Front triple-arched portico & twin bronze equestrian statues (Joan of Arc & King Saint Louis)
    b.box(-38, 0, 10, 30, 8, 23, PALE);
    for (const py of [-8.5, 0, 8.5]) b.box(-43.2, py, 1.5, 5.5, 8, 19, DARK_SLATE);
    for (const sy of [-1, 1]) {
      b.box(-41, sy * 12, 5, 4, 23, 27, PALE);
      b.box(-41, sy * 12, 3.5, 2, 27, 32, COPPER, 0, { mat: 'metal' });
    }

    // Four corner Byzantine domes on octagonal drums with lanterns
    for (const [sx, sy] of corners) {
      const dx = sx * 18;
      const dy = sy * 16.5;
      b.cylinder(dx, dy, 6.2, 31, 41, PALE, 6.2, 12);
      b.dome(dx, dy, 6.2, 41, 13, PALE, 12, 5);
      b.cylinder(dx, dy, 1.8, 53.5, 58, PALE, 1.5, 8);
      b.dome(dx, dy, 1.8, 58, 2.5, PALE, 8, 3);
    }

    // Grand central ovoid (egg-shaped) Byzantine dome (83 m) with arcade colonnade drum
    b.cylinder(0, 0, 13.5, 31, 38, PALE, 13.5, 18);
    b.cylinder(0, 0, 12.5, 38, 52, WARM_STONE, 12.2, 18); // colonnade window drum
    b.dome(0, 0, 12.5, 52, 26, PALE, 18, 7);
    b.cylinder(0, 0, 3.6, 77, 84, PALE, 3.2, 10);
    b.dome(0, 0, 3.6, 84, 4.5, PALE, 10, 4);

    // Tall rear square bell tower (Campanile, 84 m)
    b.box(38, 0, 13, 13, 8, 70, PALE);
    b.box(38, 0, 14.5, 14.5, 70, 73, WARM_STONE);
    b.cylinder(38, 0, 5.8, 73, 79, PALE, 5.5, 12);
    b.dome(38, 0, 5.8, 79, 9, PALE, 12, 5);
    return b.build(deg(90));
  },

  // ------------------------------------------------------------------ 5. Musée du Louvre
  'Musée du Louvre': () => {
    const b = new Builder();
    // Cour Napoléon stone courtyard
    b.box(-10, 0, 290, 210, 0, 1.8, PLAZA);

    // Reflecting water basins surrounding the main pyramid
    b.box(-6, 0, 56, 56, 1.8, 2.5, WATER, deg(45), { mat: 'water' });

    // I.M. Pei's iconic glass & steel Louvre Pyramid + glowing subterranean lobby core
    b.pyramid(0, 0, 22, 22, 2.5, 14, WARM_GLOW, 0, { mat: 'glow', bias: -2 });
    b.pyramid(0, 0, 35.4, 35.4, 2.5, 21.6, GLASS, 0, {
      mat: 'glass',
      alpha: 0.78,
      stroke: 'rgba(225, 245, 255, 0.85)',
      bias: 2,
    });
    // Three smaller satellite glass pyramids around the courtyard
    for (const [px, py] of [
      [0, 36],
      [0, -36],
      [-38, 0],
    ]) {
      b.pyramid(px, py, 8.5, 8.5, 2.2, 7.5, GLASS, 0, {
        mat: 'glass',
        alpha: 0.82,
        stroke: 'rgba(225, 245, 255, 0.8)',
      });
    }

    // Richelieu (North), Denon (South), and Sully (East) palace wings with Mansard roofs & pavilions
    const wing = (cx: number, cy: number, w: number, d: number, rot = 0) => {
      b.corniceBox(cx, cy, w, d, 1.8, 22, STONE, WARM_STONE, rot);
      b.mansard(cx, cy, w, d, 22, 7.5, 4, SLATE, DARK_SLATE, rot);
    };
    const pavilion = (cx: number, cy: number, w: number, d: number, h = 26, roofH = 11, rot = 0) => {
      b.corniceBox(cx, cy, w, d, 1.8, h, WARM_STONE, STONE, rot);
      b.mansard(cx, cy, w + 1, d + 1, h, roofH, 4.5, SLATE, DARK_SLATE, rot);
    };

    // North (Richelieu) & South (Denon) outer & inner wings
    for (const sy of [-1, 1]) {
      wing(-25, sy * 82, 240, 24);
      pavilion(-140, sy * 82, 28, 28, 25, 11);
      pavilion(-25, sy * 78, 30, 30, 26, 12); // Pavillon Turgot / Mollien
      pavilion(95, sy * 82, 30, 30, 26, 12);
    }
    // East (Sully) wing closing the courtyard + grand central Pavillon de l'Horloge (Clock Pavilion)
    wing(95, 0, 26, 168, deg(90));
    pavilion(95, 0, 32, 34, 29, 14);
    return b.build(deg(-26));
  },

  // ------------------------------------------------------------------ 6. Panthéon
  'Panthéon': () => {
    const b = new Builder();
    // Place du Panthéon podium
    b.box(-6, 0, 146, 98, 0, 2.5, PLAZA);

    // Greek-cross Neoclassical body with projecting cornice
    b.corniceBox(0, 0, 112, 34, 2.5, 28, STONE, WARM_STONE);
    b.corniceBox(0, 0, 38, 86, 2.5, 28, STONE, WARM_STONE);
    b.gable(0, 0, 110, 32, 28, 4.5, SLATE);
    b.gable(0, 0, 84, 36, 28, 4.5, SLATE, deg(90));

    // Grand Corinthian West Portico with freestanding columns & triangular pediment
    b.box(-62, 0, 18, 40, 2.5, 6, DARK_STONE); // front steps
    b.box(-56, 0, 12, 36, 6, 25, DARK_STONE); // portico shadow recess
    for (let y = -15; y <= 15; y += 6) {
      b.cylinder(-62.5, y, 1.5, 6, 25, WARM_STONE, 1.35, 10);
    }
    b.box(-58, 0, 14, 38, 25, 28, WARM_STONE);
    b.gable(-58, 0, 38, 14, 28, 7.5, STONE, deg(90));

    // Three-tiered Neoclassical Dome (83 m): octagonal base -> columned peristyle drum -> ribbed dome -> lantern
    b.cylinder(0, 0, 19, 28, 36, STONE, 18.5, 12);
    b.cylinder(0, 0, 15, 36, 52, DARK_STONE, 15, 20); // inner drum shadow
    // Ring of 16 Corinthian columns around the peristyle drum
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      b.cylinder(Math.cos(a) * 17.2, Math.sin(a) * 17.2, 1.15, 36, 51, WARM_STONE, 1.05, 8);
    }
    b.cylinder(0, 0, 18.2, 51, 54, WARM_STONE, 17.5, 20); // balustrade cornice
    b. cylinder(0, 0, 15.8, 54, 58, STONE, 15.5, 20); // attic drum
    b.dome(0, 0, 15.6, 58, 20, SLATE, 20, 6);
    b.cylinder(0, 0, 3.6, 77, 84, WARM_STONE, 3.2, 10);
    b.dome(0, 0, 3.5, 84, 3.5, SLATE, 10, 3);
    b.cylinder(0, 0, 0.7, 87.5, 92, GOLD, 0.2, 6, { mat: 'gold' });
    return b.build(deg(-25));
  },

  // ------------------------------------------------------------------ 7. Les Invalides
  'Les Invalides': () => {
    const b = new Builder();
    // Esplanade & Cour d'Honneur base
    b.box(8, 0, 110, 88, 0, 2.2, PLAZA);
    b.box(-28, 0, 32, 66, 2.2, 3, LAWN, 0, { mat: 'foliage' });

    // Cour d'Honneur rear wings (Hôtel National des Invalides)
    for (const sy of [-1, 1]) {
      b.corniceBox(36, sy * 28, 48, 12, 2.2, 18, STONE, WARM_STONE);
      b.mansard(36, sy * 28, 48, 12, 18, 5, 2.5, SLATE);
    }

    // Dôme des Invalides square base & two-story Neoclassical front portico
    b.corniceBox(0, 0, 58, 58, 2.2, 27, STONE, WARM_STONE);
    b.corniceBox(0, 0, 36, 62, 2.2, 28, WARM_STONE, STONE);
    b.box(-31, 0, 8, 28, 2.2, 27, WARM_STONE);
    for (const y of [-10, -4, 4, 10]) {
      b.cylinder(-35.2, y, 1.2, 2.2, 25, PALE, 1.1, 8);
    }
    b.gable(-31, 0, 28, 9, 27, 6.5, STONE, deg(90));
    // Four corner chapels
    for (const [sx, sy] of corners) {
      b.cylinder(sx * 19, sy * 19, 6.5, 27, 32, STONE, 6.5, 10);
      b.dome(sx * 19, sy * 19, 6.5, 32, 4.5, SLATE, 10, 3);
    }

    // Tall two-story drum with Corinthian buttresses
    b.cylinder(0, 0, 16.5, 27, 45, STONE, 16, 20);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      b.box(Math.cos(a) * 16.2, Math.sin(a) * 16.2, 2.2, 2.6, 28, 45, WARM_STONE, a);
    }
    b.cylinder(0, 0, 17.2, 45, 47.5, WARM_STONE, 16.8, 20);
    b.cylinder(0, 0, 15.2, 47.5, 58, STONE, 14.8, 20);

    // Hardouin-Mansart's gleaming Gold Dome (107 m) with golden ribs, lantern & obelisk spire
    b.dome(0, 0, 15.4, 58, 27, GOLD, 20, 7, { mat: 'gold', stroke: '#c7921e' });
    b.cylinder(0, 0, 3.8, 84, 95, GOLD, 3.2, 10, { mat: 'gold' });
    b.dome(0, 0, 3.8, 95, 4, GOLD, 10, 3, { mat: 'gold' });
    b.cylinder(0, 0, 1.6, 99, 109, GOLD, 0.2, 8, { mat: 'gold' });
    return b.build(deg(90));
  },

  // ------------------------------------------------------------------ 8. Tour Montparnasse
  'Tour Montparnasse': () => {
    const b = new Builder();
    // Parvis base & lower shopping gallery podium
    b.box(0, 0, 82, 64, 0, 2.5, PLAZA);
    b.box(0, 0, 64, 46, 2.5, 14, '#2d333b');

    // Signature almond / elliptical cross-section monolith (210 m) in dark bronze curtain-wall glass
    const bronzeGlass = '#3d3530';
    const darkCore = '#26211e';
    b.ellipseCylinder(0, 0, 31, 19.5, 14, 196, bronzeGlass, 30, 19, 20, 0, {
      mat: 'glass',
      stroke: 'rgba(190, 165, 140, 0.28)',
    });
    // Recessed end structural cores & horizontal mechanical floor bands
    for (const sx of [-1, 1]) b.box(sx * 28.5, 0, 5, 14, 14, 198, darkCore, 0, { mat: 'metal' });
    for (const z of [55, 105, 155]) {
      b.ellipseCylinder(0, 0, 31.3, 19.8, z, z + 3, '#594c43', 31.3, 19.8, 20, 0, { mat: 'metal' });
    }

    // 56th floor glowing panoramic observation deck & 59th floor open-air rooftop + helipad
    b.ellipseCylinder(0, 0, 30.2, 19.2, 196, 203, WARM_GLOW, 30.2, 19.2, 20, 0, { mat: 'glow' });
    b.ellipseCylinder(0, 0, 30.5, 19.4, 203, 207, '#4a3f37', 30.5, 19.4, 20, 0, { mat: 'metal' });
    b.ellipseCylinder(0, 0, 26, 15.5, 207, 210, '#6e655f', 26, 15.5, 20, 0, { mat: 'metal' });
    // Rooftop white/gold helipad circle
    b.cylinder(0, 0, 9.5, 210, 210.8, '#d8dde6', 9.5, 16);
    b.cylinder(0, 0, 7.5, 210.8, 211.2, '#3a424d', 7.5, 16);
    return b.build(deg(40));
  },

  // ------------------------------------------------------------------ 9. Opéra Garnier
  'Opéra Garnier': () => {
    const b = new Builder();
    // Place de l'Opéra grand steps & forecourt
    b.box(-6, 0, 134, 92, 0, 2.5, PLAZA);
    b.box(-62, 0, 14, 54, 2.5, 6, WARM_STONE);

    // Main Beaux-Arts body with ground-floor arcades & second-floor Corinthian loggia
    b.corniceBox(-4, 0, 96, 68, 2.5, 29, STONE, WARM_STONE);
    b.box(-53, 0, 8, 66, 6, 26, DARK_STONE); // loggia shadow recess
    for (let y = -28; y <= 28; y += 8) {
      b.box(-56.5, y, 3, 2.8, 6, 26, WARM_STONE); // paired loggia columns
    }
    // Ornate gilded attic frieze above the loggia
    b.box(-52, 0, 10, 68, 26, 32, WARM_STONE);
    b.box(-56.8, 0, 1.5, 64, 28, 30.5, GOLD, 0, { mat: 'gold' });

    // Side circular Pavillon de l'Empereur & Pavillon des Abonnés
    for (const sy of [-1, 1]) {
      b.cylinder(-8, sy * 38, 10, 2.5, 26, STONE, 10, 14);
      b.dome(-8, sy * 38, 10, 26, 9, COPPER, 14, 4, { mat: 'metal' });
    }

    // Auditorium copper-green dome + golden crown lantern
    b.cylinder(-14, 0, 20, 29, 36, STONE, 19.5, 18);
    b.dome(-14, 0, 19.5, 36, 15, COPPER, 18, 6, { mat: 'metal' });
    b.cylinder(-14, 0, 4.5, 50, 55, GOLD, 3.5, 10, { mat: 'gold' });

    // Towering Stage Fly Tower (Cage de Scène) with copper gable & golden Apollo / Pegasus statues
    b.corniceBox(26, 0, 38, 54, 29, 49, STONE, WARM_STONE);
    b.gable(26, 0, 54, 38, 49, 10, COPPER, deg(90), { mat: 'metal' });
    // Apollo holding the golden lyre at the apex + two winged Pegasus statues at the corners
    b.cylinder(26, 0, 2.8, 58.5, 66, GOLD, 0.8, 8, { mat: 'gold' });
    for (const sy of [-1, 1]) {
      b.cylinder(-52, sy * 31, 2.5, 32, 38, GOLD, 1.2, 8, { mat: 'gold' });
      b.cylinder(26, sy * 25, 2.4, 49, 55, GOLD, 1, 8, { mat: 'gold' });
    }
    return b.build(deg(70));
  },

  // ------------------------------------------------------------------ 10. Centre Pompidou
  'Centre Pompidou': () => {
    const b = new Builder();
    // Piazza Georges-Pompidou (west plaza, +y side) & main footprint
    b.box(0, 14, 184, 104, 0, 2, PLAZA);

    // High-tech glass & steel main building volume
    b.box(0, 0, 164, 56, 2, 44, '#cfd8e3', 0, { mat: 'glass' });
    for (const z of [10, 18, 26, 34, 42]) {
      b.box(0, 0, 166, 58, z, z + 1.5, '#e2e8f0', 0, { mat: 'metal' });
    }

    // Exposed structural steel stanchions & diagonal truss bracing along both facades
    for (let i = -6; i <= 6; i++) {
      const x = i * 13;
      for (const sy of [-1, 1]) {
        b.cylinder(x, sy * 30.5, 1.1, 2, 45.5, '#f1f5f9', 1.1, 6, { mat: 'metal' });
        if (i < 6) {
          const z0 = i % 2 === 0 ? 4 : 43;
          const z1 = i % 2 === 0 ? 43 : 4;
          b.beam([x, sy * 30, z0], [x + 13, sy * 30, z1], 0.75, '#cbd5e1', 4, { mat: 'metal' });
        }
      }
    }

    // Iconic diagonal red/glass escalator tube ("La Chenille" / Caterpillar) climbing the west facade (+y)
    b.beam([-72, 33.5, 4], [72, 33.5, 43], 3.4, '#e63946', 8, { mat: 'glow' });
    b.beam([-72, 34.2, 5.2], [72, 34.2, 44.2], 2.4, GLASS, 8, { mat: 'glass', alpha: 0.75 });

    // Colour-coded service pipes & giant white/blue/green/yellow/red rooftop ventilators on the east facade (-y)
    const pipeColors = ['#1d4ed8', '#15803d', '#eab308', '#dc2626', '#1d4ed8', '#15803d'];
    for (let i = 0; i < 12; i++) {
      const x = -66 + i * 12;
      const col = pipeColors[i % pipeColors.length];
      b.cylinder(x, -30.5, 1.6, 2, 45, col, 1.6, 8, { mat: 'metal' });
    }
    // Giant rooftop L-shaped air-handling ducts & elevator towers
    for (const [vx, vy, col] of [
      [-55, 8, '#dc2626'],
      [-20, -10, '#1d4ed8'],
      [15, 10, '#15803d'],
      [50, -8, '#eab308'],
    ] as const) {
      b.cylinder(vx, vy, 5.5, 44, 53, col, 5.5, 10, { mat: 'metal' });
      b.box(vx + 3, vy, 9, 8, 49, 54, col, 0, { mat: 'metal' });
    }
    return b.build(deg(80));
  },

  // ------------------------------------------------------------------ 11. Musée d'Orsay
  "Musée d'Orsay": () => {
    const b = new Builder();
    // Seine riverside parvis
    b.box(0, 0, 194, 80, 0, 2, PLAZA);

    // Beaux-Arts limestone railway station facade
    b.corniceBox(0, 0, 176, 64, 2, 24, STONE, WARM_STONE);
    // Row of grand arched windows facing the Seine (-y side)
    for (let x = -60; x <= 60; x += 15) {
      b.box(x, -32.3, 9, 1.2, 5, 20, WARM_GLOW, 0, { mat: 'glow' });
    }

    // Grand semi-cylindrical glass & iron barrel vault over the central train hall
    b.barrelVault(0, 0, 152, 40, 24, 15, GLASS, 0, 10, {
      mat: 'glass',
      alpha: 0.85,
      stroke: 'rgba(92, 107, 120, 0.75)',
    });
    // Slate mansard side roofs flanking the glass vault
    for (const sy of [-1, 1]) {
      b.mansard(0, sy * 25, 168, 12, 24, 7, 3, SLATE);
    }

    // Twin ornate Belle Époque clock towers on the Seine corners
    for (const sx of [-1, 1]) {
      const tx = sx * 80;
      b.corniceBox(tx, -24, 18, 20, 2, 35, WARM_STONE, STONE);
      b.cylinder(tx, -34.4, 4.2, 24, 31, GOLD, 4.2, 12, { mat: 'glow' }); // glowing station clocks
      b.mansard(tx, -24, 19, 21, 35, 10, 4.5, SLATE, DARK_SLATE);
      b.cylinder(tx, -24, 2.5, 45, 51, SLATE, 0.4, 8);
    }
    return b.build(deg(-15));
  },

  // ------------------------------------------------------------------ 12. Grand Palais
  'Grand Palais': () => {
    const b = new Builder();
    const resedaGlass = '#8ecbb9';
    const resedaIron = 'rgba(72, 118, 102, 0.85)';
    b.box(0, -6, 220, 108, 0, 2.2, PLAZA);

    // Neoclassical stone colonnade walls forming a T-shaped plan
    b.corniceBox(0, 0, 200, 54, 2.2, 23, STONE, WARM_STONE);
    b.corniceBox(0, -32, 64, 54, 2.2, 23, STONE, WARM_STONE);
    // Entrance triple-arch portico with Ionic columns
    b.box(0, -60, 38, 8, 2.2, 25, WARM_STONE);
    for (const x of [-12, 0, 12]) b.box(x, -64.2, 7, 1.5, 4, 20, DARK_SLATE);

    // Famous Art Nouveau Reseda-green iron & glass barrel vaults (main nave + transept)
    b.barrelVault(0, 0, 192, 44, 23, 16, resedaGlass, 0, 10, {
      mat: 'glass',
      alpha: 0.84,
      stroke: resedaIron,
    });
    b.barrelVault(0, -28, 52, 44, 23, 15, resedaGlass, deg(90), 10, {
      mat: 'glass',
      alpha: 0.84,
      stroke: resedaIron,
    });

    // Soaring central glass & iron cupola dome + spire & French flag mast
    b.cylinder(0, 0, 24, 23, 33, resedaGlass, 22, 16, { mat: 'glass', stroke: resedaIron });
    b.dome(0, 0, 22, 33, 18, resedaGlass, 16, 6, { mat: 'glass', stroke: resedaIron });
    b.cylinder(0, 0, 4.5, 50, 56, COPPER, 3.2, 10, { mat: 'metal' });
    b.cylinder(0, 0, 1.2, 56, 65, GOLD, 0.25, 8, { mat: 'gold' });

    // Four bronze Quadriga (chariot) sculptures rearing at the corners of the facades
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        b.box(sx * 96, sy * 24, 7, 7, 23, 27, WARM_STONE);
        b.sphere(sx * 96, sy * 24, 3.8, 29, COPPER, 10, 3, { mat: 'metal' });
      }
    }
    return b.build(deg(64));
  },

  // ------------------------------------------------------------------ 13. Sainte-Chapelle
  'Sainte-Chapelle': () => {
    const b = new Builder();
    b.box(0, 0, 54, 28, 0, 2, PLAZA);

    // Lower chapel stone base (z = 2..11) & Upper chapel soaring stained-glass walls (z = 11..31)
    b.box(-2, 0, 36, 15, 2, 11, STONE);
    b.cylinder(16, 0, 7.5, 2, 11, STONE, 7.5, 12);
    // Glowing ruby & sapphire stained-glass windows of the Upper Chapel
    b.box(-2, 0, 35, 14, 11, 30, '#6d4c9e', 0, { mat: 'glow' });
    b.cylinder(16, 0, 7, 11, 30, '#6d4c9e', 7, 12, { mat: 'glow' });

    // Slender Gothic stone buttresses & spire pinnacles framing every window bay
    for (let x = -18; x <= 14; x += 6.4) {
      for (const sy of [-1, 1]) {
        b.box(x, sy * 7.8, 1.8, 2.4, 2, 32, WARM_STONE);
        b.pyramid(x, sy * 7.8, 2.2, 2.2, 32, 37.5, SLATE);
      }
    }
    // West facade double porch, Rose Window & flanking octagonal stair turrets
    b.box(-20.5, 0, 4, 15, 2, 31, STONE);
    b.cylinder(-22.6, 0, 4.2, 15, 24, '#8b5cf6', 4.2, 10, { mat: 'glow' });
    b.gable(-20.5, 0, 15, 4, 31, 11, WARM_STONE, deg(90));
    for (const sy of [-1, 1]) {
      b.cylinder(-20.5, sy * 8, 2.4, 2, 38, WARM_STONE, 2.2, 8);
      b.cylinder(-20.5, sy * 8, 2.2, 38, 46, SLATE, 0.2, 8);
    }

    // Steeply pitched slate roof + ornate 75 m cedar & lead Gothic flèche with golden angel
    b.gable(-2, 0, 36, 15, 30, 13, SLATE);
    b.dome(16, 0, 7.5, 30, 13, SLATE, 12, 4);
    b.cylinder(0, 0, 3.2, 41, 51, GOLD, 2.4, 8, { mat: 'gold' });
    b.cylinder(0, 0, 2.4, 51, 75, DARK_SLATE, 0.2, 8);
    b.sphere(0, 0, 0.9, 75.5, GOLD, 8, 3, { mat: 'gold' });
    return b.build(deg(-25));
  },

  // ------------------------------------------------------------------ 14. Place de la Concorde
  'Place de la Concorde': () => {
    const b = new Builder();
    // Grand octagonal plaza & corner sentry pavilions (Guérites featuring statues of French cities)
    b.cylinder(0, 0, 46, 0, 1.8, PLAZA, 46, 8, {}, true, deg(22.5));
    b.cylinder(0, 0, 38, 1.8, 2.5, DARK_STONE, 38, 8, {}, true, deg(22.5));
    for (let i = 0; i < 8; i++) {
      const a = deg(22.5) + (i / 8) * Math.PI * 2;
      b.box(Math.cos(a) * 41, Math.sin(a) * 41, 4.5, 4.5, 1.8, 7.5, WARM_STONE, a);
    }

    // Luxor Obelisk (Obélisque de Louxor) at the centre: stepped granite pedestal + pink granite shaft + gold pyramidion
    b.box(0, 0, 9, 9, 2.5, 5, STONE);
    b.box(0, 0, 6, 6, 5, 11, WARM_STONE);
    b.taper(0, 0, 3.6, 3.6, 11, 2.2, 2.2, 33, '#dfb499');
    b.pyramid(0, 0, 2.2, 2.2, 33, 37.5, GOLD, 0, { mat: 'gold' });

    // Twin monumental fountains (Fontaine des Mers & Fontaine des Fleuves) north and south of the Obelisk
    for (const sy of [-1, 1]) {
      const fy = sy * 23;
      b.cylinder(0, fy, 10.5, 2.5, 4.2, STONE, 10.5, 16);
      b.cylinder(0, fy, 9.2, 4.2, 4.8, WATER, 9.2, 16, { mat: 'water' });
      b.cylinder(0, fy, 2.6, 4.8, 9.5, COPPER, 2, 10, { mat: 'metal' });
      b.cylinder(0, fy, 5.5, 9, 10.2, COPPER, 4.5, 12, { mat: 'metal' });
      b.cylinder(0, fy, 1.6, 10.2, 13.5, COPPER, 1.2, 8, { mat: 'metal' });
      b.cylinder(0, fy, 3.2, 13, 14, GOLD, 2.5, 10, { mat: 'gold' });
      b.dome(0, fy, 2.2, 14, 3, '#bae6fd', 10, 3, { mat: 'glass', alpha: 0.75 });
    }
    return b.build(deg(-16));
  },

  // ------------------------------------------------------------------ 15. Place de la Bastille
  'Place de la Bastille': () => {
    const b = new Builder();
    // Circular plaza paved with the outline of the old Bastille fortress
    b.cylinder(0, 0, 26, 0, 2, PLAZA, 26, 20);
    b.cylinder(0, 0, 17, 2, 4.5, DARK_STONE, 17, 16);

    // Square white-marble & red-granite vaulted pedestal with corner bronze Gallic roosters & lion relief
    b.box(0, 0, 15, 15, 4.5, 9, '#b87d6d');
    b.corniceBox(0, 0, 11.5, 11.5, 9, 16, STONE, WARM_STONE);
    for (const [sx, sy] of corners) {
      b.sphere(sx * 5.2, sy * 5.2, 1.1, 16.5, COPPER, 8, 2, { mat: 'metal' });
    }

    // Colonne de Juillet: bronze shaft divided by 3 golden commemorative rings for 1830 revolutionaries
    b.cylinder(0, 0, 4.2, 16, 18.5, COPPER, 3.5, 14, { mat: 'metal' });
    b.cylinder(0, 0, 2.7, 18.5, 45, COPPER, 2.3, 14, { mat: 'metal' });
    for (const z of [26, 34, 41]) {
      b.cylinder(0, 0, 3.05, z, z + 1.4, GOLD, 3.05, 14, { mat: 'gold' });
    }

    // Corinthian capital, circular viewing balcony lantern & winged golden Génie de la Liberté (50 m)
    b.cylinder(0, 0, 2.5, 45, 48, COPPER, 4.5, 14, { mat: 'metal' });
    b.cylinder(0, 0, 4.8, 48, 49.5, WARM_STONE, 4.8, 14);
    b.dome(0, 0, 3.2, 49.5, 3.5, COPPER, 12, 4, { mat: 'metal' });
    b.sphere(0, 0, 1.5, 54, GOLD, 10, 3, { mat: 'gold' });
    // Winged Génie de la Liberté figure + outstretched wings + raised torch
    b.cylinder(0, 0, 0.9, 55, 60.5, GOLD, 0.5, 8, { mat: 'gold' });
    b.beam([-3.8, 0.5, 58], [3.8, 0.5, 59.5], 0.65, GOLD, 4, { mat: 'gold' });
    b.sphere(1.6, 0, 0.85, 61.5, '#ffdf6b', 8, 2, { mat: 'glow' });
    return b.build(0);
  },

  // ------------------------------------------------------------------ 16. Moulin Rouge
  'Moulin Rouge': () => {
    const b = new Builder();
    const crimson = '#c9182b';
    const darkRed = '#800f1b';
    const neonRed = '#ff3b56';
    b.box(0, 2, 48, 28, 0, 1.8, PLAZA);

    // Belle Époque cabaret theatre hall & entrance marquee
    b.corniceBox(0, 5, 38, 17, 1.8, 13, PALE, crimson);
    b.box(0, -4, 24, 3, 1.8, 10, crimson);
    // Glowing neon "MOULIN ROUGE" rooftop sign & entrance canopy
    b.box(0, -5.8, 16, 2.2, 5.5, 8, WARM_GLOW, 0, { mat: 'glow' });
    b.box(0, -3.2, 32, 1.5, 13.5, 17, neonRed, 0, { mat: 'glow' });

    // Iconic Red Windmill Tower (octagonal tapered body + domed cap)
    b.cylinder(0, 3, 7.2, 1.8, 12, crimson, 6.5, 8);
    b.cylinder(0, 3, 6.5, 12, 24, crimson, 5.2, 8);
    for (const z of [12, 18, 24]) b.cylinder(0, 3, 6.7 - (z - 12) * 0.1, z, z + 0.9, darkRed, 6.7 - (z - 12) * 0.1, 8);
    b.dome(0, 3, 5.6, 24, 6.5, darkRed, 10, 4);
    b.cylinder(0, 3, 0.8, 30.5, 34, GOLD, 0.2, 6, { mat: 'gold' });

    // Hub protruding from the front (-y) of the windmill at (0, -3.2, 21) + 4 diagonal lattice sails (45° X-shape)
    const hy = -3.2;
    const hz = 21;
    b.beam([0, 2, hz], [0, hy - 1.5, hz], 1.4, GOLD, 8, { mat: 'gold' });
    for (const degAngle of [45, 135, 225, 315]) {
      const a = deg(degAngle);
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const nx = -dz;
      const nz = dx;
      // Main wooden/red spar arm from radius 0 to 16.5 m
      b.beam([0, hy, hz], [dx * 16.5, hy, hz + dz * 16.5], 0.65, neonRed, 6, { mat: 'glow' });
      // Lattice sail blade offset along the spar (r = 3.5..16 m, width = 3.4 m)
      const r0 = 3.5;
      const r1 = 16;
      const w = 3.2;
      b.poly(
        [
          [dx * r0 - nx * 0.4, hy - 0.2, hz + dz * r0 - nz * 0.4],
          [dx * r1 - nx * 0.4, hy - 0.2, hz + dz * r1 - nz * 0.4],
          [dx * r1 + nx * w, hy - 0.2, hz + dz * r1 + nz * w],
          [dx * r0 + nx * w, hy - 0.2, hz + dz * r0 + nz * w],
        ],
        neonRed,
        { mat: 'glow', twoSided: true, alpha: 0.9, stroke: '#ffd166' },
      );
    }
    return b.build(deg(-10));
  },

  // ------------------------------------------------------------------ 17. Trocadéro (Palais de Chaillot)
  'Trocadéro': () => {
    const b = new Builder();
    // Parvis des Droits de l'Homme terrace & curved promenade
    b.box(0, 0, 90, 220, 0, 3, PLAZA);

    // Warsaw Fountains (Fontaine de Varsovie) cascading down towards the Eiffel Tower (+x direction)
    b.box(26, 0, 52, 34, 1, 2.8, STONE);
    b.box(26, 0, 46, 26, 2.8, 3.6, WATER, 0, { mat: 'water' });
    for (let x = 8; x <= 42; x += 8.5) {
      for (const sy of [-1, 1]) {
        b.dome(x, sy * 11, 2.6, 3.6, 4.5, '#e0f2fe', 8, 3, { mat: 'glass', alpha: 0.72 });
      }
    }

    // Twin monumental Neoclassical pavilions framing the central esplanade + sweeping curved colonnade wings
    for (const sy of [-1, 1]) {
      // Main head pavilion flanking the Parvis
      b.corniceBox(6, sy * 32, 32, 32, 3, 29, PALE, WARM_STONE);
      b.box(6, sy * 32, 26, 26, 29, 33, STONE);
      // Golden statues lining the pavilion terrace
      for (let i = -2; i <= 2; i++) {
        b.cylinder(21, sy * (32 + i * 5), 1, 29, 33.5, GOLD, 0.5, 6, { mat: 'gold' });
      }
      // Sweeping curved wing (4 segments curving back and outward)
      const segs = [
        [2, 54, -10],
        [-5, 76, -22],
        [-15, 96, -34],
        [-28, 114, -46],
      ];
      for (const [wx, wy, ang] of segs) {
        b.corniceBox(wx, sy * wy, 24, 26, 3, 22, PALE, WARM_STONE, deg(sy * ang));
      }
      // End anchor pavilion
      b.corniceBox(-36, sy * 126, 28, 28, 3, 26, PALE, WARM_STONE, deg(sy * -50));
    }
    return b.build(deg(-45));
  },

  // ------------------------------------------------------------------ 18. Parc de la Villette (La Géode & Folies)
  'Parc de la Villette': () => {
    const b = new Builder();
    // Circular mirrored water basin & Cité des Sciences plaza
    b.box(-8, 0, 96, 84, 0, 1.8, PLAZA);
    b.cylinder(6, 0, 28, 1.8, 2.8, STONE, 28, 24);
    b.cylinder(6, 0, 25, 2.8, 3.5, WATER, 25, 24, { mat: 'water' });

    // La Géode: 36 m mirrored stainless-steel geodesic sphere floating over the water basin
    b.cylinder(6, 0, 9, 3.5, 7, DARK_SLATE, 11, 16);
    b.sphere(6, 0, 18.5, 20.5, '#d8e4f0', 22, 8, {
      mat: 'metal',
      stroke: 'rgba(255, 255, 255, 0.45)',
    });

    // Bernard Tschumi's iconic bright-red deconstructivist Folie cube & promenade bridge
    const folieRed = '#e11d48';
    b.box(-32, -16, 16, 16, 1.8, 18, folieRed, 0, { mat: 'metal' });
    b.box(-32, -16, 20, 4, 18, 24, folieRed, deg(25), { mat: 'metal' });
    b.cylinder(-24, -10, 4.5, 1.8, 21, folieRed, 4.5, 10, { mat: 'metal' });
    // Elevated walkway bridge linking the Folie toward the basin
    b.box(-16, -16, 28, 4.5, 8, 10, '#94a3b8', 0, { mat: 'metal' });
    b.tree(-34, 18, 1.8, 12, 5.5).tree(-22, 24, 1.8, 10, 4.8);
    return b.build(0);
  },

  // ------------------------------------------------------------------ 19. Jardin du Luxembourg (Palais du Luxembourg & Grand Bassin)
  'Jardin du Luxembourg': () => {
    const b = new Builder();
    // French formal garden parterres & gravel terrace
    b.box(0, 0, 136, 150, 0, 2, PLAZA);
    for (const sx of [-1, 1]) {
      b.box(sx * 44, -22, 28, 56, 2, 3.2, LAWN, 0, { mat: 'foliage' });
      for (let y = -44; y <= 0; y += 14) b.tree(sx * 44, y, 3.2, 11, 4.8);
    }

    // Famous octagonal Grand Bassin pond & central water jet in front of the palace (-y)
    b.cylinder(0, -26, 22, 2, 3.6, STONE, 22, 8, {}, true, deg(22.5));
    b.cylinder(0, -26, 19.5, 3.6, 4.3, WATER, 19.5, 8, { mat: 'water' }, true, deg(22.5));
    b.cylinder(0, -26, 2.5, 4.3, 8, STONE, 1.2, 10);
    b.dome(0, -26, 2.2, 8, 4, '#bae6fd', 8, 3, { mat: 'glass', alpha: 0.75 });

    // Palais du Luxembourg (Marie de' Medici's palace, now the French Senate) on the north side (+y)
    // Main corps de logis
    b.corniceBox(0, 38, 86, 22, 2, 22, STONE, WARM_STONE);
    b.mansard(0, 38, 86, 22, 22, 7.5, 3.5, SLATE);
    // Flanking courtyard wings & 4 corner pavilions with tall mansard roofs
    for (const sx of [-1, 1]) {
      b.corniceBox(sx * 36, 18, 14, 34, 2, 19, STONE, WARM_STONE);
      b.mansard(sx * 36, 18, 14, 34, 19, 6, 3, SLATE);
      for (const py of [2, 38]) {
        b.corniceBox(sx * 38, py, 20, 20, 2, 25, WARM_STONE, STONE);
        b.mansard(sx * 38, py, 21, 21, 25, 9.5, 4, SLATE, DARK_SLATE);
      }
    }
    // Front entrance screen & iconic central hexagonal clock dome (Dôme Tournon)
    b.corniceBox(0, 2, 62, 8, 2, 14, STONE, WARM_STONE);
    b.cylinder(0, 2, 8.5, 14, 23, WARM_STONE, 8, 12);
    b.dome(0, 2, 8.2, 23, 10, SLATE, 12, 5);
    b.cylinder(0, 2, 2, 32.5, 38, GOLD, 0.4, 8, { mat: 'gold' });
    return b.build(deg(-12));
  },

  // ------------------------------------------------------------------ 20. Jardin des Tuileries (Grand Bassin & Arc du Carrousel)
  'Jardin des Tuileries': () => {
    const b = new Builder();
    // Grand central axe historique gravel promenade & symmetrical French parterre lawns
    b.box(0, 0, 160, 106, 0, 2, PLAZA);
    for (const sy of [-1, 1]) {
      b.box(-22, sy * 30, 86, 28, 2, 3, LAWN, 0, { mat: 'foliage' });
      for (let x = -56; x <= 12; x += 17) {
        b.tree(x, sy * 22, 3, 11, 4.5, '#356f42');
        b.tree(x, sy * 38, 3, 12, 5, '#2b5e37');
      }
    }

    // Grand Bassin Rond (large circular fountain basin with green chairs & high central jet)
    b.cylinder(-22, 0, 19, 2, 3.6, STONE, 19, 20);
    b.cylinder(-22, 0, 16.8, 3.6, 4.3, WATER, 16.8, 20, { mat: 'water' });
    b.dome(-22, 0, 2.8, 4.3, 6.5, '#bae6fd', 10, 3, { mat: 'glass', alpha: 0.78 });

    // Arc de Triomphe du Carrousel at the eastern end (+x) with pink marble columns & golden Quadriga
    const ax = 48;
    for (const sy of [-9.5, -3.2, 3.2, 9.5]) {
      b.box(ax, sy, 11, 3.2, 2, 14, STONE);
      b.cylinder(ax - 6, sy, 0.85, 2, 14, '#d48c84', 0.8, 8);
      b.cylinder(ax + 6, sy, 0.85, 2, 14, '#d48c84', 0.8, 8);
    }
    b.corniceBox(ax, 0, 12, 23, 14, 19.5, WARM_STONE, STONE);
    b.box(ax, 0, 9.5, 19, 19.5, 23, STONE);
    // Peace riding in a triumphal bronze & gold four-horse chariot (Quadriga) on top
    b.box(ax, 0, 5.5, 7.5, 23, 25, WARM_STONE);
    b.sphere(ax, 0, 2.8, 27, GOLD, 10, 3, { mat: 'gold' });
    for (const hy of [-3.2, -1.1, 1.1, 3.2]) {
      b.box(ax - 2.2, hy, 3.2, 1.1, 25, 28, COPPER, 0, { mat: 'metal' });
    }
    return b.build(deg(-26));
  },

  // ------------------------------------------------------------------ 21. Champs-Élysées (Avenue & Rond-Point Fountains)
  'Champs-Élysées': () => {
    const b = new Builder();
    // Grand tree-lined promenade & Rond-Point des Champs-Élysées plaza
    b.box(0, 0, 156, 92, 0, 2, PLAZA);
    b.box(0, 0, 154, 28, 2, 2.6, '#262c36'); // central avenue roadway

    // Double rows of manicured Haussmann plane trees + warm golden streetlamps + green Paris kiosks
    for (const sy of [-1, 1]) {
      b.box(0, sy * 30, 148, 24, 2, 2.8, LAWN, 0, { mat: 'foliage' });
      for (let x = -64; x <= 64; x += 16) {
        if (Math.abs(x) < 18) continue;
        b.tree(x, sy * 22, 2.8, 12.5, 5, '#3b7a4a');
        b.tree(x, sy * 35, 2.8, 13.5, 5.4, '#2f663d');
        // Iconic cast-iron streetlamp glow
        b.cylinder(x, sy * 15.5, 0.45, 2.6, 8, DARK_SLATE, 0.35, 6);
        b.sphere(x, sy * 15.5, 1.1, 8.5, WARM_GLOW, 8, 2, { mat: 'glow' });
      }
      // Classic green Parisian newspaper Kiosque & Colonne Morris
      b.cylinder(sy * 38, sy * 18, 3.5, 2.8, 8.5, '#1e4d3b', 3.5, 8);
      b.dome(sy * 38, sy * 18, 3.8, 8.5, 3.2, COPPER, 8, 3, { mat: 'metal' });
      // Rond-Point crystal mirror fountains on the north and south plazas
      const fy = sy * 27;
      b.cylinder(0, fy, 11.5, 2.8, 4.2, STONE, 11.5, 16);
      b.cylinder(0, fy, 10, 4.2, 4.8, WATER, 10, 16, { mat: 'water' });
      b.cylinder(0, fy, 2.2, 4.8, 13, GLASS, 0.8, 10, { mat: 'glow' });
      b.dome(0, fy, 4, 4.8, 6, '#bae6fd', 10, 3, { mat: 'glass', alpha: 0.72 });
    }
    return b.build(deg(-26));
  },

  // ------------------------------------------------------------------ 22. Père-Lachaise (Chapel, Crematorium & Historic Monuments)
  'Père-Lachaise': () => {
    const b = new Builder();
    // Wooded hilltop cemetery terraces & cobbled avenues
    b.box(0, 0, 116, 96, 0, 2.5, PLAZA);
    b.box(0, 0, 106, 86, 2.5, 4.5, LAWN, 0, { mat: 'foliage' });
    b.box(0, 0, 104, 14, 4.5, 5.2, DARK_STONE).box(0, 0, 14, 84, 4.5, 5.2, DARK_STONE);

    // Neo-Byzantine brick & stone Crematorium (Columbarium) with copper domes & twin tall chimneys
    const cx = 18;
    const cy = 16;
    b.corniceBox(cx, cy, 32, 26, 4.5, 19, '#b5654d', WARM_STONE);
    b.cylinder(cx, cy, 9.5, 19, 24, STONE, 9, 14);
    b.dome(cx, cy, 9.2, 24, 9.5, COPPER, 14, 5, { mat: 'metal' });
    for (const sx of [-1, 1]) {
      b.dome(cx + sx * 11, cy, 4.8, 19, 5, COPPER, 10, 3, { mat: 'metal' });
      b.cylinder(cx + sx * 13, cy + 9, 2.2, 19, 36, '#9e503b', 1.5, 10);
      b.cylinder(cx + sx * 13, cy + 9, 2, 36, 38, DARK_STONE, 2, 10);
    }

    // Neoclassical main Chapel of Père-Lachaise at (-22, 0)
    b.box(-22, 0, 22, 16, 5.2, 19, STONE);
    b.gable(-22, 0, 22, 16, 19, 5.5, SLATE);
    for (const y of [-5, -1.7, 1.7, 5]) b.cylinder(-10.5, y, 0.9, 5.2, 18, WARM_STONE, 0.85, 8);

    // Cluster of iconic gothic mausoleums, obelisks & dark cypress trees
    for (const [mx, my, mh] of [
      [-26, -24, 14],
      [-12, -26, 17],
      [14, -22, 15],
      [32, -18, 13],
      [-34, 22, 16],
    ]) {
      b.box(mx, my, 5, 5, 4.5, mh, STONE);
      b.pyramid(mx, my, 5.4, 5.4, mh, mh + 5, WARM_STONE);
    }
    for (const [tx, ty] of [
      [-40, -14],
      [-38, 12],
      [-8, 28],
      [38, 12],
      [26, -28],
      [-20, -14],
    ]) {
      // Tall slender dark-green cemetery cypress trees
      b.cylinder(tx, ty, 2.2, 4.5, 21, '#1e462f', 0.4, 8, { mat: 'foliage' });
    }
    return b.build(deg(15));
  },

  // ------------------------------------------------------------------ 23. Place des Vosges
  'Place des Vosges': () => {
    const b = new Builder();
    const brick = '#c85a48';
    // Perfectly symmetrical 17th-century royal square enclosure
    b.box(0, 0, 108, 108, 0, 2, PLAZA);
    b.box(0, 0, 68, 68, 2, 3, LAWN, 0, { mat: 'foliage' });
    b.box(0, 0, 68, 10, 3, 3.4, STONE).box(0, 0, 10, 68, 3, 3.4, STONE);

    // Four circular courtyard fountains + equestrian statue of Louis XIII at the exact centre
    for (const [sx, sy] of corners) {
      b.cylinder(sx * 19, sy * 19, 6.2, 3, 4.4, STONE, 6.2, 12);
      b.cylinder(sx * 19, sy * 19, 5, 4.4, 5, WATER, 5, 12, { mat: 'water' });
    }
    b.box(0, 0, 6, 4.5, 3.4, 8.5, PALE);
    b.box(0, 0, 4.2, 2.2, 8.5, 13, PALE);

    // Ring of linden trees framing the inner garden
    for (let i = -24; i <= 24; i += 16) {
      for (const s of [-1, 1]) {
        b.tree(i, s * 28, 3, 9.5, 3.8);
        b.tree(s * 28, i, 3, 9.5, 3.8);
      }
    }

    // Four surrounding red-brick & stone-quoined arcade wings with steep blue-slate Mansard roofs
    for (const s of [-1, 1]) {
      b.corniceBox(0, s * 44, 102, 14, 2, 17, brick, WARM_STONE);
      b.mansard(0, s * 44, 102, 14, 17, 7.5, 3.2, SLATE, DARK_SLATE);
      b.corniceBox(s * 44, 0, 14, 74, 2, 17, brick, WARM_STONE);
      b.mansard(s * 44, 0, 14, 74, 17, 7.5, 3.2, SLATE, DARK_SLATE);
      // Taller Pavillon du Roi (South) & Pavillon de la Reine (North) over the central arches
      b.corniceBox(0, s * 44, 20, 16, 2, 21, brick, WARM_STONE);
      b.mansard(0, s * 44, 21, 17, 21, 9.5, 4, SLATE, DARK_SLATE);
    }
    return b.build(deg(15));
  },

  // ------------------------------------------------------------------ 24. Buttes-Chaumont (Île de la Belvédère & Temple de la Sibylle)
  'Buttes-Chaumont': () => {
    const b = new Builder();
    // Picturesque lake basin & surrounding green park shore
    b.cylinder(0, 0, 52, 0, 2, LAWN, 52, 20, { mat: 'foliage' });
    b.cylinder(0, 0, 44, 2, 3, WATER, 44, 20, { mat: 'water' });

    // Dramatic 30 m craggy limestone cliff island (Île de la Belvédère) rising out of the lake
    b.cylinder(-4, 2, 24, 3, 14, '#8d8678', 19, 12);
    b.cylinder(-6, 4, 18, 14, 25, '#9e9686', 13, 10);
    b.cylinder(-6, 4, 13, 25, 34, '#afa796', 9.5, 10);
    // Secondary rocky peak across the ravine
    b.cylinder(22, -10, 13, 3, 18, '#8d8678', 9, 10);
    b.tree(22, -10, 18, 10, 4.5).tree(-16, -6, 14, 10, 4.2);

    // Eiffel's suspension footbridge spanning high across the chasm between the two cliffs
    b.beam([-6, 4, 23], [22, -10, 18], 1.6, IRON, 6, { mat: 'metal' });
    for (const [px, py, pz] of [
      [-6, 4, 23],
      [22, -10, 18],
    ]) {
      b.box(px, py, 3.5, 3.5, pz, pz + 7, STONE);
    }

    // Temple de la Sibylle (Corinthian rotunda belvedere) perched at the very top of the cliff (z = 34..49)
    const tx = -6;
    const ty = 4;
    b.cylinder(tx, ty, 7.5, 34, 37, STONE, 7.2, 14);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.cylinder(tx + Math.cos(a) * 5.8, ty + Math.sin(a) * 5.8, 0.85, 37, 45, PALE, 0.8, 8);
    }
    b.cylinder(tx, ty, 6.8, 45, 47, WARM_STONE, 6.5, 14);
    b.dome(tx, ty, 6.4, 47, 5.5, STONE, 14, 4);
    return b.build(0);
  },

  // ------------------------------------------------------------------ 25. Jardin des Plantes (Grande Galerie de l'Évolution & Grandes Serres)
  'Jardin des Plantes': () => {
    const b = new Builder();
    // Botanical garden perspective avenues & flower parterres
    b.box(0, 0, 150, 96, 0, 2, PLAZA);
    for (const sy of [-1, 1]) {
      b.box(24, sy * 18, 76, 18, 2, 2.8, LAWN, 0, { mat: 'foliage' });
      for (let x = -8; x <= 56; x += 16) b.tree(x, sy * 34, 2, 11.5, 4.6);
    }

    // Grande Galerie de l'Évolution (Natural History Museum palace at the west end, -x)
    const gx = -38;
    b.corniceBox(gx, 0, 56, 38, 2, 26, STONE, WARM_STONE);
    // Glass-roofed central exhibition hall + flanking stone pavilions
    b.barrelVault(gx, 0, 46, 24, 26, 9, GLASS, 0, 8, {
      mat: 'glass',
      alpha: 0.85,
      stroke: 'rgba(92, 107, 120, 0.7)',
    });
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        b.corniceBox(gx + sx * 24, sy * 16, 14, 12, 2, 29, WARM_STONE, STONE);
        b.mansard(gx + sx * 24, sy * 16, 15, 13, 29, 7, 3, SLATE);
      }
    }

    // Grandes Serres (Art Deco & iron/glass botanical conservatories along the north side, +y)
    const emeraldGlass = '#6ee7b7';
    const ironFrame = 'rgba(45, 90, 68, 0.8)';
    b.box(20, 32, 64, 18, 2, 8, STONE);
    b.barrelVault(20, 32, 60, 16, 8, 9, emeraldGlass, 0, 8, {
      mat: 'glass',
      alpha: 0.82,
      stroke: ironFrame,
    });
    b.cylinder(-4, 32, 10, 2, 11, STONE, 10, 12);
    b.dome(-4, 32, 9.8, 11, 11, emeraldGlass, 12, 5, {
      mat: 'glass',
      alpha: 0.84,
      stroke: ironFrame,
    });
    return b.build(deg(-28));
  },

  // ------------------------------------------------------------------ 26. Canal Saint-Martin (Canal Lock & Arched Cast-Iron Footbridges)
  'Canal Saint-Martin': () => {
    const b = new Builder();
    // Stone canal quays & tree-lined cobble promenades
    b.box(0, 0, 128, 72, 0, 4, PLAZA);
    // Deep recessed water channel with a stepped double lock (Écluse des Récollets)
    b.box(-30, 0, 64, 26, 0.2, 3.2, WATER, 0, { mat: 'water' });
    b.box(32, 0, 60, 26, 0.2, 2.2, WATER, 0, { mat: 'water' });
    // Lock gates (portes d'écluse) in the middle
    b.box(2, 6, 3, 14, 1, 5, DARK_SLATE, deg(22));
    b.box(2, -6, 3, 14, 1, 5, DARK_SLATE, deg(-22));

    // Iconic high-arched green cast-iron pedestrian footbridges (Passerelles) spanning the canal
    const bridgeGreen = '#3f6a58';
    for (const bx of [-24, 28]) {
      // Stepped stone abutments on both banks
      for (const sy of [-1, 1]) {
        b.box(bx, sy * 16.5, 8, 7, 4, 10, STONE);
      }
      // High-arched iron walkway & lattice railings over the canal
      const segs = 6;
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs;
        const t1 = (i + 1) / segs;
        const y0 = -15 + t0 * 30;
        const y1 = -15 + t1 * 30;
        const z0 = 9.5 + Math.sin(t0 * Math.PI) * 7.5;
        const z1 = 9.5 + Math.sin(t1 * Math.PI) * 7.5;
        b.beam([bx, y0, z0], [bx, y1, z1], 2.2, bridgeGreen, 6, { mat: 'metal' });
        b.beam([bx - 2, y0, z0 + 2.2], [bx - 2, y1, z1 + 2.2], 0.55, '#689f87', 4, { mat: 'metal' });
        b.beam([bx + 2, y0, z0 + 2.2], [bx + 2, y1, z1 + 2.2], 0.55, '#689f87', 4, { mat: 'metal' });
      }
    }

    // Péniche (canal barge) passing through the western basin + rows of chestnut trees along the quays
    b.box(-34, -3, 22, 5.2, 2.8, 5.2, '#334155');
    b.box(-34, -3, 14, 4, 5.2, 6.8, PALE);
    for (let x = -52; x <= 52; x += 20) {
      for (const sy of [-1, 1]) {
        b.tree(x, sy * 24, 4, 12, 4.8);
      }
    }
    return b.build(deg(78));
  },
};

const cache = new Map<string, Model | null>();
export function landmarkModel(name: string): Model | null {
  let m = cache.get(name);
  if (m === undefined) cache.set(name, (m = BUILDERS[name]?.() ?? null));
  return m;
}

/**
 * How much to enlarge a model at zoom `k` (pixels per metre). Landmarks are drawn true to size when
 * zoomed in and grow into icons when zoomed out, so they stay recognisable on the city overview.
 */
export function landmarkScale(m: Model, k: number) {
  const size = Math.max(m.height, m.radius * 1.4);
  const minPx = 15 + 2.75 * size ** 0.35;
  return Math.max(1, minPx / (k * size));
}
