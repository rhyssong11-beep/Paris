import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CityData } from './types';
import { Simulation, State, DAY } from './sim';
import { landmarkModel } from './landmarks';

let data: CityData;
beforeAll(() => {
  data = JSON.parse(readFileSync(new URL('../public/data/paris.json', import.meta.url), 'utf8'));
});

const station = (sim: Simulation, name: string) => sim.metro.stations.findIndex((s) => s.name === name);
const run = (sim: Simulation, until: number, dt = 5) => {
  while (sim.time < until) sim.step(dt);
};

describe('road graph', () => {
  it('finds a continuous path across the city', () => {
    const sim = new Simulation(data, 0);
    const a = sim.roads.nearestNode(-4300, 600); // Tour Eiffel side
    const b = sim.roads.nearestNode(3200, 900); // Père-Lachaise side
    const path = sim.roads.path(a, b)!;
    expect(path).not.toBeNull();
    let len = 0;
    let maxJump = 0;
    for (let i = 2; i < path.length; i += 2) {
      const d = Math.hypot(path[i] - path[i - 2], path[i + 1] - path[i - 1]);
      len += d;
      maxJump = Math.max(maxJump, d);
    }
    expect(len).toBeGreaterThan(7500);
    expect(len).toBeLessThan(7500 * 1.6);
    expect(maxJump).toBeLessThan(700);
  });
});

describe('metro planner', () => {
  it('rides line 1 directly from Bastille to Concorde', () => {
    const sim = new Simulation(data, 0);
    const plan = sim.metro.plan([[station(sim, 'Bastille'), 0]], [[station(sim, 'Concorde'), 0]], 9 * 3600)!;
    expect(plan.legs).toHaveLength(1);
    expect(sim.metro.lines[plan.legs[0].line].ref).toBe('1');
    expect(plan.cost).toBeGreaterThan(5 * 60);
    expect(plan.cost).toBeLessThan(20 * 60);
  });
  it('changes trains when it has to, and avoids closed lines', () => {
    const sim = new Simulation(data, 0);
    const from = station(sim, 'Bastille');
    const to = station(sim, 'Abbesses'); // line 12 only
    const plan = sim.metro.plan([[from, 0]], [[to, 0]], 9 * 3600)!;
    expect(plan.legs.length).toBeGreaterThanOrEqual(2);
    expect(sim.metro.lines[plan.legs.at(-1)!.line].ref).toBe('12');
    for (let i = 1; i < plan.legs.length; i++) expect(plan.legs[i].from).toBe(plan.legs[i - 1].to);
    sim.setLineClosed(sim.metro.lines.findIndex((l) => l.ref === '12'), true);
    expect(sim.metro.plan([[from, 0]], [[to, 0]], 9 * 3600)).toBeNull();
  });
  it('does not run at night', () => {
    const sim = new Simulation(data, 0);
    expect(sim.metro.plan([[station(sim, 'Bastille'), 0]], [[station(sim, 'Concorde'), 0]], 3 * 3600)).toBeNull();
  });
});

describe('a simulated day', () => {
  it('moves people around and brings them home', () => {
    const sim = new Simulation(data, 800, 7);
    const n = sim.agents.length;
    run(sim, 8.5 * 3600);
    const rush = sim.stats.walking + sim.stats.waiting + sim.stats.riding;
    expect(rush).toBeGreaterThan(n * 0.08);
    expect(sim.metro.trains.length).toBeGreaterThan(100);
    run(sim, 13 * 3600);
    expect(sim.stats.atWork).toBeGreaterThan(n * 0.4);
    // Everyone is accounted for in exactly one state.
    const s = sim.stats;
    expect(s.idle + s.walking + s.waiting + s.riding).toBe(n);
    run(sim, DAY + 2.9 * 3600);
    expect(sim.stats.atHome).toBeGreaterThan(n * 0.97);
    expect(sim.stats.tripsMetro).toBeGreaterThan(n * 0.5);
    expect(sim.stats.tripsWalk).toBeGreaterThan(n * 0.1);
    // Typical door-to-door times are plausible.
    expect(sim.stats.avgMetroTrip).toBeGreaterThan(10 * 60);
    expect(sim.stats.avgMetroTrip).toBeLessThan(60 * 60);
    // No rider is left on a platform or train after the last service.
    expect(sim.metro.waiting.every((q) => q.length === 0)).toBe(true);
    expect(sim.agents.every((a) => a.state !== State.Ride && a.state !== State.Wait)).toBe(true);
    // And the next morning starts again.
    run(sim, DAY + 8.5 * 3600);
    expect(sim.stats.walking + sim.stats.waiting + sim.stats.riding).toBeGreaterThan(n * 0.08);
  }, 120000);

  it('strands nobody when a line closes mid-rush', () => {
    const sim = new Simulation(data, 600, 3);
    run(sim, 8.4 * 3600);
    for (const ref of ['1', '4', '13']) sim.setLineClosed(sim.metro.lines.findIndex((l) => l.ref === ref), true);
    run(sim, 8.4 * 3600 + 300);
    expect(sim.metro.trains.every((t) => !sim.metro.lines[t.route.line].closed)).toBe(true);
    run(sim, DAY + 2.9 * 3600);
    expect(sim.stats.atHome).toBeGreaterThan(sim.agents.length * 0.97);
  }, 120000);
});

describe('3D landmarks', () => {
  it('builds detailed 3D models for all 26 Paris landmarks', () => {
    expect(data.pois.length).toBe(26);
    for (const poi of data.pois) {
      const m = landmarkModel(poi.name);
      expect(m, `missing 3D model for ${poi.name}`).not.toBeNull();
      expect(m!.faces.length).toBeGreaterThan(30);
      expect(m!.height).toBeGreaterThan(10);
      expect(m!.radius).toBeGreaterThan(15);
    }
  });
});
