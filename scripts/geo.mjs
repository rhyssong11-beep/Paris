// Shared geometry helpers for the data build.
export const LON0 = 2.3499;
export const LAT0 = 48.853; // Notre-Dame
const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const KY = 110574 * 1.0062; // metres per degree of latitude at 48.85°N

export const proj = ([lon, lat]) => [(lon - LON0) * KX, (lat - LAT0) * KY];
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Douglas-Peucker simplification of an array of [x, y] points. */
export function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const dx = pts[b][0] - ax;
    const dy = pts[b][1] - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    let worst = -1;
    let worstD = tol * tol;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / len2));
      const d = (pts[i][0] - ax - t * dx) ** 2 + (pts[i][1] - ay - t * dy) ** 2;
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function ringArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(a) / 2;
}

export function centroid(pts) {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

export function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Flatten [[x, y], ...] to rounded [x, y, x, y, ...]. */
export const flat = (pts, digits = 0) => {
  const k = 10 ** digits;
  return pts.flatMap((p) => [Math.round(p[0] * k) / k, Math.round(p[1] * k) / k]);
};

/** Outer rings of a Polygon / MultiPolygon geometry, projected. */
export function outerRings(geom) {
  if (!geom) return [];
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return polys.map((p) => p[0].map(proj));
}
