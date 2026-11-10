import { describe, expect, it } from 'vitest';
import { WalkGrid, Walker, STEP_UP } from './walk-world';

/** Two triangles forming a horizontal rectangle at height y (facing up). */
function slab(grid: WalkGrid, x0: number, z0: number, x1: number, z1: number, y: number) {
  grid.addTriangle(x0, y, z0, x0, y, z1, x1, y, z1);
  grid.addTriangle(x0, y, z0, x1, y, z1, x1, y, z0);
}
/** A vertical wall along x at depth z, from y0 to y1. */
function wall(grid: WalkGrid, x0: number, x1: number, z: number, y0: number, y1: number) {
  grid.addTriangle(x0, y0, z, x1, y0, z, x1, y1, z);
  grid.addTriangle(x0, y0, z, x1, y1, z, x0, y1, z);
}
const walk = (w: Walker, input: Partial<{ forward: number; right: number; run: boolean }>, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) w.step({ forward: 0, right: 0, run: false, ...input }, 1 / 60);
};

describe('walking', () => {
  it('moves forward, back and sideways relative to where you look', () => {
    const w = new Walker(new WalkGrid(100));
    w.place(0, 0, 0);
    walk(w, { forward: 1 }, 2);
    expect(w.z).toBeLessThan(-2.5); // yaw 0 looks along -z
    expect(Math.abs(w.x)).toBeLessThan(0.01);
    const z = w.z;
    walk(w, { forward: -1 }, 2);
    expect(w.z).toBeGreaterThan(z + 2.5);
    w.place(0, 0, 0);
    walk(w, { right: 1 }, 2);
    expect(w.x).toBeGreaterThan(2.5);
    w.place(0, 0, Math.PI / 2); // turned left: forward is now -x
    walk(w, { forward: 1 }, 2);
    expect(w.x).toBeLessThan(-2.5);
  });

  it('walks at 4.5 m/s, runs twice as fast, and stops when keys are released', () => {
    const w = new Walker(new WalkGrid(200));
    w.place(0, 0, 0);
    walk(w, { forward: 1 }, 10);
    expect(-w.z).toBeGreaterThan(43);
    expect(-w.z).toBeLessThan(45.5);
    const walked = -w.z;
    w.place(0, 0, 0);
    walk(w, { forward: 1, run: true }, 10);
    expect(-w.z / walked).toBeCloseTo(2, 1);
    // Diagonal movement is not faster than straight.
    w.place(0, 0, 0);
    walk(w, { forward: 1, right: 1 }, 10);
    expect(Math.hypot(w.x, w.z)).toBeLessThan(45.5);
    const before = [w.x, w.z];
    walk(w, {}, 1);
    expect(Math.hypot(w.x - before[0], w.z - before[1])).toBeLessThan(0.6);
  });

  it('limits how far up and down you can look', () => {
    const w = new Walker(new WalkGrid(10));
    w.look(0, 10);
    expect(w.pitch).toBeCloseTo((85 * Math.PI) / 180);
    w.look(0, -20);
    expect(w.pitch).toBeCloseTo((-85 * Math.PI) / 180);
  });

  it('steps up kerbs but not onto tall ledges', () => {
    const grid = new WalkGrid(100);
    slab(grid, -10, -20, 10, -5, 0.4); // kerb ahead
    slab(grid, -10, -40, 10, -20, 0.4 + STEP_UP + 0.5); // tall ledge behind it...
    wall(grid, -10, 10, -20, 0, 0.4 + STEP_UP + 0.5); // ...with its front face
    const w = new Walker(grid);
    w.place(0, 0, 0);
    walk(w, { forward: 1 }, 30);
    expect(w.y).toBeCloseTo(0.4, 1);
    expect(w.z).toBeLessThan(-18);
    expect(w.z).toBeGreaterThan(-20.5); // stopped at the ledge
  });

  it('is stopped by walls and slides along them', () => {
    const grid = new WalkGrid(100);
    wall(grid, -30, 30, -10, 0, 5);
    const w = new Walker(grid);
    w.place(0, 0, 0);
    walk(w, { forward: 1 }, 20);
    expect(w.z).toBeGreaterThan(-10);
    expect(w.z).toBeLessThan(-8);
    // Walking diagonally into the wall slides sideways instead of sticking.
    walk(w, { forward: 1, right: 1 }, 5);
    expect(w.x).toBeGreaterThan(3);
    expect(w.z).toBeGreaterThan(-10);
  });

  it('walks under things overhead and over things underfoot', () => {
    const grid = new WalkGrid(100);
    wall(grid, -30, 30, -10, 2.4, 6); // a beam well above head height
    wall(grid, -30, 30, -20, 0, 0.3); // a low edging
    slab(grid, -30, -32, 30, -8, 9); // a platform high overhead must not become the floor
    const w = new Walker(grid);
    w.place(0, 0, 0);
    walk(w, { forward: 1 }, 20);
    expect(w.z).toBeLessThan(-25);
    expect(w.y).toBe(0);
  });

  it('cannot pass a thin post even when running', () => {
    const grid = new WalkGrid(100);
    grid.addBoxOutline(-0.1, -10.1, 0.1, -9.9, 0, 6);
    const w = new Walker(grid);
    w.place(0, 0, 0);
    walk(w, { forward: 1, run: true }, 5);
    expect(w.z).toBeGreaterThan(-10);
  });

  it('respects areas that are off limits', () => {
    const w = new Walker(new WalkGrid(100), (_x, z) => z > -5);
    w.place(0, 0, 0);
    walk(w, { forward: 1 }, 20);
    expect(w.z).toBeGreaterThan(-5.01);
  });

  it('crosses a raised deck reached by a ramp', () => {
    const grid = new WalkGrid(100);
    // ramp from the ground up to a 1 m deck, then the deck
    grid.addTriangle(-3, 0, 0, -3, 1, -10, 3, 1, -10);
    grid.addTriangle(-3, 0, 0, 3, 1, -10, 3, 0, 0);
    slab(grid, -3, -40, 3, -10, 1);
    const w = new Walker(grid);
    w.place(0, 3, 0);
    walk(w, { forward: 1 }, 6); // long enough to climb the ramp, not to walk off the far end
    expect(w.z).toBeLessThan(-15);
    expect(w.y).toBeCloseTo(1, 1);
  });
});
