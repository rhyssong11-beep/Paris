// A bounding-volume hierarchy over a triangle soup, for the light baking in the Louvre build.

/** `P` holds nine floats per triangle. Returns the tree and a ray test against it. */
export function buildBvh(P) {
  const T = P.length / 9;
  const cen = new Float32Array(T * 3), tb = new Float32Array(T * 6);
  for (let i = 0; i < T; i++) for (let a = 0; a < 3; a++) {
    const x = P[i * 9 + a], y = P[i * 9 + 3 + a], z = P[i * 9 + 6 + a], lo = Math.min(x, y, z), hi = Math.max(x, y, z);
    tb[i * 6 + a] = lo; tb[i * 6 + 3 + a] = hi; cen[i * 3 + a] = (lo + hi) / 2;
  }
  const order = new Uint32Array(T).map((_, i) => i);
  const NB = new Float32Array(T * 2 * 6), NI = new Int32Array(T * 2 * 2); // bounds; [right child | first triangle, count]
  let count = 0;
  const build = (s, e) => {
    const node = count++, b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], c = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let k = s; k < e; k++) for (let a = 0; a < 3; a++) {
      const i = order[k];
      if (tb[i * 6 + a] < b[a]) b[a] = tb[i * 6 + a]; if (tb[i * 6 + 3 + a] > b[a + 3]) b[a + 3] = tb[i * 6 + 3 + a];
      if (cen[i * 3 + a] < c[a]) c[a] = cen[i * 3 + a]; if (cen[i * 3 + a] > c[a + 3]) c[a + 3] = cen[i * 3 + a];
    }
    NB.set(b, node * 6);
    if (e - s <= 4) { NI[node * 2] = s; NI[node * 2 + 1] = e - s; return node; }
    let ax = 0; if (c[4] - c[1] > c[3] - c[0]) ax = 1; if (c[5] - c[2] > c[ax + 3] - c[ax]) ax = 2;
    const mid = (c[ax] + c[ax + 3]) / 2;
    let i = s, j = e - 1;
    while (i <= j) { if (cen[order[i] * 3 + ax] < mid) i++; else { const t = order[i]; order[i] = order[j]; order[j] = t; j--; } }
    if (i === s || i === e) i = (s + e) >> 1;
    build(s, i);
    NI[node * 2] = build(i, e);
    return node;
  };
  build(0, T);
  const TRI = new Float32Array(T * 9); // first corner and the two edges from it
  for (let k = 0; k < T; k++) {
    const i = order[k] * 9, o = k * 9;
    for (let a = 0; a < 3; a++) { TRI[o + a] = P[i + a]; TRI[o + 3 + a] = P[i + 3 + a] - P[i + a]; TRI[o + 6 + a] = P[i + 6 + a] - P[i + a]; }
  }
  const stack = new Int32Array(128);
  /** True when anything lies along the ray within `tmax`. */
  const occluded = (ox, oy, oz, dx, dy, dz, tmax) => {
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    let sp = 0, node = 0;
    for (;;) {
      const b = node * 6;
      let t0 = (NB[b] - ox) * ix, t1 = (NB[b + 3] - ox) * ix, lo = t0 < t1 ? t0 : t1, hi = t0 < t1 ? t1 : t0;
      t0 = (NB[b + 1] - oy) * iy; t1 = (NB[b + 4] - oy) * iy;
      let a = t0 < t1 ? t0 : t1, c = t0 < t1 ? t1 : t0;
      if (a > lo) lo = a; if (c < hi) hi = c;
      t0 = (NB[b + 2] - oz) * iz; t1 = (NB[b + 5] - oz) * iz;
      a = t0 < t1 ? t0 : t1; c = t0 < t1 ? t1 : t0;
      if (a > lo) lo = a; if (c < hi) hi = c;
      if (lo <= hi && hi > 0 && lo < tmax) {
        const n = NI[node * 2 + 1];
        if (n === 0) { stack[sp++] = NI[node * 2]; node++; continue; }
        const first = NI[node * 2];
        for (let k = first; k < first + n; k++) {
          const o = k * 9, e1x = TRI[o + 3], e1y = TRI[o + 4], e1z = TRI[o + 5], e2x = TRI[o + 6], e2y = TRI[o + 7], e2z = TRI[o + 8];
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
          if (det > -1e-12 && det < 1e-12) continue;
          const inv = 1 / det, tx = ox - TRI[o], ty = oy - TRI[o + 1], tz = oz - TRI[o + 2], u = (tx * px + ty * py + tz * pz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) * inv;
          if (v < 0 || u + v > 1) continue;
          const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (t > 1e-4 && t < tmax) return true;
        }
      }
      if (sp === 0) return false;
      node = stack[--sp];
    }
  };
  return { occluded };
}

/**
 * How open each corner of each triangle is to the sky and its surroundings: 1 in the open, towards 0 in
 * creases and recesses. `P` and `N` are world-space corners and normals (nine floats per triangle).
 */
export function bakeOcclusion(occluded, P, N, { rays = 40, reach = 16 } = {}) {
  const T = P.length / 9, out = new Float32Array(T * 3);
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let t = 0; t < T; t++) {
    const o = t * 9, cx = (P[o] + P[o + 3] + P[o + 6]) / 3, cy = (P[o + 1] + P[o + 4] + P[o + 7]) / 3, cz = (P[o + 2] + P[o + 5] + P[o + 8]) / 3;
    for (let k = 0; k < 3; k++) {
      const nx = N[o + k * 3], ny = N[o + k * 3 + 1], nz = N[o + k * 3 + 2];
      // start a little inside the triangle and off its surface, so shared edges do not block themselves
      const x = P[o + k * 3] * 0.9 + cx * 0.1 + nx * 0.04, y = P[o + k * 3 + 1] * 0.9 + cy * 0.1 + ny * 0.04, z = P[o + k * 3 + 2] * 0.9 + cz * 0.1 + nz * 0.04;
      let tx = Math.abs(nx) > 0.9 ? 0 : 1, ty = Math.abs(nx) > 0.9 ? 1 : 0, tz = 0;
      let bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
      const l = 1 / Math.hypot(bx, by, bz); bx *= l; by *= l; bz *= l;
      tx = by * nz - bz * ny; ty = bz * nx - bx * nz; tz = bx * ny - by * nx;
      let open = 0;
      for (let r = 0; r < rays; r++) {
        const r1 = (r + rnd()) / rays, a = rnd() * Math.PI * 2, sr = Math.sqrt(r1), c = Math.sqrt(1 - r1), u = sr * Math.cos(a), v = sr * Math.sin(a);
        if (!occluded(x, y, z, tx * u + bx * v + nx * c, ty * u + by * v + ny * c, tz * u + bz * v + nz * c, reach)) open++;
      }
      out[t * 3 + k] = open / rays;
    }
  }
  return out;
}
