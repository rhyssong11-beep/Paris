import type { CityData } from './types';
import { MinHeap, PointGrid } from './util';

/** Street network: nodes are intersections, edges are street polylines. */
export class RoadGraph {
  readonly nodeX: Float32Array;
  readonly nodeY: Float32Array;
  readonly edgeA: Int32Array;
  readonly edgeB: Int32Array;
  readonly edgeLen: Float32Array;
  readonly edgeCls: Uint8Array;
  /** full polyline of each edge, from A to B, flat x,y */
  readonly edgePts: Float32Array[];
  private adjStart: Int32Array;
  private adjEdge: Int32Array;
  private grid: PointGrid;

  // A* scratch space, reused between queries.
  private g: Float32Array;
  private from: Int32Array;
  private stamp: Int32Array;
  private closed: Int32Array;
  private query = 0;
  private heap = new MinHeap();

  constructor(data: CityData['roads']) {
    const n = data.nodes.length / 2;
    const m = data.edges.length;
    this.nodeX = new Float32Array(n);
    this.nodeY = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.nodeX[i] = data.nodes[2 * i];
      this.nodeY[i] = data.nodes[2 * i + 1];
    }
    this.edgeA = new Int32Array(m);
    this.edgeB = new Int32Array(m);
    this.edgeLen = new Float32Array(m);
    this.edgeCls = new Uint8Array(m);
    this.edgePts = new Array(m);
    const deg = new Int32Array(n + 1);
    for (let e = 0; e < m; e++) {
      const raw = data.edges[e];
      const a = raw[0];
      const b = raw[1];
      this.edgeA[e] = a;
      this.edgeB[e] = b;
      this.edgeCls[e] = raw[2];
      const pts = new Float32Array(raw.length - 3 + 4);
      pts[0] = this.nodeX[a];
      pts[1] = this.nodeY[a];
      for (let k = 3; k < raw.length; k++) pts[k - 1] = raw[k];
      pts[pts.length - 2] = this.nodeX[b];
      pts[pts.length - 1] = this.nodeY[b];
      let len = 0;
      for (let k = 2; k < pts.length; k += 2) len += Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]);
      this.edgeLen[e] = len;
      this.edgePts[e] = pts;
      deg[a]++;
      deg[b]++;
    }
    this.adjStart = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.adjStart[i + 1] = this.adjStart[i] + deg[i];
    this.adjEdge = new Int32Array(2 * m);
    const fill = this.adjStart.slice(0, n);
    for (let e = 0; e < m; e++) {
      this.adjEdge[fill[this.edgeA[e]]++] = e;
      this.adjEdge[fill[this.edgeB[e]]++] = e;
    }
    this.grid = new PointGrid(this.nodeX, this.nodeY, 150);
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.closed = new Int32Array(n);
  }

  get nodeCount() {
    return this.nodeX.length;
  }

  nearestNode(x: number, y: number) {
    return this.grid.nearest(x, y);
  }

  /** Shortest walking path between two nodes as a flat x,y polyline, or null if unreachable. */
  path(src: number, dst: number): number[] | null {
    const { nodeX, nodeY, g, from, stamp, closed, heap, adjStart, adjEdge, edgeA, edgeB, edgeLen } = this;
    if (src === dst) return [nodeX[src], nodeY[src]];
    const q = ++this.query;
    const tx = nodeX[dst];
    const ty = nodeY[dst];
    heap.clear();
    g[src] = 0;
    stamp[src] = q;
    from[src] = -1;
    heap.push(src, Math.hypot(nodeX[src] - tx, nodeY[src] - ty));
    let found = false;
    while (heap.size) {
      const u = heap.pop();
      if (closed[u] === q) continue;
      closed[u] = q;
      if (u === dst) {
        found = true;
        break;
      }
      const gu = g[u];
      for (let k = adjStart[u]; k < adjStart[u + 1]; k++) {
        const e = adjEdge[k];
        const v = edgeA[e] === u ? edgeB[e] : edgeA[e];
        if (closed[v] === q) continue;
        const gv = gu + edgeLen[e];
        if (stamp[v] !== q || gv < g[v]) {
          g[v] = gv;
          stamp[v] = q;
          from[v] = e;
          heap.push(v, gv + Math.hypot(nodeX[v] - tx, nodeY[v] - ty));
        }
      }
    }
    if (!found) return null;
    // Walk back from dst collecting edges, then emit points in forward order.
    const edges: number[] = [];
    for (let u = dst; u !== src; ) {
      const e = from[u];
      edges.push(e);
      u = edgeA[e] === u ? edgeB[e] : edgeA[e];
    }
    const out: number[] = [nodeX[src], nodeY[src]];
    let u = src;
    for (let i = edges.length - 1; i >= 0; i--) {
      const e = edges[i];
      const pts = this.edgePts[e];
      if (edgeA[e] === u) {
        for (let k = 2; k < pts.length; k++) out.push(pts[k]);
        u = edgeB[e];
      } else {
        for (let k = pts.length - 4; k >= 0; k -= 2) out.push(pts[k], pts[k + 1]);
        u = edgeA[e];
      }
    }
    return out;
  }
}
