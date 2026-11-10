import type { CityData } from './types';
import { MinHeap } from './util';

export const TRAIN_SPEED = 11; // m/s cruising
export const DWELL = 22; // s stopped at each station
const BOARD_OVERHEAD = 90; // s from street/other platform to platform
const DAY = 86400;

export interface Route {
  id: number;
  line: number;
  stops: number[];
  path: Float32Array;
  /** distance along `path` of each stop */
  at: Float32Array;
  /** cumulative length at each path vertex */
  cum: Float32Array;
  stopIndex: Map<number, number>;
  nextDeparture: number;
}

/** One metro ride: board `line` at station `from`, get off at station `to`. */
export interface Leg {
  line: number;
  from: number;
  to: number;
}

export interface Rider {
  leg: Leg | null;
  /** earliest time the rider can board (models walking through the station) */
  readyAt: number;
  /** maintained by the metro: true while on a train */
  aboard: boolean;
}

export interface Train<R extends Rider> {
  route: Route;
  dist: number;
  /** index into route.stops of the stop the train is at or heading to */
  stop: number;
  dwellUntil: number;
  riders: R[];
  x: number;
  y: number;
  heading: number;
}

export interface MetroPlan {
  cost: number;
  first: number;
  last: number;
  legs: Leg[];
}

export class Metro<R extends Rider> {
  readonly stations: CityData['metro']['stations'];
  readonly lines: { ref: string; color: string; closed: boolean }[];
  readonly routes: Route[] = [];
  /** line indices serving each station */
  readonly stationLines: number[][];
  trains: Train<R>[] = [];
  /** riders waiting at each station */
  waiting: R[][];
  capacity = 40;

  // Routing graph: node s (< S) is the concourse of station s; the rest are (route, stop) platforms.
  private S: number;
  private routeBase: number[] = [];
  private adjStart!: Int32Array;
  private adjTo!: Int32Array;
  private adjCost!: Float32Array;
  private nodeLine!: Int16Array;
  private dist: Float64Array;
  private prev: Int32Array;
  private heap = new MinHeap();

  constructor(data: CityData['metro']) {
    this.stations = data.stations;
    this.S = data.stations.length;
    this.lines = data.lines.map((l) => ({ ref: l.ref, color: l.color, closed: false }));
    this.waiting = data.stations.map(() => []);
    const served = data.stations.map(() => new Set<number>());
    data.lines.forEach((l, li) => {
      for (const r of l.routes) {
        const path = Float32Array.from(r.path);
        const cum = new Float32Array(path.length / 2);
        for (let i = 1; i < cum.length; i++)
          cum[i] = cum[i - 1] + Math.hypot(path[2 * i] - path[2 * i - 2], path[2 * i + 1] - path[2 * i - 1]);
        const stopIndex = new Map<number, number>();
        r.stops.forEach((s, i) => {
          if (!stopIndex.has(s)) stopIndex.set(s, i);
          served[s].add(li);
        });
        this.routes.push({
          id: this.routes.length,
          line: li,
          stops: r.stops,
          path,
          at: Float32Array.from(r.at),
          cum,
          stopIndex,
          nextDeparture: 0,
        });
      }
    });
    this.stationLines = served.map((s) => [...s]);
    this.buildGraph();
    const n = this.adjStart.length - 1;
    this.dist = new Float64Array(n);
    this.prev = new Int32Array(n);
  }

  private buildGraph() {
    let n = this.S;
    for (const r of this.routes) {
      this.routeBase.push(n);
      n += r.stops.length;
    }
    const edges: [number, number, number][] = [];
    this.nodeLine = new Int16Array(n).fill(-1);
    for (const r of this.routes) {
      const base = this.routeBase[r.id];
      r.stops.forEach((s, i) => {
        this.nodeLine[base + i] = r.line;
        edges.push([s, base + i, BOARD_OVERHEAD]); // board (waiting time is added at query time)
        edges.push([base + i, s, 0]); // alight
        if (i + 1 < r.stops.length) edges.push([base + i, base + i + 1, (r.at[i + 1] - r.at[i]) / TRAIN_SPEED + DWELL]);
      });
    }
    const deg = new Int32Array(n + 1);
    for (const e of edges) deg[e[0]]++;
    this.adjStart = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.adjStart[i + 1] = this.adjStart[i] + deg[i];
    this.adjTo = new Int32Array(edges.length);
    this.adjCost = new Float32Array(edges.length);
    const fill = this.adjStart.slice(0, n);
    for (const [a, b, c] of edges) {
      this.adjTo[fill[a]] = b;
      this.adjCost[fill[a]++] = c;
    }
  }

  /** Seconds between trains on a route at simulation time t; 0 when the metro is shut. */
  headway(t: number): number {
    const h = (((t % DAY) + DAY) % DAY) / 3600;
    if (h >= 0.75 && h < 5.5) return 0;
    if ((h >= 7.25 && h < 9.75) || (h >= 16.75 && h < 19.75)) return 150;
    if (h >= 6.5 && h < 21) return 240;
    return 420;
  }

  /**
   * Cheapest metro journey from any of `sources` to any of `targets`.
   * Each entry is [station, access time in seconds]. Returns null if the metro can't make the trip.
   */
  plan(sources: [number, number][], targets: [number, number][], t: number): MetroPlan | null {
    const hw = this.headway(t);
    if (!hw) return null;
    const { dist, prev, heap, adjStart, adjTo, adjCost, nodeLine, S } = this;
    dist.fill(Infinity);
    heap.clear();
    for (const [s, c] of sources) {
      if (c < dist[s]) {
        dist[s] = c;
        prev[s] = -1;
        heap.push(s, c);
      }
    }
    const egress = new Map<number, number>(targets);
    const wait = hw / 2;
    let best = Infinity;
    let bestNode = -1;
    while (heap.size) {
      const u = heap.pop();
      const d = heap.lastKey;
      if (d > dist[u]) continue;
      if (d >= best) break;
      if (u < S) {
        const eg = egress.get(u);
        if (eg !== undefined && prev[u] !== -1 && d + eg < best) {
          best = d + eg;
          bestNode = u;
        }
      }
      for (let k = adjStart[u]; k < adjStart[u + 1]; k++) {
        const v = adjTo[k];
        let c = adjCost[k];
        if (u < S) {
          // boarding edge
          if (this.lines[nodeLine[v]].closed) continue;
          c += wait;
        }
        if (d + c < dist[v]) {
          dist[v] = d + c;
          prev[v] = u;
          heap.push(v, d + c);
        }
      }
    }
    if (bestNode < 0) return null;
    // Reconstruct: every concourse -> platform hop starts a leg, platform -> concourse ends it.
    const legs: Leg[] = [];
    let to = bestNode;
    for (let v = bestNode; prev[v] !== -1; v = prev[v]) {
      const u = prev[v];
      if (v < S) to = v;
      else if (u < S) legs.push({ line: nodeLine[v], from: u, to });
    }
    legs.reverse();
    if (!legs.length) return null;
    return { cost: best, first: legs[0].from, last: bestNode, legs };
  }

  /** Position `d` metres along a route; writes x, y, heading into `out`. */
  locate(route: Route, d: number, out: { x: number; y: number; heading: number }, hint = 0) {
    const { cum, path } = route;
    let i = Math.min(Math.max(hint, 0), cum.length - 2);
    while (i < cum.length - 2 && cum[i + 1] < d) i++;
    while (i > 0 && cum[i] > d) i--;
    const span = cum[i + 1] - cum[i] || 1;
    const f = Math.min(1, Math.max(0, (d - cum[i]) / span));
    const x0 = path[2 * i];
    const y0 = path[2 * i + 1];
    const x1 = path[2 * i + 2];
    const y1 = path[2 * i + 3];
    out.x = x0 + (x1 - x0) * f;
    out.y = y0 + (y1 - y0) * f;
    out.heading = Math.atan2(y1 - y0, x1 - x0);
    return i;
  }

  /**
   * Advance all trains by dt seconds. `onAlight(rider, station, forced)` is called for everyone
   * leaving a train; `forced` is true when they were thrown off (terminus reached early / line closed).
   */
  update(t: number, dt: number, onAlight: (r: R, station: number, forced: boolean) => void) {
    const hw = this.headway(t);
    for (const r of this.routes) {
      if (!hw || this.lines[r.line].closed) {
        r.nextDeparture = 0;
        continue;
      }
      if (r.nextDeparture === 0) r.nextDeparture = t + ((r.id * 37) % hw); // stagger first departures
      if (t >= r.nextDeparture) {
        r.nextDeparture += hw;
        if (r.nextDeparture < t) r.nextDeparture = t + hw;
        this.trains.push({ route: r, dist: r.at[0], stop: 0, dwellUntil: -1, riders: [], x: 0, y: 0, heading: 0 });
      }
    }
    let alive = 0;
    for (const tr of this.trains) {
      if (this.step(tr, t, dt, onAlight)) this.trains[alive++] = tr;
    }
    this.trains.length = alive;
  }

  private step(tr: Train<R>, t: number, dt: number, onAlight: (r: R, station: number, forced: boolean) => void): boolean {
    const r = tr.route;
    let left = dt;
    while (left > 0) {
      const target = r.at[tr.stop];
      if (tr.dist < target) {
        if (left * TRAIN_SPEED < target - tr.dist) {
          tr.dist += left * TRAIN_SPEED;
          break;
        }
        left -= (target - tr.dist) / TRAIN_SPEED;
        tr.dist = target;
      }
      // At a stop.
      const now = t + dt - left;
      if (tr.dwellUntil < 0) {
        const station = r.stops[tr.stop];
        const last = tr.stop === r.stops.length - 1;
        const closed = this.lines[r.line].closed;
        // Alight.
        let keep = 0;
        for (const p of tr.riders) {
          if (last || closed || p.leg!.to === station) {
            p.aboard = false;
            onAlight(p, station, p.leg!.to !== station);
          } else tr.riders[keep++] = p;
        }
        tr.riders.length = keep;
        if (last || closed) return false;
        // Board.
        const queue = this.waiting[station];
        if (queue.length) {
          let q = 0;
          for (const p of queue) {
            const leg = p.leg!;
            const idx = leg.line === r.line ? r.stopIndex.get(leg.to) : undefined;
            const ok = idx !== undefined && idx > tr.stop && p.readyAt <= now && tr.riders.length < this.capacity;
            if (ok) {
              p.aboard = true;
              tr.riders.push(p);
            } else queue[q++] = p;
          }
          queue.length = q;
        }
        tr.dwellUntil = now + DWELL;
      }
      if (now < tr.dwellUntil) {
        const waitFor = Math.min(left, tr.dwellUntil - now);
        left -= waitFor;
        if (now + waitFor < tr.dwellUntil) break;
      }
      tr.dwellUntil = -1;
      tr.stop++;
    }
    tr.stop = Math.min(tr.stop, r.stops.length - 1);
    this.locate(r, tr.dist, tr);
    return true;
  }

  /** Close or reopen a line. Returns riders that were waiting for it and now need a new plan. */
  setClosed(line: number, closed: boolean): R[] {
    this.lines[line].closed = closed;
    const stranded: R[] = [];
    if (!closed) return stranded;
    for (const queue of this.waiting) {
      let q = 0;
      for (const p of queue) {
        if (p.leg!.line === line) stranded.push(p);
        else queue[q++] = p;
      }
      queue.length = q;
    }
    return stranded;
  }
}
