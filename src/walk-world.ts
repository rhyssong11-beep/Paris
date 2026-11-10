/**
 * Walking on foot through a 3D scene, without a physics engine.
 *
 * The scene's triangles are sampled once into a coarse grid. Each cell remembers the heights of the
 * surfaces you could stand on there and the vertical extents of anything solid. A walker then only
 * needs two questions answered per step: "how high is the ground here, given where my feet are?"
 * and "is there something at body height in the way?". Keeping several floor heights per cell is
 * what lets you walk under the tower's platforms or across a bridge deck instead of being
 * teleported on top of whatever is highest.
 *
 * This file is plain maths (no Three.js) so it can be unit-tested.
 */

const NONE = -32768;
const CM = 100;
const FLOORS = 3; // floor heights kept per cell
const SPANS = 2; // solid vertical extents kept per cell
const MAX_Y = 60; // nothing above this can be reached on foot
const SAMPLE = 0.45; // spacing of samples taken across each triangle, metres

export const STEP_UP = 0.6; // tallest kerb you can walk up
export const BODY_FROM = 0.65; // obstacles lower than this are stepped over...
export const BODY_TO = 1.8; // ...and higher than this are walked under
export const BODY_RADIUS = 0.35;
export const EYE_HEIGHT = 1.68;

export class WalkGrid {
  readonly size: number;
  private floors: Int16Array;
  private spans: Int16Array;

  /** Covers the square from -extent to +extent in x and z, in cells `cell` metres wide. */
  constructor(
    readonly extent: number,
    readonly cell = 1,
  ) {
    this.size = Math.ceil((extent * 2) / cell);
    this.floors = new Int16Array(this.size * this.size * FLOORS).fill(NONE);
    this.spans = new Int16Array(this.size * this.size * SPANS * 2).fill(NONE);
  }

  private index(x: number, z: number) {
    const cx = Math.floor((x + this.extent) / this.cell);
    const cz = Math.floor((z + this.extent) / this.cell);
    return cx < 0 || cz < 0 || cx >= this.size || cz >= this.size ? -1 : cz * this.size + cx;
  }

  /** Record a surface that can be stood on. */
  addFloor(x: number, y: number, z: number) {
    const i = this.index(x, z);
    if (i < 0 || y > MAX_Y || y < -20) return;
    const v = Math.round(y * CM);
    const f = this.floors;
    let highest = i * FLOORS;
    for (let s = i * FLOORS; s < (i + 1) * FLOORS; s++) {
      if (f[s] === NONE) {
        f[s] = v;
        return;
      }
      if (Math.abs(f[s] - v) < 15) {
        if (v > f[s]) f[s] = v;
        return;
      }
      if (f[s] > f[highest]) highest = s;
    }
    if (v < f[highest]) f[highest] = v; // full: keep the lowest ones, they are the reachable ones
  }

  /** Record something solid between heights y0 and y1. */
  addSolid(x: number, y0: number, y1: number, z: number) {
    const i = this.index(x, z);
    if (i < 0 || y0 > MAX_Y) return;
    const lo = Math.round(Math.max(-20, y0) * CM);
    const hi = Math.round(Math.min(MAX_Y, y1) * CM);
    const p = this.spans;
    const base = i * SPANS * 2;
    let nearest = base;
    let nearestGap = Infinity;
    for (let s = base; s < base + SPANS * 2; s += 2) {
      if (p[s] === NONE) {
        p[s] = lo;
        p[s + 1] = hi;
        return;
      }
      const gap = Math.max(p[s] - hi, lo - p[s + 1]);
      if (gap < 60) {
        // touching or nearly: grow the existing extent
        if (lo < p[s]) p[s] = lo;
        if (hi > p[s + 1]) p[s + 1] = hi;
        return;
      }
      if (gap < nearestGap) {
        nearestGap = gap;
        nearest = s;
      }
    }
    if (lo < p[nearest]) p[nearest] = lo;
    if (hi > p[nearest + 1]) p[nearest + 1] = hi;
  }

  /**
   * Sample a triangle into the grid. Near-horizontal faces become floor; everything else
   * (walls, girders, slopes too steep to climb) becomes solid.
   */
  addTriangle(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) {
    const e = this.extent;
    if (Math.min(ay, by, cy) > MAX_Y) return;
    if (Math.min(ax, bx, cx) > e || Math.max(ax, bx, cx) < -e || Math.min(az, bz, cz) > e || Math.max(az, bz, cz) < -e) return;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return;
    // Either winding counts: models are not always consistent about which side of a face is 'out',
    // and a near-horizontal surface is something to stand on whichever way it nominally faces.
    const floor = Math.abs(ny) / len > 0.7;
    const longest = Math.max(Math.hypot(ux, uy, uz), Math.hypot(vx, vy, vz), Math.hypot(cx - bx, cy - by, cz - bz));
    const n = Math.min(700, Math.max(1, Math.ceil(longest / SAMPLE)));
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      for (let j = 0; j <= n - i; j++) {
        const t = j / n;
        const x = ax + ux * s + vx * t;
        const y = ay + uy * s + vy * t;
        const z = az + uz * s + vz * t;
        if (floor) this.addFloor(x, y, z);
        else this.addSolid(x, y, y, z);
      }
    }
  }

  /** Mark the outline of an upright box (a building, a trunk) as solid from y0 to y1. */
  addBoxOutline(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number) {
    const step = this.cell * 0.5;
    for (let x = x0; x <= x1; x += step) {
      this.addSolid(x, y0, y1, z0);
      this.addSolid(x, y0, y1, z1);
    }
    for (let z = z0; z <= z1; z += step) {
      this.addSolid(x0, y0, y1, z);
      this.addSolid(x1, y0, y1, z);
    }
  }

  /** Height of the ground at (x, z) for someone whose feet are at `feet`: the highest floor within a step up. Open ground is 0. */
  ground(x: number, z: number, feet: number) {
    const i = this.index(x, z);
    let best = 0 <= feet + STEP_UP ? 0 : -Infinity;
    if (i < 0) return best;
    const limit = (feet + STEP_UP) * CM;
    for (let s = i * FLOORS; s < (i + 1) * FLOORS; s++) {
      const v = this.floors[s];
      if (v !== NONE && v <= limit && v / CM > best) best = v / CM;
    }
    return best;
  }

  /** Whether something solid occupies body height above ground level `ground` at (x, z). */
  blocked(x: number, z: number, ground: number) {
    const i = this.index(x, z);
    if (i < 0) return false;
    const lo = (ground + BODY_FROM) * CM;
    const hi = (ground + BODY_TO) * CM;
    for (let s = i * SPANS * 2; s < (i + 1) * SPANS * 2; s += 2) {
      const a = this.spans[s];
      if (a !== NONE && a < hi && this.spans[s + 1] > lo) return true;
    }
    return false;
  }
}

export interface WalkInput {
  /** +1 forward, -1 back */
  forward: number;
  /** +1 right, -1 left */
  right: number;
  run: boolean;
  /** held down: jump as soon as the feet are on the ground */
  jump?: boolean;
}

const WALK_SPEED = 9; // m/s: far quicker than a real stroll, so the large site is quick to cross
const RUN_SPEED = 18;
const JUMP_SPEED = 7; // m/s upwards at take-off: about 1.2 m high, 0.7 s in the air
const GRAVITY = 20; // m/s², stronger than real so jumps feel snappy at these speeds
const MAX_PITCH = (85 * Math.PI) / 180;

/** A person on foot: position of the feet, and where they are looking. */
export class Walker {
  x = 0;
  /** height of the feet */
  y = 0;
  z = 0;
  /** radians, counter-clockwise seen from above; 0 looks along -z */
  yaw = 0;
  /** radians, positive looks up */
  pitch = 0;
  private vx = 0;
  private vz = 0;
  private vy = 0;
  /** false while jumping or falling */
  onGround = true;

  constructor(
    private grid: WalkGrid,
    /** extra rule for places that are off limits whatever the geometry says (water, the scene's edge) */
    private allowed: (x: number, z: number) => boolean = () => true,
  ) {}

  place(x: number, z: number, yaw: number, pitch = 0) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.pitch = pitch;
    this.vx = this.vz = this.vy = 0;
    this.onGround = true;
    this.y = this.grid.ground(x, z, MAX_Y);
  }

  look(dYaw: number, dPitch: number) {
    this.yaw = (this.yaw + dYaw) % (Math.PI * 2);
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + dPitch));
  }

  /** Ground height if a person can stand at (x, z), or null if something is in the way. */
  private standAt(x: number, z: number): number | null {
    if (!this.allowed(x, z)) return null;
    const g = this.grid.ground(x, z, this.y);
    // In the air the body is wherever the feet are, so a jump can clear what a walk cannot.
    const base = this.onGround ? g : Math.max(g, this.y);
    const r = BODY_RADIUS;
    if (
      this.grid.blocked(x, z, base) ||
      this.grid.blocked(x + r, z, base) ||
      this.grid.blocked(x - r, z, base) ||
      this.grid.blocked(x, z + r, base) ||
      this.grid.blocked(x, z - r, base)
    )
      return null;
    return g;
  }

  step(input: WalkInput, dt: number) {
    const speed = input.run ? RUN_SPEED : WALK_SPEED;
    let f = input.forward;
    let r = input.right;
    const mag = Math.hypot(f, r);
    if (mag > 1) {
      f /= mag;
      r /= mag;
    }
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wantX = (-sin * f + cos * r) * speed;
    const wantZ = (-cos * f - sin * r) * speed;
    // Ease towards the wanted velocity: quick to start, quick to stop, never sliding on.
    const k = Math.min(1, dt * 12);
    this.vx += (wantX - this.vx) * k;
    this.vz += (wantZ - this.vz) * k;
    if (Math.abs(this.vx) > 1e-3 || Math.abs(this.vz) > 1e-3) this.moveHorizontally(dt);
    this.moveVertically(input.jump === true, dt);
  }

  private moveHorizontally(dt: number) {
    // Move in sub-steps no longer than a third of a cell so thin obstacles are never skipped.
    const dist = Math.hypot(this.vx, this.vz) * dt;
    const parts = Math.max(1, Math.ceil(dist / (this.grid.cell / 3)));
    const dx = (this.vx * dt) / parts;
    const dz = (this.vz * dt) / parts;
    for (let i = 0; i < parts; i++) {
      // Try the full move, then slide along whichever axis is free.
      let g = this.standAt(this.x + dx, this.z + dz);
      if (g !== null) {
        this.x += dx;
        this.z += dz;
      } else if ((g = this.standAt(this.x + dx, this.z)) !== null) {
        this.x += dx;
        this.vz = 0;
      } else if ((g = this.standAt(this.x, this.z + dz)) !== null) {
        this.z += dz;
        this.vx = 0;
      } else {
        this.vx = this.vz = 0;
        return;
      }
      if (this.onGround) {
        // Kerbs and steps are simply followed; anything deeper is a drop to fall down.
        if (g < this.y - STEP_UP) this.onGround = false;
        else this.y = g;
      } else if (g > this.y) {
        // Caught the edge of something within a step of the feet: land on it.
        this.y = g;
        this.vy = 0;
        this.onGround = true;
      }
    }
  }

  private moveVertically(jump: boolean, dt: number) {
    if (this.onGround) {
      if (!jump) return;
      this.vy = JUMP_SPEED;
      this.onGround = false;
    }
    this.vy -= GRAVITY * dt;
    this.y += this.vy * dt;
    if (this.vy > 0) return;
    const g = this.grid.ground(this.x, this.z, this.y);
    if (this.y <= g) {
      this.y = g;
      this.vy = 0;
      this.onGround = true;
    }
  }
}
