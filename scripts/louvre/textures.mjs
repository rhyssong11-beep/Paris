// Tileable textures for the palace, generated from hashes so they need no image files.
// Each is a brightness-and-tint map that multiplies the material's base colour.
import { deflateSync, crc32 } from 'node:zlib';

const hash = (i, j) => { let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const mod = (a, n) => ((a % n) + n) % n;
/** Smooth noise that repeats every `p` cells. */
const noise = (x, y, p) => {
  const i = Math.floor(x), j = Math.floor(y); let fx = x - i, fy = y - j; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const h = (a, b) => hash(mod(a, p), mod(b, p) + p * 7);
  return (h(i, j) * (1 - fx) + h(i + 1, j) * fx) * (1 - fy) + (h(i, j + 1) * (1 - fx) + h(i + 1, j + 1) * fx) * fy;
};
const fbm = (u, v, p) => noise(u * p, v * p, p) * 0.5 + noise(u * p * 2, v * p * 2, p * 2) * 0.3 + noise(u * p * 4, v * p * 4, p * 4) * 0.2;

const KINDS = {
  // Ashlar: four blocks across and ten courses up, in a running bond, with staining and grain.
  stone(u, v) {
    const row = Math.floor(v * 10), uu = u * 4 + (row & 1) * 0.5, col = mod(Math.floor(uu), 4), fx = uu - Math.floor(uu), fy = v * 10 - row;
    let k = 0.84 + 0.14 * hash(col, row);
    if (fx < 0.016 || fy < 0.045) k *= 0.74;
    k *= 0.86 + 0.2 * fbm(u, v, 3) + 0.06 * noise(u * 64, v * 64, 64);
    const warm = (hash(col + 31, row) - 0.5) * 0.06;
    return [k * (1 + warm), k, k * (1 - warm * 1.6)];
  },
  trim(u, v) { const k = 0.82 + 0.2 * fbm(u, v, 4) + 0.06 * noise(u * 48, v * 48, 48); return [k, k, k]; },
  // Slates: ten across and ten rows up, each its own shade.
  slate(u, v) {
    const row = Math.floor(v * 10), uu = u * 10 + (row & 1) * 0.5, col = mod(Math.floor(uu), 10), r = hash(col + 3, row + 17);
    let k = 0.55 + 0.42 * r;
    if (uu - Math.floor(uu) < 0.07 || v * 10 - row < 0.12) k *= 0.6;
    k *= 0.8 + 0.3 * fbm(u, v, 3);
    return [k * (0.95 + 0.08 * hash(col, row + 9)), k, k * (0.96 + 0.08 * hash(col + 5, row))].map((c) => Math.min(1, c));
  },
  // Lead sheet: a standing seam every 0.75 m and a mottled patina.
  lead(u, v) { const f = u * 4 - Math.floor(u * 4), k = (f < 0.05 ? 1 : 0.8) * (0.72 + 0.32 * fbm(u, v, 4)); return [k, k, k]; },
};

const toSrgb = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)));
/** { stone, trim, slate, lead }: each { w, h, data: RGBA bytes in sRGB } */
export function makeTextures(size = 512) {
  const out = {};
  for (const [name, fn] of Object.entries(KINDS)) {
    const s = name === 'trim' || name === 'lead' ? size / 2 : size, data = new Uint8Array(s * s * 4);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const c = fn((x + 0.5) / s, (y + 0.5) / s), i = (y * s + x) * 4; data[i] = toSrgb(c[0]); data[i + 1] = toSrgb(c[1]); data[i + 2] = toSrgb(c[2]); data[i + 3] = 255; }
    out[name] = { w: s, h: s, data };
  }
  return out;
}

export function encodePng({ w, h, data }) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) raw[y * (w * 3 + 1) + 1 + x * 3 + c] = data[(y * w + x) * 4 + c];
  const chunk = (type, body) => { const len = Buffer.alloc(4); len.writeUInt32BE(body.length); const td = Buffer.concat([Buffer.from(type), body]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}
