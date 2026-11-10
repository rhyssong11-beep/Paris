/** Small deterministic PRNG (mulberry32) so runs are reproducible. */
export function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type Rng = () => number;

/** Approximately normal sample (sum of uniforms). */
export function gauss(rng: Rng, mean: number, sd: number) {
  return mean + sd * (rng() + rng() + rng() + rng() - 2) * 1.732;
}

/** Binary min-heap keyed by a number, storing integer ids. */
export class MinHeap {
  private keys: number[] = [];
  private ids: number[] = [];
  get size() {
    return this.ids.length;
  }
  clear() {
    this.keys.length = 0;
    this.ids.length = 0;
  }
  push(id: number, key: number) {
    const { keys, ids } = this;
    let i = ids.length;
    keys.push(key);
    ids.push(id);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      ids[i] = ids[p];
      i = p;
    }
    keys[i] = key;
    ids[i] = id;
  }
  /** Removes the smallest entry and returns its id; its key is left in `lastKey`. */
  lastKey = 0;
  pop(): number {
    const { keys, ids } = this;
    const top = ids[0];
    this.lastKey = keys[0];
    const key = keys.pop()!;
    const id = ids.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        ids[i] = ids[c];
        i = c;
      }
      keys[i] = key;
      ids[i] = id;
    }
    return top;
  }
}

/** Uniform grid for nearest-point queries over a fixed point set. */
export class PointGrid {
  private cells = new Map<number, number[]>();
  constructor(
    private xs: ArrayLike<number>,
    private ys: ArrayLike<number>,
    private cell: number,
  ) {
    for (let i = 0; i < xs.length; i++) {
      const k = this.key(Math.floor(xs[i] / cell), Math.floor(ys[i] / cell));
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = []));
      c.push(i);
    }
  }
  private key(cx: number, cy: number) {
    return (cx + 4096) * 8192 + (cy + 4096);
  }
  /** Indices within `radius` of (x, y), nearest first, at most `limit`. */
  near(x: number, y: number, radius: number, limit = Infinity): number[] {
    const { xs, ys, cell } = this;
    const out: { i: number; d: number }[] = [];
    const r2 = radius * radius;
    const x0 = Math.floor((x - radius) / cell);
    const x1 = Math.floor((x + radius) / cell);
    const y0 = Math.floor((y - radius) / cell);
    const y1 = Math.floor((y + radius) / cell);
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const c = this.cells.get(this.key(cx, cy));
        if (!c) continue;
        for (const i of c) {
          const d = (xs[i] - x) ** 2 + (ys[i] - y) ** 2;
          if (d <= r2) out.push({ i, d });
        }
      }
    out.sort((a, b) => a.d - b.d);
    if (out.length > limit) out.length = limit;
    return out.map((o) => o.i);
  }
  /** Nearest index, widening the search until something is found. */
  nearest(x: number, y: number, maxRadius = 20000): number {
    for (let r = this.cell; r <= maxRadius; r *= 2) {
      const hit = this.near(x, y, r, 1);
      if (hit.length) return hit[0];
    }
    return -1;
  }
}

export function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}
export function fmtClock(simSeconds: number) {
  const s = ((simSeconds % 86400) + 86400) % 86400;
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}`;
}
