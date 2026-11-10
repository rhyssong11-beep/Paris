// Generates the high-detail 3D Eiffel Tower + Champ de Mars plaza, fountains, trees & streetlamps
// model as a standard glTF 2.0 binary: public/models/eiffel.glb
// Usage: node scripts/build-eiffel-glb.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

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
      this.addQuad(ring0[i], ring1[i], ring1[j], ring0[j]);
    }
    if (cap) {
      for (let i = 1; i < sides - 1; i++) {
        this.addTri(ring1[0], ring1[i + 1], ring1[i], dir);
        this.addTri(ring0[0], ring0[i], ring0[i + 1], [-dir[0], -dir[1], -dir[2]]);
      }
    }
  }

  /** Axis-aligned or Y-rotated box from y0 to y1 (Three.js Y-up coordinates: x, y, z). */
  addBox(cx, y0, cz, wx, wy, wz, rotY = 0, capBottom = false) {
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    const y1 = y0 + wy;
    const pts = [
      [-wx / 2, -wz / 2],
      [wx / 2, -wz / 2],
      [wx / 2, wz / 2],
      [-wx / 2, wz / 2],
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

  /** Tapered frustum (square/rectangular or n-gon) along Y-up. */
  addFrustum(cx0, y0, cz0, rx0, rz0, cx1, y1, cz1, rx1, rz1, segs = 16, rotY = 0, capTop = true, capBottom = false) {
    const ring = (cx, y, cz, rx, rz) =>
      Array.from({ length: segs }, (_, i) => {
        const a = rotY + (i / segs) * Math.PI * 2;
        return [cx + Math.cos(a) * rx, y, cz + Math.sin(a) * rz];
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
    baseColorFactor: [0.51, 0.39, 0.29, 1.0], // authentic Eiffel bronze-brown
    metallicFactor: 0.68,
    roughnessFactor: 0.48,
  }),
  tower_dark_iron: new MeshBucket('Tower_DarkIron', {
    baseColorFactor: [0.38, 0.29, 0.21, 1.0], // deep structural iron trim & decks
    metallicFactor: 0.72,
    roughnessFactor: 0.44,
  }),
  tower_gold: new MeshBucket('Tower_Gold', {
    baseColorFactor: [0.92, 0.73, 0.26, 1.0], // golden scientific plaques, cupola & filigree
    metallicFactor: 0.88,
    roughnessFactor: 0.24,
  }),
  tower_glass: new MeshBucket('Tower_Glass', {
    baseColorFactor: [1.0, 0.89, 0.62, 1.0], // warm illuminated pavilion windows
    metallicFactor: 0.1,
    roughnessFactor: 0.2,
    emissiveFactor: [0.45, 0.35, 0.15],
  }),
  tower_stone: new MeshBucket('Tower_Stone', {
    baseColorFactor: [0.84, 0.8, 0.72, 1.0], // limestone masonry anchor piers
    metallicFactor: 0.05,
    roughnessFactor: 0.85,
  }),
  plaza_stone: new MeshBucket('Plaza_Stone', {
    baseColorFactor: [0.74, 0.71, 0.65, 1.0], // Champ de Mars gravel & stone walkways
    metallicFactor: 0.04,
    roughnessFactor: 0.9,
  }),
  plaza_curb: new MeshBucket('Plaza_Curb', {
    baseColorFactor: [0.58, 0.56, 0.52, 1.0], // dark granite borders, benches & curbs
    metallicFactor: 0.08,
    roughnessFactor: 0.82,
  }),
  park_lawn: new MeshBucket('Park_Lawn', {
    baseColorFactor: [0.22, 0.43, 0.27, 1.0], // manicured parterre grass
    metallicFactor: 0.02,
    roughnessFactor: 0.92,
  }),
  park_foliage: new MeshBucket('Park_Foliage', {
    baseColorFactor: [0.25, 0.49, 0.31, 1.0], // lush chestnut & plane tree crowns
    metallicFactor: 0.02,
    roughnessFactor: 0.88,
  }),
  tree_trunk: new MeshBucket('Tree_Trunk', {
    baseColorFactor: [0.36, 0.27, 0.2, 1.0],
    metallicFactor: 0.02,
    roughnessFactor: 0.95,
  }),
  fountain_water: new MeshBucket('Fountain_Water', {
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
  tower_gold: gold,
  tower_glass: glass,
  tower_stone: stone,
  plaza_stone: plaza,
  plaza_curb: curb,
  park_lawn: lawn,
  park_foliage: foliage,
  tree_trunk: trunk,
  fountain_water: water,
  lamp_glow: lampGlow,
} = buckets;

// ------------------------------------------------------------------ 1. Champ de Mars Plaza, Fountains, Trees & Streetlamps
{
  // Octagonal / circular grand esplanade base (radius 185 m)
  plaza.addFrustum(0, 0, 0, 185, 185, 0, 0.8, 0, 184, 184, 48, 0, true, true);
  curb.addFrustum(0, 0.8, 0, 142, 142, 0, 1.25, 0, 141, 141, 48, 0, true, false);
  plaza.addFrustum(0, 1.25, 0, 138, 138, 0, 1.5, 0, 137.5, 137.5, 48, 0, true, false);

  // Cross-axial ceremonial walkways under the tower
  for (const rot of [0, Math.PI / 2]) {
    plaza.addBox(0, 1.5, 0, 38, 0.25, 290, rot);
    curb.addBox(0, 1.5, 0, 40.5, 0.18, 290, rot);
  }
  // Central decorative compass rose medallion directly beneath the tower
  curb.addFrustum(0, 1.5, 0, 26, 26, 0, 1.85, 0, 25.5, 25.5, 32, 0, true, false);
  plaza.addFrustum(0, 1.85, 0, 22, 22, 0, 2.05, 0, 21.5, 21.5, 32, 0, true, false);
  gold.addFrustum(0, 2.05, 0, 6.5, 6.5, 0, 2.25, 0, 6.2, 6.2, 16, 0, true, false);

  // Four formal French parterre garden quadrants with manicured lawns, curbs, and reflecting fountains
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const qx = sx * 68;
      const qz = sz * 68;
      curb.addBox(qx, 1.4, qz, 76, 0.65, 76);
      lawn.addBox(qx, 2.05, qz, 72, 0.35, 72);
      // Inner diagonal & cross gravel paths
      plaza.addBox(qx, 2.4, qz, 72, 0.12, 7.5);
      plaza.addBox(qx, 2.4, qz, 7.5, 0.12, 72);

      // Monumental circular & octagonal fountain basin in each quadrant
      stone.addFrustum(qx, 2.4, qz, 16.5, 16.5, qx, 3.8, qz, 16, 16, 24, 0, true, false);
      water.addFrustum(qx, 3.8, qz, 14.5, 14.5, qx, 4.15, qz, 14.5, 14.5, 24, 0, true, false);
      // Two-tier bronze fountain pedestal & glowing water jets
      darkIron.addFrustum(qx, 4.15, qz, 3.5, 3.5, qx, 6.8, qz, 2.2, 2.2, 14, 0, true, false);
      darkIron.addFrustum(qx, 6.5, qz, 6.5, 6.5, qx, 7.2, qz, 5.2, 5.2, 16, 0, true, false);
      darkIron.addFrustum(qx, 7.2, qz, 1.8, 1.8, qx, 9.8, qz, 1.1, 1.1, 12, 0, true, false);
      gold.addFrustum(qx, 9.5, qz, 3.4, 3.4, qx, 10.1, qz, 2.6, 2.6, 14, 0, true, false);
      lampGlow.addDome(qx, 10.1, qz, 2.2, 4.2, 12, 4);
      // Ring of 8 perimeter fountain nozzles & underwater lights
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const nx = qx + Math.cos(a) * 10.5;
        const nz = qz + Math.sin(a) * 10.5;
        lampGlow.addSphere(nx, 4.3, nz, 0.65, 8, 3);
      }
    }
  }

  // Helper to place a lush multi-crown Parisian chestnut/plane tree
  const addTree = (tx, tz, baseY, h = 13.5, r = 5.2) => {
    stone.addFrustum(tx, baseY, tz, 1.6, 1.6, tx, baseY + 0.45, tz, 1.4, 1.4, 8);
    trunk.addFrustum(tx, baseY + 0.45, tz, 0.55, 0.55, tx, baseY + h * 0.42, tz, 0.35, 0.35, 8);
    foliage.addSphere(tx, baseY + h * 0.66, tz, r, 12, 5);
    foliage.addSphere(tx + r * 0.42, baseY + h * 0.56, tz + r * 0.25, r * 0.68, 10, 4);
    foliage.addSphere(tx - r * 0.38, baseY + h * 0.58, tz - r * 0.3, r * 0.65, 10, 4);
    foliage.addSphere(tx, baseY + h * 0.85, tz, r * 0.62, 10, 4);
  };

  // Helper to place a Belle Époque Parisian double/triple globe streetlamp
  const addStreetlamp = (lx, lz, baseY) => {
    darkIron.addFrustum(lx, baseY, lz, 0.55, 0.55, lx, baseY + 1.4, lz, 0.32, 0.32, 8);
    darkIron.addFrustum(lx, baseY + 1.4, lz, 0.18, 0.18, lx, baseY + 6.8, lz, 0.12, 0.12, 8);
    gold.addFrustum(lx, baseY + 6.5, lz, 0.45, 0.45, lx, baseY + 6.8, lz, 0.45, 0.45, 8);
    lampGlow.addSphere(lx, baseY + 7.35, lz, 0.62, 10, 4);
  };

  // Tree rows and Belle Époque streetlamps lining the grand avenues and outer promenade ring
  for (const d of [-102, -82, -54, 54, 82, 102]) {
    for (const s of [-1, 1]) {
      addTree(d, s * 25.5, 1.5, 14, 5.4);
      addTree(s * 25.5, d, 1.5, 14, 5.4);
      addStreetlamp(d, s * 19.5, 1.75);
      addStreetlamp(s * 19.5, d, 1.75);
    }
  }
  for (let i = 0; i < 20; i++) {
    const a = ((i + 0.5) / 20) * Math.PI * 2;
    if (Math.abs(Math.cos(a)) > 0.95 || Math.abs(Math.sin(a)) > 0.95) continue;
    addTree(Math.cos(a) * 124, Math.sin(a) * 124, 1.5, 15, 5.8);
    addStreetlamp(Math.cos(a) * 114, Math.sin(a) * 114, 1.5);
  }
}

// ------------------------------------------------------------------ 2. Eiffel Tower Geometry (330 m)
{
  // Accurate Gustave Eiffel profile curves:
  // Outer half-width of the tower at height y (base span = 124.9 m -> half-width 62.45 m at y=0)
  const outer = (y) => {
    if (y <= 57) return 62.45 - (62.45 - 35.5) * (y / 57) ** 0.88;
    if (y <= 115) return 35.5 - (35.5 - 19.5) * ((y - 57) / (115 - 57)) ** 0.9;
    return 5.0 + 14.5 * Math.exp(-(y - 115) / 68) * (1 - (y - 115) / 240);
  };
  // Half-width of each of the 4 inclined legs at height y (0..115 m)
  const legHalf = (y) => 12.6 - (12.6 - 7.8) * (y / 115);

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
        darkIron.addBeam(am, bm, braceR * 0.65, braceR * 0.65, 4);
        // Primary St. Andrew's X-bracing
        iron.addBeam(a0, b1, braceR * 0.85, braceR * 0.85, 4);
        iron.addBeam(b0, a1, braceR * 0.85, braceR * 0.85, 4);
        // Secondary diamond lattice & vertical web stiffeners
        darkIron.addBeam(botMid, topMid, braceR * 0.55, braceR * 0.55, 4);
        darkIron.addBeam(am, topMid, braceR * 0.5, braceR * 0.5, 4);
        darkIron.addBeam(bm, topMid, braceR * 0.5, braceR * 0.5, 4);
        darkIron.addBeam(am, botMid, braceR * 0.5, braceR * 0.5, 4);
        darkIron.addBeam(bm, botMid, braceR * 0.5, braceR * 0.5, 4);
        // Internal cross-tie
        if (s === subDivs - 1) {
          darkIron.addBeam(a1, pt((i + 2) % 4, t1), braceR * 0.45, braceR * 0.45, 4);
        }
        void center;
      }
    }
  };

  // ---------------------------------------------------------------- 2A. Four Masonry Foundations & Inclined Legs (0..115 m)
  const legStages = [3.5, 10, 17.5, 25, 33, 41, 49, 57, 66, 75.5, 85, 95, 105, 115];
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
    stone.addBox(bx, 1.5, bz, 30, 2.2, 30, 0);
    stone.addBox(bx, 3.7, bz, 27.5, 2.0, 27.5, 0);
    curb.addBox(bx, 5.7, bz, 28.5, 0.7, 28.5, 0);
    for (const [cx, cz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const px = bx + cx * (legHalf(0) - 1);
      const pz = bz + cz * (legHalf(0) - 1);
      stone.addBox(px, 5.8, pz, 6.2, 2.4, 6.2);
      darkIron.addFrustum(px, 8.2, pz, 2.6, 2.6, px, 9.6, pz, 1.8, 1.8, 8);
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
        belowFirst ? 0.85 : 0.72,
        belowFirst ? 0.42 : 0.36,
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
        darkIron.addBeam(pL0, pH0, 0.34, 0.34, 4);
        darkIron.addBeam(pL0, pH1, 0.3, 0.3, 4);
        darkIron.addBeam(pH0, pL1, 0.3, 0.3, 4);
        // Spandrel vertical & diagonal hangers up to the 1st platform soffit (y = 55 m)
        if (i % 2 === 0) {
          const pTop = rotPt(x0, 55, outer(55) - 2.2 + zOff);
          darkIron.addBeam(pH0, pTop, 0.32, 0.32, 4);
          if (i + 2 <= archSegs) {
            const a2 = ((i + 2) / archSegs) * Math.PI;
            const pTop2 = rotPt(Math.cos(a2) * span, 55, outer(55) - 2.2 + zOff);
            darkIron.addBeam(pH0, pTop2, 0.26, 0.26, 4);
          }
        }
      }
      // Cross-ties joining the front and back planes of the arch box-section
      const pFront = rotPt(x0, yLow0, zLow0 + 2.8);
      const pBack = rotPt(x0, yLow0, zLow0 - 2.8);
      darkIron.addBeam(pFront, pBack, 0.3, 0.3, 4);
    }
  }

  // ---------------------------------------------------------------- 2C. First Platform (57 m): Cantilever Deck, Scientific Frieze & Pavilions
  {
    const w1 = outer(57) * 2 + 7; // ~78 m square deck
    darkIron.addBox(0, 54.5, 0, w1, 2.2, w1, 0, true);
    iron.addBox(0, 56.7, 0, w1 + 2.4, 1.4, w1 + 2.4, 0, true);
    // Golden frieze of the 72 French scientists' names around all four sides
    for (let k = -8; k <= 8; k++) {
      const pos = k * 4.2;
      const edge = w1 / 2 + 1.3;
      gold.addBox(pos, 55.2, edge, 2.6, 1.1, 0.4);
      gold.addBox(pos, 55.2, -edge, 2.6, 1.1, 0.4);
      gold.addBox(edge, 55.2, pos, 0.4, 1.1, 2.6);
      gold.addBox(-edge, 55.2, pos, 0.4, 1.1, 2.6);
    }
    // Central hollow courtyard opening on the 1st floor framed by 4 glazed restaurant pavilions (Madame Brasserie)
    for (let side = 0; side < 4; side++) {
      const rot = (side * Math.PI) / 2;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const px = s * 25;
      const pz = c * 25;
      darkIron.addBox(px, 58.1, pz, 42, 1.0, 14, rot);
      glass.addBox(px, 59.1, pz, 39, 4.2, 11.5, rot); // warmly glowing restaurant windows
      iron.addBox(px, 63.3, pz, 43, 1.2, 15, rot);
      // Perimeter observation railing posts
      for (let r = -36; r <= 36; r += 4.5) {
        const rx = r * c + (w1 / 2 + 0.6) * s;
        const rz = -r * s + (w1 / 2 + 0.6) * c;
        darkIron.addBox(rx, 58.1, rz, 0.45, 2.2, 0.45);
      }
    }
    darkIron.addBox(0, 64.5, 0, w1 - 4, 1.1, w1 - 4);
  }

  // ---------------------------------------------------------------- 2D. Intermediate Connecting Gallery (86 m) & Second Platform (115 m)
  {
    // 86 m intermediate structural ring & elevator transfer bridge
    const wMid = outer(86) * 2 + 2;
    darkIron.addBox(0, 84.5, 0, wMid, 2.2, wMid, 0, true);
    iron.addBox(0, 86.7, 0, wMid - 4, 1.0, wMid - 4);

    // 115 m Second Platform: two-tiered observation deck + Le Jules Verne panoramic windows
    const w2 = outer(115) * 2 + 6.5; // ~45.5 m
    darkIron.addBox(0, 113.5, 0, w2, 2.0, w2, 0, true);
    iron.addBox(0, 115.5, 0, w2 + 2.2, 1.2, w2 + 2.2, 0, true);
    glass.addBox(0, 116.7, 0, w2 - 3.5, 3.6, w2 - 3.5, 0); // glowing lower observation & restaurant gallery
    darkIron.addBox(0, 120.3, 0, w2, 1.3, w2, 0, true);
    glass.addBox(0, 121.6, 0, w2 - 9, 2.8, w2 - 9, 0); // upper observation deck windows
    iron.addBox(0, 124.4, 0, w2 - 6, 1.2, w2 - 6, 0, true);
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

  // ---------------------------------------------------------------- 2F. Summit (3rd Platform, Gustave Eiffel's Office, Cupola, Beacon & 330 m Spire)
  {
    // Cantilevered summit bracket & indoor panoramic lounge (275..283 m)
    darkIron.addFrustum(0, 273.5, 0, 11.5, 11.5, 0, 276, 0, 16.5, 16.5, 4, Math.PI / 4, true, true);
    iron.addBox(0, 276, 0, 18.5, 1.4, 18.5, 0, true);
    glass.addBox(0, 277.4, 0, 15.5, 4.2, 15.5, 0);
    darkIron.addBox(0, 281.6, 0, 17.8, 1.3, 17.8, 0, true);
    // Open-air summit viewing deck & Gustave Eiffel's private apartment cabin
    glass.addFrustum(0, 282.9, 0, 8.2, 8.2, 0, 287.5, 0, 7.6, 7.6, 12);
    iron.addFrustum(0, 287.5, 0, 8.8, 8.8, 0, 289, 0, 8.2, 8.2, 12, 0, true, true);

    // Arched lantern cupola, golden beacon housing & glowing lighthouse core (289..301 m)
    iron.addDome(0, 289, 0, 7.2, 7.5, 16, 6);
    gold.addFrustum(0, 296, 0, 3.8, 3.8, 0, 298.5, 0, 3.2, 3.2, 16);
    lampGlow.addFrustum(0, 298.5, 0, 2.8, 2.8, 0, 302.5, 0, 2.5, 2.5, 16);
    gold.addDome(0, 302.5, 0, 3.0, 2.8, 16, 5);

    // 330 m broadcast antenna spire with dipole telemetry rings
    iron.addFrustum(0, 305, 0, 1.5, 1.5, 0, 318, 0, 0.75, 0.75, 12);
    gold.addFrustum(0, 318, 0, 0.75, 0.75, 0, 330, 0, 0.22, 0.22, 10);
    for (const ay of [308, 312, 316, 321, 325]) {
      const ar = 2.6 - ((ay - 308) / 20) * 1.4;
      darkIron.addFrustum(0, ay, 0, ar, ar, 0, ay + 0.45, 0, ar, ar, 12, 0, true, true);
    }
    lampGlow.addSphere(0, 330, 0, 0.55, 10, 4);
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
writeFileSync(new URL('eiffel.glb', dir), out);
console.log(
  `wrote public/models/eiffel.glb: ${(out.byteLength / 1e6).toFixed(2)} MB — ${meshCount} PBR meshes, ${totalVerts.toLocaleString()} vertices, ${totalTris.toLocaleString()} triangles`,
);
