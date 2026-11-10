/**
 * Small hand-built 3D models of the main landmarks, drawn on top of the flat map.
 *
 * The map is seen from straight above, so the models use an oblique projection: a point's height
 * simply shifts it up the screen (north). Because that view direction never changes, faces are
 * shaded and depth-sorted once when a model is built; drawing is then just filling polygons.
 *
 * Model coordinates are metres: x along the building's main axis, y to its left, z up.
 */

/** Screen shift per metre of height, relative to a metre on the ground. */
export const Z_SCALE = 0.85;
const LIGHT = normalize([-0.45, -0.35, 0.82]); // from the south-west, high up
const VIEW: Vec3 = [0, -Z_SCALE, 1]; // towards the viewer

type Vec2 = [number, number];
type Vec3 = [number, number, number];

export interface Face {
  /** flat x, y, z */
  pts: number[];
  fill: string;
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

function rect(cx: number, cy: number, w: number, d: number, rot = 0): Vec2[] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as Vec2[]).map(([u, v]) => {
    const x = (u * w) / 2;
    const y = (v * d) / 2;
    return [cx + x * c - y * s, cy + x * s + y * c];
  });
}
function ngon(cx: number, cy: number, r: number, n: number): Vec2[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Vec2;
  });
}

class Builder {
  private polys: { pts: Vec3[]; color: string }[] = [];

  poly(pts: Vec3[], color: string) {
    this.polys.push({ pts, color });
    return this;
  }
  /** Solid between a bottom outline at z0 and a top outline (same point count) at z1. */
  loft(bottom: Vec2[], z0: number, top: Vec2[], z1: number, color: string) {
    const n = bottom.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.poly([[...bottom[i], z0], [...bottom[j], z0], [...top[j], z1], [...top[i], z1]], color);
    }
    return this.poly(top.map((p) => [...p, z1] as Vec3), color);
  }
  box(cx: number, cy: number, w: number, d: number, z0: number, z1: number, color: string, rot = 0) {
    const r = rect(cx, cy, w, d, rot);
    return this.loft(r, z0, r, z1, color);
  }
  /** Rectangular solid that tapers from (w0, d0) at z0 to (w1, d1) at z1. */
  taper(cx: number, cy: number, w0: number, d0: number, z0: number, w1: number, d1: number, z1: number, color: string, rot = 0) {
    return this.loft(rect(cx, cy, w0, d0, rot), z0, rect(cx, cy, w1, d1, rot), z1, color);
  }
  cylinder(cx: number, cy: number, r0: number, z0: number, z1: number, color: string, r1 = r0, n = 14) {
    return this.loft(ngon(cx, cy, r0, n), z0, ngon(cx, cy, r1, n), z1, color);
  }
  /** Half-ellipsoid of radius r and height h sitting on z0. */
  dome(cx: number, cy: number, r: number, z0: number, h: number, color: string, n = 14, bands = 5) {
    for (let b = 0; b < bands; b++) {
      const a0 = (b / bands) * (Math.PI / 2);
      const a1 = ((b + 1) / bands) * (Math.PI / 2);
      this.loft(ngon(cx, cy, r * Math.cos(a0), n), z0 + h * Math.sin(a0), ngon(cx, cy, Math.max(0.01, r * Math.cos(a1)), n), z0 + h * Math.sin(a1), color);
    }
    return this;
  }
  sphere(cx: number, cy: number, r: number, zc: number, color: string) {
    this.dome(cx, cy, r, zc, r, color);
    return this.dome(cx, cy, r, zc, -r, color);
  }
  /** Pitched roof over a rectangle, ridge along the rectangle's long (w) side. */
  gable(cx: number, cy: number, w: number, d: number, z0: number, h: number, color: string, rot = 0) {
    const [a, b, c, e] = rect(cx, cy, w, d, rot);
    const [r1, r2] = rect(cx, cy, w, 0, rot); // ridge ends
    const z1 = z0 + h;
    this.poly([[...a, z0], [...b, z0], [...r2, z1], [...r1, z1]], color);
    this.poly([[...c, z0], [...e, z0], [...r1, z1], [...r2, z1]], color);
    this.poly([[...a, z0], [...r1, z1], [...e, z0]], color);
    return this.poly([[...b, z0], [...c, z0], [...r2, z1]], color);
  }

  /** Rotate the whole model by `rot` (radians, counter-clockwise from east), then shade and sort. */
  build(rot: number): Model {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    let height = 0;
    let radius = 0;
    const faces = this.polys.map(({ pts, color }) => {
      const p = pts.map(([x, y, z]) => [x * c - y * s, x * s + y * c, z] as Vec3);
      // Newell's method: robust normal for any planar polygon.
      const n: Vec3 = [0, 0, 0];
      let depth = 0;
      p.forEach((a, i) => {
        const b = p[(i + 1) % p.length];
        n[0] += (a[1] - b[1]) * (a[2] + b[2]);
        n[1] += (a[2] - b[2]) * (a[0] + b[0]);
        n[2] += (a[0] - b[0]) * (a[1] + b[1]);
        depth += a[1] * VIEW[1] + a[2] * VIEW[2];
        height = Math.max(height, a[2]);
        radius = Math.max(radius, Math.hypot(a[0], a[1]));
      });
      let unit = normalize(n);
      // Faces pointing away are hidden behind nearer ones, so light every face as if it faced the viewer.
      if (unit[0] * VIEW[0] + unit[1] * VIEW[1] + unit[2] * VIEW[2] < 0) unit = [-unit[0], -unit[1], -unit[2]];
      const lit = 0.5 + 0.5 * Math.max(0, unit[0] * LIGHT[0] + unit[1] * LIGHT[1] + unit[2] * LIGHT[2]);
      const v = parseInt(color.slice(1), 16);
      const ch = (shift: number) => Math.round(((v >> shift) & 255) * lit);
      return { pts: p.flat(), fill: `rgb(${ch(16)},${ch(8)},${ch(0)})`, depth: depth / p.length };
    });
    faces.sort((a, b) => a.depth - b.depth);
    return { faces: faces.map(({ pts, fill }) => ({ pts, fill })), height, radius };
  }
}

const deg = (d: number) => (d * Math.PI) / 180;
const STONE = '#d9cfb6';
const PALE = '#efe9da';
const SLATE = '#66747f';
const GOLD = '#d9b33c';
const corners: Vec2[] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];

/** Keyed by the landmark names used in the city data. */
const BUILDERS: Record<string, () => Model> = {
  'Tour Eiffel': () => {
    const b = new Builder();
    const iron = '#a98862';
    for (const [sx, sy] of corners) {
      b.loft(rect(sx * 50, sy * 50, 25, 25), 0, rect(sx * 24, sy * 24, 17, 17), 57, iron);
      b.loft(rect(sx * 23, sy * 23, 15, 15), 62, rect(sx * 12, sy * 12, 11, 11), 115, iron);
    }
    b.box(0, 0, 70, 70, 55, 62, iron).box(0, 0, 40, 40, 113, 119, iron);
    b.taper(0, 0, 30, 30, 119, 14, 14, 190, iron).taper(0, 0, 14, 14, 190, 7, 7, 276, iron);
    b.box(0, 0, 11, 11, 276, 285, iron).taper(0, 0, 3, 3, 285, 0.6, 0.6, 324, iron);
    return b.build(deg(-42));
  },
  'Arc de Triomphe': () =>
    new Builder()
      .box(-15.5, 0, 14, 22, 0, 29, STONE)
      .box(15.5, 0, 14, 22, 0, 29, STONE)
      .box(0, 0, 45, 22, 29, 46, STONE)
      .box(0, 0, 41, 19, 46, 50, STONE)
      .build(deg(64)),
  'Notre-Dame': () => {
    const b = new Builder();
    b.box(8, 0, 100, 28, 0, 33, STONE).gable(8, 0, 100, 28, 33, 10, SLATE);
    b.box(14, 0, 14, 48, 0, 33, STONE).gable(14, 0, 48, 14, 33, 10, SLATE, deg(90));
    b.box(-48, 0, 13, 12, 0, 43, STONE);
    b.box(-48, 13, 13, 13, 0, 69, STONE).box(-48, -13, 13, 13, 0, 69, STONE);
    b.cylinder(14, 0, 3, 43, 96, SLATE, 0.2, 8);
    return b.build(deg(-25));
  },
  'Sacré-Cœur': () => {
    const b = new Builder();
    b.box(0, 0, 80, 50, 0, 30, PALE).box(-44, 0, 8, 30, 0, 20, PALE);
    for (const [sx, sy] of corners) b.cylinder(sx * 18, sy * 17, 5, 30, 40, PALE).dome(sx * 18, sy * 17, 5, 40, 12, PALE, 10, 4);
    b.cylinder(0, 0, 11, 30, 52, PALE).dome(0, 0, 11, 52, 27, PALE).cylinder(0, 0, 2.5, 78, 84, PALE);
    b.box(36, 0, 12, 12, 0, 68, PALE).taper(36, 0, 12, 12, 68, 0.5, 0.5, 84, PALE);
    return b.build(deg(90));
  },
  'Musée du Louvre': () => {
    const b = new Builder();
    b.box(-60, 85, 320, 28, 0, 24, STONE).gable(-60, 85, 320, 28, 24, 6, SLATE);
    b.box(-60, -85, 320, 28, 0, 24, STONE).gable(-60, -85, 320, 28, 24, 6, SLATE);
    b.box(100, 0, 30, 198, 0, 27, STONE).gable(100, 0, 198, 30, 27, 6, SLATE, deg(90));
    b.taper(0, 0, 35, 35, 0, 0.4, 0.4, 21.6, '#a9dcec');
    return b.build(deg(-26));
  },
  'Panthéon': () => {
    const b = new Builder();
    b.box(0, 0, 110, 30, 0, 28, STONE).box(0, 0, 30, 84, 0, 28, STONE);
    b.box(-60, 0, 12, 36, 0, 22, STONE).gable(-60, 0, 36, 12, 22, 7, STONE, deg(90));
    b.cylinder(0, 0, 14, 28, 54, STONE).dome(0, 0, 14.5, 54, 21, '#8c989f').cylinder(0, 0, 3, 74, 83, STONE);
    return b.build(deg(-25));
  },
  'Les Invalides': () => {
    const b = new Builder();
    b.box(0, 0, 60, 60, 0, 30, STONE).cylinder(0, 0, 14, 30, 58, STONE);
    b.dome(0, 0, 15, 58, 28, GOLD).cylinder(0, 0, 3, 85, 95, GOLD).cylinder(0, 0, 2, 95, 107, GOLD, 0.2, 8);
    return b.build(deg(90));
  },
  'Tour Montparnasse': () =>
    new Builder().box(0, 0, 50, 32, 0, 206, '#5a4e46').box(0, 0, 44, 26, 206, 210, '#3c342f').build(deg(40)),
  'Opéra Garnier': () => {
    const green = '#7fb09c';
    const b = new Builder();
    b.box(0, 0, 100, 70, 0, 30, STONE).box(-55, 0, 10, 70, 0, 24, STONE);
    b.box(28, 0, 36, 50, 30, 48, STONE).gable(28, 0, 50, 36, 48, 9, green, deg(90));
    b.cylinder(-12, 0, 19, 30, 36, STONE).dome(-12, 0, 19, 36, 14, green);
    return b.build(deg(70));
  },
  'Centre Pompidou': () =>
    new Builder()
      .box(0, 0, 166, 60, 0, 42, '#cfd6dd')
      .box(0, 32, 160, 4, 0, 45, '#2f6fd0')
      .box(0, -32, 150, 3, 4, 40, '#d8362f')
      .box(-55, 8, 12, 12, 42, 49, '#d8362f')
      .box(-15, -8, 12, 12, 42, 49, '#2a9d5a')
      .box(35, 8, 12, 12, 42, 49, '#f2c230')
      .build(deg(80)),
  "Musée d'Orsay": () => {
    const b = new Builder();
    b.box(0, 0, 175, 62, 0, 26, STONE).gable(0, 0, 175, 44, 26, 12, '#7d8a8f');
    for (const sx of [-1, 1]) b.box(sx * 78, -26, 15, 15, 0, 36, STONE).taper(sx * 78, -26, 15, 15, 36, 5, 5, 44, SLATE);
    return b.build(deg(-15));
  },
  'Grand Palais': () => {
    const glass = '#9ccdc0';
    const b = new Builder();
    b.box(0, 0, 200, 50, 0, 24, STONE).box(0, -32, 60, 50, 0, 24, STONE);
    b.gable(0, 0, 184, 38, 24, 13, glass).gable(0, -30, 46, 36, 24, 13, glass, deg(90));
    b.dome(0, 0, 22, 32, 18, glass).cylinder(0, 0, 2, 50, 60, STONE, 0.3, 8);
    return b.build(deg(64));
  },
  'Sainte-Chapelle': () =>
    new Builder()
      .box(0, 0, 36, 14, 0, 30, STONE)
      .gable(0, 0, 36, 14, 30, 12, '#55636e')
      .cylinder(0, 0, 1.8, 42, 75, '#55636e', 0.15, 8)
      .build(deg(-25)),
  'Place de la Concorde': () =>
    new Builder()
      .box(0, 0, 5, 5, 0, 4, STONE)
      .taper(0, 0, 3, 3, 4, 2, 2, 21, '#d9b98c')
      .taper(0, 0, 2, 2, 21, 0.1, 0.1, 23, GOLD)
      .build(0),
  'Place de la Bastille': () =>
    new Builder()
      .box(0, 0, 12, 12, 0, 6, STONE)
      .cylinder(0, 0, 2, 6, 45, '#4f7f6c')
      .box(0, 0, 5.5, 5.5, 45, 47, '#4f7f6c')
      .sphere(0, 0, 1.6, 48.6, GOLD)
      .build(0),
  'Moulin Rouge': () => {
    const red = '#c22a35';
    const b = new Builder();
    b.box(0, 4, 30, 14, 0, 10, red).cylinder(0, 4, 5, 10, 20, red).cylinder(0, 4, 5.6, 20, 27, '#8f1d26', 0.2);
    b.box(0, -3, 26, 0.8, 15, 17, '#f0596a').box(0, -3, 2, 0.8, 3, 29, '#f0596a');
    return b.build(0);
  },
  'Trocadéro': () => {
    const b = new Builder();
    for (const sy of [-1, 1]) {
      b.box(-12, sy * 78, 34, 90, 0, 20, PALE, deg(sy * -22));
      b.box(14, sy * 30, 30, 30, 0, 28, PALE);
    }
    return b.build(deg(-45));
  },
  'Parc de la Villette': () => new Builder().cylinder(0, 0, 20, 0, 1.5, '#7fa3b5').sphere(0, 0, 18, 18, '#cdd6de').build(0),
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
  const minPx = 14 + 2.6 * size ** 0.35;
  return Math.max(1, minPx / (k * size));
}
