// The palace of the Louvre as repeating modules: one façade bay with its half of the mansard roof,
// a chimney stack, a domed pavilion and the clock of the Pavillon de l'Horloge.
//
// Every module is modelled in metres in its own frame: s runs along the wall (+x), y is up, and o is
// the distance out from the wall plane (+z). The layout then places the modules around the courts.
// Winding is not kept consistent, so the materials are double-sided.

/** Metres covered by one repeat of each material's texture, across and up. */
export const TILE = {
  Louvre_Stone: [4.2, 4.0], Louvre_Stone_Trim: [4, 4], Louvre_Sculpture: [4, 4], Louvre_Roof_Slate: [3.2, 2.4], Louvre_Roof_Lead: [3, 3],
};
/** name: [sRGB-linear colour, roughness, metalness, texture key] */
export const PALACE_MATERIALS = {
  Louvre_Stone: [[0.8, 0.69, 0.5], 0.92, 0, 'stone'],
  Louvre_Stone_Trim: [[0.86, 0.75, 0.55], 0.88, 0, 'trim'],
  Louvre_Sculpture: [[0.82, 0.71, 0.52], 0.9, 0, 'trim'],
  Palace_Window_Glass: [[0.03, 0.04, 0.055], 0.06, 0.6, null],
  Palace_Window_Frame: [[0.62, 0.6, 0.55], 0.6, 0, null],
  Louvre_Roof_Slate: [[0.4, 0.45, 0.54], 0.5, 0.1, 'slate'],
  Louvre_Roof_Lead: [[0.6, 0.64, 0.68], 0.5, 0.45, 'lead'],
  Louvre_Gilt: [[1.0, 0.72, 0.28], 0.3, 1, null],
  Louvre_Passage_Shade: [[0.03, 0.028, 0.026], 1, 0, null],
  Louvre_Chimney_Pot: [[0.5, 0.25, 0.16], 0.9, 0, null],
  Louvre_Flagpole: [[0.05, 0.055, 0.05], 0.5, 0.6, null],
  Louvre_Flag_Blue: [[0.0, 0.07, 0.36], 0.8, 0, null],
  Louvre_Flag_White: [[0.85, 0.85, 0.85], 0.8, 0, null],
  Louvre_Flag_Red: [[0.7, 0.02, 0.04], 0.8, 0, null],
};
const NAMES = Object.keys(PALACE_MATERIALS);
const M = { STONE: 0, TRIM: 1, SCULPT: 2, GLASS: 3, FRAME: 4, SLATE: 5, LEAD: 6, GILT: 7, DARK: 8, POT: 9, IRON: 10, FB: 11, FW: 12, FR: 13 };

let cur;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function tri(a, b, c, m, na, nb, nc) {
  let g = cross(sub(b, a), sub(c, a));
  const l = Math.hypot(...g);
  if (l < 1e-10) return;
  g = g.map((v) => v / l);
  if (na && g[0] * na[0] + g[1] * na[1] + g[2] * na[2] < 0) { [b, c] = [c, b]; [nb, nc] = [nc, nb]; }
  const [tu, tv] = TILE[NAMES[m]] ?? [4, 4];
  const uv = (p) => (Math.abs(g[1]) > 0.75 ? [p[0] / tu, p[2] / tv] : Math.abs(g[0]) > Math.abs(g[2]) ? [p[2] / tu, p[1] / tv] : [p[0] / tu, p[1] / tv]);
  cur.P.push(...a, ...b, ...c); cur.N.push(...(na ?? g), ...(nb ?? g), ...(nc ?? g)); cur.UV.push(...uv(a), ...uv(b), ...uv(c)); cur.MID.push(m);
}
const quad = (a, b, c, d, m) => { tri(a, b, c, m); tri(a, c, d, m); };

class Frame {
  constructor(ox, oz, sx, sz, nx, nz) { Object.assign(this, { ox, oz, sx, sz, nx, nz }); }
  p(s, y, o) { return [this.ox + this.sx * s + this.nx * o, y, this.oz + this.sz * s + this.nz * o]; }
  shifted(o) { return new Frame(this.ox + this.nx * o, this.oz + this.nz * o, this.sx, this.sz, this.nx, this.nz); }
  rect(s0, s1, y0, y1, o, m) { if (s1 - s0 > 1e-6 && y1 - y0 > 1e-6) quad(this.p(s0, y0, o), this.p(s1, y0, o), this.p(s1, y1, o), this.p(s0, y1, o), m); }
  /** Box; `skip` lists faces to leave out: b(ack) f(ront) l r t(op) u(nder). */
  box(s0, s1, y0, y1, o0, o1, m, skip = 'b') {
    const c = (s, y, o) => this.p(s, y, o);
    if (!skip.includes('f')) quad(c(s0, y0, o1), c(s1, y0, o1), c(s1, y1, o1), c(s0, y1, o1), m);
    if (!skip.includes('b')) quad(c(s0, y0, o0), c(s1, y0, o0), c(s1, y1, o0), c(s0, y1, o0), m);
    if (!skip.includes('l')) quad(c(s0, y0, o0), c(s0, y0, o1), c(s0, y1, o1), c(s0, y1, o0), m);
    if (!skip.includes('r')) quad(c(s1, y0, o0), c(s1, y0, o1), c(s1, y1, o1), c(s1, y1, o0), m);
    if (!skip.includes('t')) quad(c(s0, y1, o0), c(s1, y1, o0), c(s1, y1, o1), c(s0, y1, o1), m);
    if (!skip.includes('u')) quad(c(s0, y0, o0), c(s1, y0, o0), c(s1, y0, o1), c(s0, y0, o1), m);
  }
  /** Moulding: a profile of [o, y] points swept along s. */
  sweep(prof, s0, s1, m, caps = true) {
    for (let i = 0; i + 1 < prof.length; i++) quad(this.p(s0, prof[i][1], prof[i][0]), this.p(s1, prof[i][1], prof[i][0]), this.p(s1, prof[i + 1][1], prof[i + 1][0]), this.p(s0, prof[i + 1][1], prof[i + 1][0]), m);
    if (caps) for (const s of [s0, s1]) for (let i = 1; i + 1 < prof.length; i++) tri(this.p(s, prof[0][1], prof[0][0]), this.p(s, prof[i][1], prof[i][0]), this.p(s, prof[i + 1][1], prof[i + 1][0]), m);
  }
  /** Upright round shaft with smooth normals; r0 at y0, r1 at y1. */
  cyl(s, o, r0, r1, y0, y1, m, seg = 10, cap = false) {
    const z = this.p(0, 0, 0);
    const pts = Array.from({ length: seg + 1 }, (_, i) => { const a = (i / seg) * Math.PI * 2, q = this.p(Math.cos(a), 0, Math.sin(a)); return [Math.cos(a), Math.sin(a), [q[0] - z[0], 0, q[2] - z[2]]]; });
    for (let i = 0; i < seg; i++) {
      const [c0, s0, n0] = pts[i], [c1, s1, n1] = pts[i + 1];
      const a0 = this.p(s + c0 * r0, y0, o + s0 * r0), a1 = this.p(s + c1 * r0, y0, o + s1 * r0), b0 = this.p(s + c0 * r1, y1, o + s0 * r1), b1 = this.p(s + c1 * r1, y1, o + s1 * r1);
      tri(a0, a1, b1, m, n0, n1, n1); tri(a0, b1, b0, m, n0, n1, n0);
    }
    if (cap) for (let i = 1; i + 1 < seg; i++) tri(this.p(s + r1, y1, o), this.p(s + pts[i][0] * r1, y1, o + pts[i][1] * r1), this.p(s + pts[i + 1][0] * r1, y1, o + pts[i + 1][1] * r1), m);
  }
  poly(pts, m) { const q = pts.map((p) => this.p(...p)); for (let i = 1; i + 1 < q.length; i++) tri(q[0], q[i], q[i + 1], m); }
}

const ARC = 10;
/** One bay of wall between s0..s1 and yb..yt with a recessed window, door or passage. */
function wallBay(F, s0, s1, yb, yt, op) {
  const { c, half, sill, top, arched = false, depth = 0.55, passage = false } = op;
  const a = c - half, b = c + half, d = -depth;
  F.rect(s0, a, yb, yt, 0, M.STONE); F.rect(b, s1, yb, yt, 0, M.STONE); F.rect(a, b, yb, sill, 0, M.STONE);
  const arc = Array.from({ length: ARC + 1 }, (_, i) => { const t = Math.PI - (i / ARC) * Math.PI; return [c + Math.cos(t) * half, top + Math.sin(t) * half]; });
  if (arched) {
    for (let i = 0; i < ARC; i++) {
      F.poly([[arc[i][0], arc[i][1], 0], [arc[i + 1][0], arc[i + 1][1], 0], [arc[i + 1][0], yt, 0], [arc[i][0], yt, 0]], M.STONE);
      F.poly([[arc[i][0], arc[i][1], 0], [arc[i + 1][0], arc[i + 1][1], 0], [arc[i + 1][0], arc[i + 1][1], d], [arc[i][0], arc[i][1], d]], M.STONE);
    }
  } else { F.rect(a, b, top, yt, 0, M.STONE); F.poly([[a, top, 0], [b, top, 0], [b, top, d], [a, top, d]], M.STONE); }
  F.poly([[a, sill, 0], [a, top, 0], [a, top, d], [a, sill, d]], M.STONE); F.poly([[b, sill, 0], [b, top, 0], [b, top, d], [b, sill, d]], M.STONE);
  F.poly([[a, sill, 0], [b, sill, 0], [b, sill, d], [a, sill, d]], M.TRIM);
  const fill = passage ? M.DARK : M.GLASS;
  F.rect(a, b, sill, top, d, fill);
  if (arched) F.poly([[c, top, d], ...arc.map(([s, y]) => [s, y, d])], fill);
  if (passage) return;
  const f0 = d, f1 = d + 0.09, w = 0.09, sk = 'bu';
  F.box(a, a + w, sill, top, f0, f1, M.FRAME, sk + 'l'); F.box(b - w, b, sill, top, f0, f1, M.FRAME, sk + 'r'); F.box(a, b, sill, sill + w, f0, f1, M.FRAME, 'blr'); F.box(a, b, top - w / 2, top + w / 2, f0, f1, M.FRAME, 'blr');
  F.box(c - 0.04, c + 0.04, sill, top + (arched ? half : 0), f0, f1, M.FRAME, 'btu');
  const rows = Math.max(1, Math.round((top - sill) / 1.05));
  for (let i = 1; i < rows; i++) { const y = sill + ((top - sill) * i) / rows; F.box(a, b, y - 0.025, y + 0.025, f0, f1 - 0.02, M.FRAME, 'blr'); }
  for (const h of [-0.5, 0.5]) F.box(c + h * half - 0.02, c + h * half + 0.02, sill, top, f0, f1 - 0.02, M.FRAME, 'btu');
  if (arched) for (let i = 0; i < ARC; i++) F.poly([[arc[i][0], arc[i][1], f1], [arc[i + 1][0], arc[i + 1][1], f1], [c + (arc[i + 1][0] - c) * 0.93, top + (arc[i + 1][1] - top) * 0.93, f1], [c + (arc[i][0] - c) * 0.93, top + (arc[i][1] - top) * 0.93, f1]], M.FRAME);
}
/** Raised band following an arch, with a keystone and imposts. */
function archivolt(F, c, half, spring, wide = 0.38, out = 0.13) {
  const pt = (r, i) => { const t = Math.PI - (i / ARC) * Math.PI; return [c + Math.cos(t) * r, spring + Math.sin(t) * r]; };
  for (let i = 0; i < ARC; i++) {
    const [a0, a1, b0, b1] = [pt(half, i), pt(half, i + 1), pt(half + wide, i), pt(half + wide, i + 1)];
    F.poly([[...a0, out], [...a1, out], [...b1, out], [...b0, out]], M.TRIM);
    F.poly([[...b0, 0], [...b1, 0], [...b1, out], [...b0, out]], M.TRIM); F.poly([[...a0, 0], [...a1, 0], [...a1, out], [...a0, out]], M.TRIM);
  }
  F.box(c - 0.24, c + 0.24, spring + half - 0.08, spring + half + wide + 0.28, 0, out + 0.14, M.SCULPT);
  for (const s of [c - half - wide, c + half]) F.box(s, s + wide, spring - 0.32, spring, 0, out + 0.05, M.TRIM);
}
/** Triangular or segmental pediment standing on the wall. */
function pediment(F, c, half, y, h, curved, out = 0.32) {
  const n = curved ? 8 : 2;
  const top = Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return [c - half + 2 * half * t, y + (curved ? h * Math.sin(Math.PI * t) ** 0.8 : h * (1 - Math.abs(2 * t - 1)))]; });
  for (let i = 0; i < n; i++) {
    const r = 0.16 * Math.min(1, h), a = top[i], b = top[i + 1];
    F.poly([[a[0], y, out * 0.45], [b[0], y, out * 0.45], [b[0], b[1], out * 0.45], [a[0], a[1], out * 0.45]], M.SCULPT);
    F.poly([[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], out], [a[0], a[1], out]], M.TRIM);
    F.poly([[a[0], a[1], out], [b[0], b[1], out], [b[0], b[1] - r, out], [a[0], a[1] - r, out]], M.TRIM);
    F.poly([[a[0], a[1] - r, out], [b[0], b[1] - r, out], [b[0], b[1] - r, out * 0.45], [a[0], a[1] - r, out * 0.45]], M.TRIM);
  }
  F.box(c - half - 0.08, c + half + 0.08, y - 0.14, y, 0, out, M.TRIM);
}
/** Engaged column on a pedestal with a spreading capital. */
function column(F, s, y0, y1, r = 0.34, o = 0.22) {
  F.box(s - r - 0.14, s + r + 0.14, y0, y0 + 0.75, 0, o + r + 0.14, M.TRIM, 'bu');
  F.cyl(s, o, r * 1.22, r * 1.05, y0 + 0.75, y0 + 0.95, M.TRIM, 8);
  F.cyl(s, o, r, r * 0.86, y0 + 0.95, y1 - 0.62, M.TRIM, 10);
  F.cyl(s, o, r * 0.9, r * 1.38, y1 - 0.62, y1 - 0.16, M.SCULPT, 8);
  F.box(s - r * 1.45, s + r * 1.45, y1 - 0.16, y1, 0, o + r * 1.45, M.TRIM, 'bt');
}
function pilaster(F, s, y0, y1, w = 0.34, out = 0.16) {
  F.box(s - w - 0.07, s + w + 0.07, y0, y0 + 0.4, 0, out + 0.07, M.TRIM, 'bu'); F.box(s - w, s + w, y0 + 0.4, y1 - 0.4, 0, out, M.TRIM, 'btu');
  F.box(s - w - 0.09, s + w + 0.09, y1 - 0.4, y1, 0, out + 0.1, M.SCULPT, 'bt');
}
const entab = (y, h, k = 1) => [[0, y], [0.1 * k, y], [0.1 * k, y + h * 0.3], [0.06 * k, y + h * 0.3], [0.06 * k, y + h * 0.58], [0.2 * k, y + h * 0.63], [0.34 * k, y + h * 0.78], [0.52 * k, y + h * 0.84], [0.56 * k, y + h * 0.98], [0, y + h]];
function dentils(F, s0, s1, y, o, size = 0.17) { const n = Math.floor((s1 - s0) / (size * 2)), st = (s1 - s0) / n; for (let i = 0; i < n; i++) F.box(s0 + i * st + st * 0.25, s0 + i * st + st * 0.75, y - size, y, 0, o, M.TRIM, 'bt'); }
function balustrade(F, s0, s1, y, o) {
  F.box(s0, s1, y, y + 0.22, o - 0.2, o + 0.2, M.TRIM, 'ulr'); F.box(s0, s1, y + 0.95, y + 1.12, o - 0.19, o + 0.19, M.TRIM, 'lr');
  const n = Math.max(1, Math.round((s1 - s0) / 0.4)), st = (s1 - s0) / n;
  for (let i = 0; i < n; i++) { const s = s0 + (i + 0.5) * st; F.cyl(s, o, 0.08, 0.13, y + 0.22, y + 0.5, M.TRIM, 5); F.cyl(s, o, 0.13, 0.06, y + 0.5, y + 0.95, M.TRIM, 5); }
}
const L = { g0: 0, e1: 7.95, f1: 8.9, e2: 15.95, f2: 16.9, e3: 21.9, top: 22.9 };
/** Three storeys of façade for the bays between s0 and s1. */
function facade(F, s0, widths, { pairs = false, passageBay = -1, startCol = true, endCol = true, parity = 0, rich = false } = {}) {
  let s = s0; const edges = [s0];
  widths.forEach((w, i) => {
    const c = s + w / 2, big = w > 9;
    const h0 = i === passageBay ? 2.35 : big ? 1.9 : 1.5, sp0 = i === passageBay ? 4.7 : 5.0;
    wallBay(F, s, s + w, L.g0, L.e1, { c, half: h0, sill: i === passageBay ? 0 : 0.22, top: sp0, arched: true, passage: i === passageBay, depth: i === passageBay ? 7 : 0.6 });
    archivolt(F, c, h0, sp0);
    const h1 = big ? 1.5 : 1.12;
    wallBay(F, s, s + w, L.f1, L.e2, { c, half: h1, sill: 10.0, top: 14.2 });
    F.box(c - h1 - 0.3, c - h1, 10.0, 14.2, 0, 0.12, M.TRIM, 'btu'); F.box(c + h1, c + h1 + 0.3, 10.0, 14.2, 0, 0.12, M.TRIM, 'btu'); F.box(c - h1 - 0.3, c + h1 + 0.3, 14.2, 14.5, 0, 0.14, M.TRIM);
    F.box(c - h1 - 0.42, c + h1 + 0.42, 9.82, 10.0, 0, 0.3, M.TRIM); F.box(c - h1 - 0.2, c + h1 + 0.2, 9.05, 9.8, 0, 0.07, M.SCULPT, 'btu');
    for (const q of [-1, 1]) F.box(c + q * (h1 + 0.2) - 0.11, c + q * (h1 + 0.2) + 0.11, 14.5, 14.95, 0, 0.3, M.SCULPT, 'bt');
    pediment(F, c, h1 + 0.52, 14.95, big ? 1.05 : 0.8, (i + parity) % 2 === 1);
    const h2 = big ? 1.25 : 0.92;
    wallBay(F, s, s + w, L.f2, L.e3, { c, half: h2, sill: 17.75, top: 20.25, depth: 0.45 });
    F.box(c - h2 - 0.22, c - h2, 17.75, 20.25, 0, 0.1, M.TRIM, 'btu'); F.box(c + h2, c + h2 + 0.22, 17.75, 20.25, 0, 0.1, M.TRIM, 'btu'); F.box(c - h2 - 0.22, c + h2 + 0.22, 20.25, 20.48, 0, 0.12, M.TRIM);
    F.box(c - h2 - 0.3, c + h2 + 0.3, 17.6, 17.75, 0, 0.22, M.TRIM);
    for (const q of [-1, 1]) { const x = c + q * (h2 + (w / 2 - h2) * 0.52); F.box(x - 0.42, x + 0.42, 17.9, 20.9, 0, 0.07, M.SCULPT); F.box(x - 0.24, x + 0.24, 18.5, 20.2, 0, 0.19, M.SCULPT); F.box(x - 0.36, x + 0.36, 19.0, 19.6, 0, 0.15, M.SCULPT); }
    F.box(c - 0.55, c + 0.55, 20.6, 21.35, 0, 0.2, M.SCULPT); F.box(c - 0.95, c + 0.95, 20.75, 21.1, 0, 0.12, M.SCULPT);
    s += w; edges.push(s);
  });
  edges.forEach((e, i) => {
    if ((i === 0 && !startCol) || (i === edges.length - 1 && !endCol)) return;
    const at = pairs && i > 0 && i < edges.length - 1 ? [e - 0.62, e + 0.62] : [e];
    for (const x of at) { column(F, x, L.g0, L.e1, 0.36); column(F, x, L.f1, L.e2, 0.33); pilaster(F, x, L.f2, L.e3); }
  });
  F.sweep(entab(L.e1, L.f1 - L.e1), s0, s, M.TRIM, rich); F.sweep(entab(L.e2, L.f2 - L.e2), s0, s, M.TRIM, rich); F.sweep(entab(L.e3, L.top - L.e3, 1.7), s0, s, M.TRIM, rich);
  if (rich) { dentils(F, s0, s, L.e1 + 0.62, 0.18); dentils(F, s0, s, L.e2 + 0.62, 0.18); }
  dentils(F, s0, s, L.e3 + 0.68, 0.42, rich ? 0.24 : 0.36); // modillions under the main cornice
}
/** Lucarne on the steep roof slope. */
function dormer(F, c, curved) {
  const y0 = 23.25, y1 = 26.3, o0 = -1.15;
  F.box(c - 0.98, c + 0.98, y0, y1, -3.3, o0, M.TRIM, 'bu');
  F.rect(c - 0.56, c + 0.56, y0 + 0.5, y1 - 0.5, o0 + 0.02, M.GLASS);
  for (const q of [-1, 1]) F.box(c + q * 0.62 - 0.07, c + q * 0.62 + 0.07, y0 + 0.4, y1 - 0.4, o0, o0 + 0.1, M.TRIM, 'b');
  F.box(c - 0.03, c + 0.03, y0 + 0.5, y1 - 0.5, o0, o0 + 0.05, M.FRAME, 'btu'); F.box(c - 0.56, c + 0.56, (y0 + y1) / 2 - 0.025, (y0 + y1) / 2 + 0.025, o0, o0 + 0.05, M.FRAME, 'blr');
  F.box(c - 1.1, c + 1.1, y1, y1 + 0.2, -3.3, o0 + 0.18, M.TRIM, 'b');
  pediment(F.shifted(o0), c, 1.1, y1 + 0.2, 0.75, curved, 0.2);
  F.poly([[c - 1.1, y1 + 0.2, o0], [c, y1 + 0.95, o0], [c, y1 + 0.95, -4.2], [c - 1.1, y1 + 0.2, -3.3]], M.LEAD); F.poly([[c + 1.1, y1 + 0.2, o0], [c, y1 + 0.95, o0], [c, y1 + 0.95, -4.2], [c + 1.1, y1 + 0.2, -3.3]], M.LEAD);
}

export const BAY = 6.2, HALF_DEPTH = 11, PAVILION_HALF = 13.6;
const LOCAL = new Frame(0, 0, 1, 0, 0, 1);

function bayModule(variant) {
  const F = LOCAL, w = BAY;
  facade(F, 0, [w], { endCol: false, parity: variant });
  balustrade(F, 0.3, w, L.top, 0.62);
  F.box(-0.3, 0.3, L.top, L.top + 1.3, 0.3, 0.94, M.TRIM, 'u');
  const prof = [[0.2, 22.95], [-0.5, 23.0], [-3.9, 29.3], [-HALF_DEPTH, 31.1]];
  for (let i = 0; i + 1 < prof.length; i++) F.poly([[0, prof[i][1], prof[i][0]], [w, prof[i][1], prof[i][0]], [w, prof[i + 1][1], prof[i + 1][0]], [0, prof[i + 1][1], prof[i + 1][0]]], i === 0 ? M.LEAD : M.SLATE);
  F.box(0, w, 29.22, 29.42, -4.05, -3.75, M.LEAD, 'ulr'); F.box(0, w, 31.0, 31.28, -HALF_DEPTH, -HALF_DEPTH + 0.16, M.LEAD, 'ublr');
  for (const s of [w / 6, w / 2, (5 * w) / 6]) F.box(s - 0.035, s + 0.035, 31.28, 31.75, -HALF_DEPTH, -HALF_DEPTH + 0.03, M.LEAD, 'btu');
  F.box(0, w, 31.72, 31.78, -HALF_DEPTH, -HALF_DEPTH + 0.03, M.LEAD, 'blr');
  dormer(F, w / 2, variant === 0);
}
function chimneyModule() {
  const F = LOCAL;
  F.box(-0.75, 0.75, 27, 34.2, -1.3, 1.3, M.STONE, 'ut'); F.box(-0.9, 0.9, 33.4, 33.7, -1.45, 1.45, M.TRIM, ''); F.box(-0.95, 0.95, 34.2, 34.5, -1.5, 1.5, M.TRIM, '');
  for (const q of [-0.8, 0, 0.8]) F.cyl(0, q, 0.2, 0.16, 34.5, 35.3, M.POT, 7, true);
}
const T1 = 30.4, T2 = 31.8, DOME = 12.6, TOP_HALF = 3.6;
function pavilionFrames() { const h = PAVILION_HALF; return [new Frame(-h, -h, 0, 1, -1, 0), new Frame(h, h, 0, -1, 1, 0), new Frame(h, -h, -1, 0, 0, -1), new Frame(-h, h, 1, 0, 0, 1)]; }
/** `tall` adds the caryatid storey, the crowning pediments and the high dome of the main pavilions. */
function pavilionModule(tall) {
  const W = PAVILION_HALF * 2, widths = [8.1, 11, 8.1], T0 = L.top, base = tall ? T2 : L.top + 0.9;
  for (const F of pavilionFrames()) {
    facade(F, 0, widths, { pairs: true, passageBay: 1, rich: true });
    const c = W / 2;
    if (tall) {
    let s = 0;
    widths.forEach((w, i) => { // the caryatid storey
      const c = s + w / 2, half = i === 1 ? 2.1 : 1.35, sp = i === 1 ? 26.6 : 26.9;
      wallBay(F, s, s + w, T0, T1, { c, half, sill: T0 + 1.0, top: sp, arched: true }); archivolt(F, c, half, sp, 0.34);
      F.box(c - half - 0.4, c + half + 0.4, T0 + 0.8, T0 + 1.0, 0, 0.3, M.TRIM);
      s += w;
    });
    for (const e of [0.75, widths[0], widths[0] + widths[1], W - 0.75]) for (const q of e === 0.75 || e === W - 0.75 ? [0] : [-0.62, 0.62]) {
      const x = e + q; F.box(x - 0.42, x + 0.42, T0, T0 + 1.5, 0, 0.75, M.TRIM, 'bu');
      F.cyl(x, 0.38, 0.36, 0.3, T0 + 1.5, T0 + 3.4, M.SCULPT, 8); F.cyl(x, 0.38, 0.3, 0.4, T0 + 3.4, T0 + 5.0, M.SCULPT, 8); F.cyl(x, 0.38, 0.4, 0.17, T0 + 5.0, T0 + 5.5, M.SCULPT, 8);
      F.cyl(x, 0.38, 0.2, 0.2, T0 + 5.5, T0 + 6.0, M.SCULPT, 8, true); F.cyl(x, 0.38, 0.22, 0.4, T0 + 6.0, T1 - 0.2, M.SCULPT, 8); F.box(x - 0.46, x + 0.46, T1 - 0.2, T1, 0, 0.85, M.TRIM, 'bt');
    }
    balustrade(F, 0.2, W - 0.2, T0, 0.5);
    F.sweep(entab(T1, T2 - T1, 2.1), -1.1, W + 1.1, M.TRIM); dentils(F, 0, W, T1 + 0.95, 0.55, 0.26);
    pediment(F, c, 11.4, T2, 4.3, false, 0.75); // crowning pediments pediment(F, c, 6.3, T2 + 0.15, 2.9, true, 0.95);
    for (const q of [-1, 1]) { F.box(c + q * 3.4 - 0.9, c + q * 3.4 + 0.9, T2 + 0.3, T2 + 1.7, 0.3, 0.95, M.SCULPT); F.box(c + q * 8 - 1.1, c + q * 8 + 1.1, T2 + 0.2, T2 + 1.0, 0.2, 0.7, M.SCULPT); F.box(c + q * 2.9 - 0.4, c + q * 2.9 + 0.4, T2 + 1.7, T2 + 2.5, 0.3, 0.85, M.SCULPT); }
    } else {
      F.box(0, W, L.top, base, -0.5, 0.25, M.TRIM, 'bu'); // blocking course under the roof
      pediment(F, c, 5.9, base, 2.4, false, 0.6); F.box(c - 1.6, c + 1.6, base + 0.25, base + 1.3, 0.25, 0.6, M.SCULPT);
    }
    const y = base + 2.3, o = -1.9; // dormers on the dome
    for (const q of [-5.6, 5.6]) { F.box(c + q - 0.9, c + q + 0.9, y - 0.6, y + 1.7, o - 2.4, o + 0.5, M.TRIM, 'bu'); pediment(F.shifted(o + 0.5), c + q, 1.0, y + 1.7, 0.6, true, 0.2); F.poly(Array.from({ length: 14 }, (_, i) => [c + q + Math.cos((i / 14) * 6.2832) * 0.55, y + 0.6 + Math.sin((i / 14) * 6.2832) * 0.55, o + 0.53]), M.GLASS); }
  }
  // the square dome
  const R = tall ? 9 : 6, HD = tall ? DOME : 8.2, hb = PAVILION_HALF - 0.5, topH = tall ? TOP_HALF : 5;
  const ring = (t) => { const k = 1 - Math.cos((t * Math.PI) / 2), y = base + HD * Math.sin((t * Math.PI) / 2) ** 0.92, a = hb - (hb - topH) * k; return [[-a, y, -a], [a, y, -a], [a, y, a], [-a, y, a]]; };
  for (let i = 0; i < R; i++) {
    const a = ring(i / R), b = ring((i + 1) / R);
    for (let k = 0; k < 4; k++) {
      quad(a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k], M.SLATE);
      const p = a[k], q = b[k], r = 0.24;
      quad([p[0] - r, p[1], p[2]], [p[0] + r, p[1], p[2]], [q[0] + r, q[1] + 0.12, q[2]], [q[0] - r, q[1] + 0.12, q[2]], M.LEAD); quad([p[0], p[1], p[2] - r], [p[0], p[1], p[2] + r], [q[0], q[1] + 0.12, q[2] + r], [q[0], q[1] + 0.12, q[2] - r], M.LEAD);
    }
  }
  const top = ring(1), yT = top[0][1];
  quad(top[0], top[1], top[2], top[3], M.LEAD);
  const FT = new Frame(-topH, topH, 1, 0, 0, 1);
  FT.box(-0.3, 2 * topH + 0.3, yT, yT + 0.35, -2 * topH - 0.3, 0.3, M.LEAD, 'u');
  for (let i = 0; i <= 10; i++) { const s = (i / 10) * 2 * topH; for (const [a, b] of [[s, 0], [s, -2 * topH], [0, -s], [2 * topH, -s]]) FT.box(a - 0.05, a + 0.05, yT + 0.35, yT + 1.5, b - 0.05, b + 0.05, M.LEAD, 'tu'); }
  for (const y of [yT + 0.9, yT + 1.5]) { FT.box(0, 2 * topH, y, y + 0.07, -0.04, 0.04, M.LEAD, 'lr'); FT.box(0, 2 * topH, y, y + 0.07, -2 * topH - 0.04, -2 * topH + 0.04, M.LEAD, 'lr'); FT.box(-0.04, 0.04, y, y + 0.07, -2 * topH, 0, M.LEAD, ''); FT.box(2 * topH - 0.04, 2 * topH + 0.04, y, y + 0.07, -2 * topH, 0, M.LEAD, ''); }
  FT.cyl(topH, -topH, 0.7, 0.45, yT + 0.35, yT + 1.6, M.LEAD, 8, true);
}
function clockModule() {
  const F = pavilionFrames()[0], c = PAVILION_HALF, y = T2 + 1.45;
  const disc = (r, o, m) => F.poly(Array.from({ length: 24 }, (_, i) => [c + Math.cos((i / 24) * 6.2832) * r, y + Math.sin((i / 24) * 6.2832) * r, o]), m);
  disc(1.28, 1.0, M.GILT); disc(1.08, 1.03, M.DARK); disc(0.16, 1.06, M.GILT);
  F.box(c - 0.03, c + 0.03, y, y + 0.9, 1.04, 1.07, M.GILT); F.box(c, c + 0.62, y - 0.03, y + 0.03, 1.04, 1.07, M.GILT);
  const yT = T2 + DOME, G = new Frame(0, 0, 1, 0, 0, 1); // the flag over the dome
  G.cyl(0, 0, 0.09, 0.06, yT + 1.6, yT + 11.5, M.IRON, 6, true);
  [M.FB, M.FW, M.FR].forEach((m, i) => G.box(0.08 + i * 1.0, 1.08 + i * 1.0, yT + 9.3, yT + 11.3, -0.015, 0.015, m, ''));
}

/**
 * Builds the modules and where they stand. A placement is { module, x, z, dx, dz, sx, sz }: the
 * module's +x axis points along (dx, dz), its +z axis along (-dz, dx), scaled by sx and sz.
 */
export function buildPalace() {
  const modules = {};
  const make = (name, fn) => { cur = { P: [], N: [], UV: [], MID: [] }; fn(); modules[name] = cur; };
  make('Bay_A', () => bayModule(0)); make('Bay_B', () => bayModule(1)); make('Chimney', chimneyModule); make('Pavilion', () => pavilionModule(true)); make('Pavilion_Low', () => pavilionModule(false)); make('Clock', clockModule);
  const placements = [];
  /** A row of bays from (ax, az) to (bx, bz); the wall faces to the left of that direction... see above. */
  const row = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len, n = Math.max(1, Math.round(len / BAY)), w = len / n;
    for (let i = 0; i < n; i++) placements.push({ module: i % 2 ? 'Bay_B' : 'Bay_A', x: ax + dx * w * i, z: az + dz * w * i, dx, dz, sx: w / BAY, sz: 1 });
    for (let i = 2; i < n; i += 3) placements.push({ module: 'Chimney', x: ax + dx * w * i + dz * 6.4, z: az + dz * w * i - dx * 6.4, dx, dz, sx: 1, sz: 1 });
  };
  /** A wing 22 m deep: façades on both long sides, the roof ridge down the middle. */
  const wing = (x0, z0, x1, z1) => {
    if (x1 - x0 >= z1 - z0) { row(x0, z1, x1, z1); row(x1, z0, x0, z0); } else { row(x0, z0, x0, z1); row(x1, z1, x1, z0); }
  };
  const pavilion = (x, z, scale = 1, tall = true, clock = false) => {
    placements.push({ module: tall ? 'Pavilion' : 'Pavilion_Low', x, z, dx: 1, dz: 0, sx: scale, sz: scale });
    if (clock) placements.push({ module: 'Clock', x, z, dx: 1, dz: 0, sx: scale, sz: scale });
  };
  const D = 22;
  for (const s of [-1, 1]) {
    const lo = (a, b) => Math.min(s * a, s * b), hi = (a, b) => Math.max(s * a, s * b);
    wing(-112, lo(62, 84), 112, hi(62, 84)); // Richelieu (north) and Denon (south) wings on the Cour Napoléon
    wing(-454, lo(106, 128), 134, hi(106, 128)); // the long ranges on the rue de Rivoli and the Seine
    for (const x of [-112, -52, 28, 90]) wing(x, lo(84, 106), x + D, hi(84, 106)); // cross ranges of the inner courts
    wing(112, lo(86, 106), 134, hi(86, 106)); // link to the Cour Carrée
    wing(112, lo(64, 86), 284, hi(64, 86)); // Cour Carrée, north and south ranges
    pavilion(-105, s * 73, 1, false); pavilion(0, s * 73); pavilion(70, s * 73, 1, false); // Turgot, Richelieu, Colbert / Mollien, Denon, Daru
    pavilion(-454, s * 117, 1.12); pavilion(-300, s * 117, 1, false); pavilion(-120, s * 117, 1, false); pavilion(123, s * 117, 0.92, false); // Marsan / Flore and the gallery pavilions
    pavilion(198, s * 75); pavilion(123, s * 75, 0.92, false); pavilion(273, s * 75, 0.92, false); // Cour Carrée: centres and corners
  }
  wing(112, -64, 134, 64); wing(262, -64, 284, 64); // Cour Carrée, west (Sully) and east (Colonnade) ranges
  pavilion(123, 0, 1, true, true); pavilion(273, 0); // Pavillon de l'Horloge, and the centre of the east front
  return { modules, placements, names: NAMES };
}

/** World-space triangles of every placed module: { P, N, UV, MID (indices into `names`) }. */
export function expandPalace({ modules, placements }, y0 = 0) {
  let total = 0;
  for (const p of placements) total += modules[p.module].MID.length;
  const P = new Float32Array(total * 9), N = new Float32Array(total * 9), UV = new Float32Array(total * 6), MID = new Uint16Array(total);
  let t = 0;
  for (const p of placements) {
    const m = modules[p.module], n = m.MID.length;
    for (let i = 0; i < n * 3; i++) {
      const lx = m.P[i * 3] * p.sx, ly = m.P[i * 3 + 1], lz = m.P[i * 3 + 2] * p.sz, o = t * 9 + i * 3;
      P[o] = p.x + p.dx * lx - p.dz * lz; P[o + 1] = ly + y0; P[o + 2] = p.z + p.dz * lx + p.dx * lz;
      const nx = m.N[i * 3], nz = m.N[i * 3 + 2];
      N[o] = p.dx * nx - p.dz * nz; N[o + 1] = m.N[i * 3 + 1]; N[o + 2] = p.dz * nx + p.dx * nz;
    }
    UV.set(m.UV, t * 6); MID.set(m.MID, t);
    t += n;
  }
  return { P, N, UV, MID };
}
