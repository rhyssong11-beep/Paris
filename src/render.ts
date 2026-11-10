import type { CityData } from './types';
import { type Simulation, State } from './sim';

export const COLORS = {
  resident: '#ffd166',
  tourist: '#5ad1ff',
  home: '#56617a',
  work: '#9d8cff',
  out: '#5fd38d',
  walking: '#ffd166',
  waiting: '#ff7b72',
  riding: '#5ad1ff',
};

export interface Camera {
  x: number;
  y: number;
  /** pixels per metre */
  k: number;
}

/** Draws the static map on one canvas and everything that moves on another. */
export class Renderer {
  readonly cam: Camera = { x: 0, y: 0, k: 0.08 };
  width = 0;
  height = 0;
  private dpr = 1;
  private mapCtx: CanvasRenderingContext2D;
  private liveCtx: CanvasRenderingContext2D;
  private mapDirty = true;
  private paths: {
    land: Path2D;
    borders: Path2D;
    water: Path2D;
    green: Path2D;
    minor: Path2D;
    major: Path2D;
    lines: Path2D[];
  };

  constructor(
    private mapCanvas: HTMLCanvasElement,
    private liveCanvas: HTMLCanvasElement,
    private data: CityData,
    private sim: Simulation,
  ) {
    this.mapCtx = mapCanvas.getContext('2d')!;
    this.liveCtx = liveCanvas.getContext('2d')!;
    const ring = (p: Path2D, r: number[]) => {
      p.moveTo(r[0], r[1]);
      for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]);
      p.closePath();
    };
    const land = new Path2D();
    const borders = new Path2D();
    for (const a of data.arrondissements) {
      ring(land, a.ring);
      ring(borders, a.ring);
    }
    const water = new Path2D();
    for (const w of data.water) ring(water, w);
    const green = new Path2D();
    for (const g of data.green) ring(green, g.ring);
    const minor = new Path2D();
    const major = new Path2D();
    const { roads } = sim;
    for (let e = 0; e < roads.edgePts.length; e++) {
      const pts = roads.edgePts[e];
      const p = roads.edgeCls[e] === 0 ? major : minor;
      p.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
    }
    const lines = data.metro.lines.map((l) => {
      const p = new Path2D();
      for (const r of l.routes) {
        p.moveTo(r.path[0], r.path[1]);
        for (let i = 2; i < r.path.length; i += 2) p.lineTo(r.path[i], r.path[i + 1]);
      }
      return p;
    });
    this.paths = { land, borders, water, green, minor, major, lines };
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    for (const c of [this.mapCanvas, this.liveCanvas]) {
      c.width = Math.round(this.width * this.dpr);
      c.height = Math.round(this.height * this.dpr);
    }
    this.mapDirty = true;
  }

  /** Fit the whole city in the part of the viewport not covered by UI. */
  fit(padRight = 0, padBottom = 0) {
    const [x0, y0, x1, y1] = this.data.bounds;
    const w = Math.max(200, this.width - padRight);
    const h = Math.max(200, this.height - padBottom);
    this.cam.k = Math.min(w / (x1 - x0), h / (y1 - y0)) * 0.94;
    this.cam.x = (x0 + x1) / 2 + padRight / 2 / this.cam.k;
    this.cam.y = (y0 + y1) / 2 - padBottom / 2 / this.cam.k;
    this.mapDirty = true;
  }

  invalidate() {
    this.mapDirty = true;
  }

  toScreen(x: number, y: number): [number, number] {
    const { cam } = this;
    return [(x - cam.x) * cam.k + this.width / 2, (cam.y - y) * cam.k + this.height / 2];
  }
  toWorld(sx: number, sy: number): [number, number] {
    const { cam } = this;
    return [(sx - this.width / 2) / cam.k + cam.x, cam.y - (sy - this.height / 2) / cam.k];
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const { cam } = this;
    const [wx, wy] = this.toWorld(sx, sy);
    cam.k = Math.min(3, Math.max(0.02, cam.k * factor));
    cam.x = wx - (sx - this.width / 2) / cam.k;
    cam.y = wy + (sy - this.height / 2) / cam.k;
    this.mapDirty = true;
  }

  private worldTransform(ctx: CanvasRenderingContext2D) {
    const { cam, dpr } = this;
    const s = cam.k * dpr;
    ctx.setTransform(s, 0, 0, -s, (this.width / 2 - cam.x * cam.k) * dpr, (this.height / 2 + cam.y * cam.k) * dpr);
  }

  private drawMap() {
    const ctx = this.mapCtx;
    const { cam, dpr, paths, data } = this;
    const px = 1 / cam.k; // one CSS pixel in metres
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    this.worldTransform(ctx);
    ctx.lineJoin = ctx.lineCap = 'round';

    ctx.fillStyle = '#171c26';
    ctx.fill(paths.land);
    ctx.fillStyle = '#1b3526';
    ctx.fill(paths.green);
    ctx.fillStyle = '#1c4263';
    ctx.fill(paths.water);

    if (cam.k > 0.035) {
      ctx.strokeStyle = '#262d3a';
      ctx.lineWidth = Math.max(0.6 * px, 5);
      ctx.stroke(paths.minor);
    }
    ctx.strokeStyle = '#374053';
    ctx.lineWidth = Math.max(1 * px, 12);
    ctx.stroke(paths.major);

    ctx.strokeStyle = 'rgba(160, 172, 196, 0.35)';
    ctx.lineWidth = 1 * px;
    ctx.setLineDash([5 * px, 5 * px]);
    ctx.stroke(paths.borders);
    ctx.setLineDash([]);

    const { lines } = this.sim.metro;
    ctx.lineWidth = Math.max(2.4 * px, 14);
    lines.forEach((l, i) => {
      ctx.globalAlpha = l.closed ? 0.18 : 0.85;
      ctx.strokeStyle = l.color;
      ctx.stroke(paths.lines[i]);
    });
    ctx.globalAlpha = 1;

    // Stations and labels are drawn in screen space so text stays upright.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (cam.k > 0.04) {
      const r = Math.max(1.6, Math.min(4.5, cam.k * 16));
      ctx.fillStyle = '#f2f4f8';
      ctx.strokeStyle = '#0d1117';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const s of data.metro.stations) {
        const [sx, sy] = this.toScreen(s.x, s.y);
        if (sx < -10 || sy < -10 || sx > this.width + 10 || sy > this.height + 10) continue;
        ctx.moveTo(sx + r, sy);
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
      }
      ctx.fill();
      if (r > 2.5) ctx.stroke();
    }
    ctx.textBaseline = 'middle';
    const halo = (text: string, x: number, y: number) => {
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    };
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(13, 17, 23, 0.85)';
    if (cam.k < 0.2) {
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(200, 208, 224, 0.5)';
      for (const a of data.arrondissements) {
        const [sx, sy] = this.toScreen(a.cx, a.cy);
        halo(`${a.n}`, sx, sy);
      }
    }
    if (cam.k > 0.22) {
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#c9d1e0';
      for (const s of data.metro.stations) {
        const [sx, sy] = this.toScreen(s.x, s.y);
        if (sx < -100 || sy < -10 || sx > this.width || sy > this.height + 10) continue;
        halo(s.name, sx + 7, sy - 7);
      }
    }
    if (cam.k > 0.07) {
      ctx.font = '600 11.5px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const p of data.pois) {
        const [sx, sy] = this.toScreen(p.x, p.y);
        if (sx < -80 || sy < -20 || sx > this.width + 80 || sy > this.height + 20) continue;
        ctx.fillStyle = '#ffb4a2';
        ctx.beginPath();
        ctx.moveTo(sx, sy - 4.5);
        ctx.lineTo(sx + 4.5, sy);
        ctx.lineTo(sx, sy + 4.5);
        ctx.lineTo(sx - 4.5, sy);
        ctx.fill();
        if (cam.k > 0.1) halo(p.name, sx, sy + 13);
      }
    }
  }

  draw() {
    if (this.mapDirty) {
      this.drawMap();
      this.mapDirty = false;
    }
    const ctx = this.liveCtx;
    const { cam, dpr, sim } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const ox = this.width / 2 - cam.x * cam.k;
    const oy = this.height / 2 + cam.y * cam.k;
    const k = cam.k;
    const W = this.width;
    const H = this.height;

    // People. Riders are inside trains and platform crowds are drawn as halos, so skip both.
    const size = Math.max(2.2, Math.min(4.5, k * 10));
    const half = size / 2;
    const groups: [string, number, (tourist: boolean, state: State) => boolean][] = [
      [COLORS.home, 0.55, (_t, s) => s === State.Idle],
      [COLORS.resident, 1, (t, s) => s === State.Walk && !t],
      [COLORS.tourist, 1, (t, s) => s === State.Walk && t],
    ];
    for (const [color, alpha, match] of groups) {
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      const sz = alpha < 1 ? Math.max(1.2, size * 0.6) : size;
      for (const a of sim.agents) {
        if (!match(a.tourist, a.state)) continue;
        const sx = a.x * k + ox;
        const sy = oy - a.y * k;
        if (sx < 0 || sy < 0 || sx > W || sy > H) continue;
        ctx.fillRect(sx - half, sy - half, sz, sz);
      }
    }
    ctx.globalAlpha = 1;

    // Platform crowds.
    const st = this.data.metro.stations;
    ctx.fillStyle = 'rgba(255, 123, 114, 0.35)';
    ctx.strokeStyle = COLORS.waiting;
    ctx.lineWidth = 1.2;
    const unit = Math.max(2.2, Math.min(5, k * 26));
    for (let i = 0; i < st.length; i++) {
      const n = sim.metro.waiting[i].length;
      if (!n) continue;
      const sx = st[i].x * k + ox;
      const sy = oy - st[i].y * k;
      if (sx < -40 || sy < -40 || sx > W + 40 || sy > H + 40) continue;
      ctx.beginPath();
      ctx.arc(sx, sy, unit * Math.sqrt(n), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Trains.
    const len = Math.max(6.5, 75 * k);
    const wid = Math.max(3, Math.min(9, 14 * k));
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    for (const tr of sim.metro.trains) {
      const sx = tr.x * k + ox;
      const sy = oy - tr.y * k;
      if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(-tr.heading);
      ctx.fillStyle = sim.metro.lines[tr.route.line].color;
      ctx.beginPath();
      ctx.roundRect(-len / 2, -wid / 2, len, wid, wid / 2.5);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}
