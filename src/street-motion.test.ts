import { describe, expect, it } from 'vitest';
import { CAR_ROUTES, CROSSINGS, sampleStreet, SIGNAL_CYCLE, signalAt, StreetMotion, WALK_ROUTES } from './street-motion';

const run = (sim: StreetMotion, seconds: number, dt = 1 / 30) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim.update(dt);
};

describe('local street traffic', () => {
  it('never gives cars and newly crossing pedestrians green together', () => {
    for (let time = 0; time < SIGNAL_CYCLE * 2; time += 0.1) {
      for (const crossing of CROSSINGS) {
        const state = signalAt(time, crossing);
        if (state.walk) expect(state.vehicle).toBe('red');
      }
    }
    expect(signalAt(43.99, CROSSINGS[0]).walk).toBe(true);
    expect(signalAt(44, CROSSINGS[0]).walk).toBe(false);
    expect(signalAt(71.99, CROSSINGS[0]).vehicle).toBe('red');
  });

  it('connects two traffic lanes and all three pedestrian crossings', () => {
    expect(CAR_ROUTES.every((route) => route.gates.length === 3)).toBe(true);
    expect(new Set(WALK_ROUTES.flatMap((route) => route.gates.map((gate) => gate.crossing.id))).size).toBe(3);
    for (const route of [...CAR_ROUTES, ...WALK_ROUTES]) {
      for (const gate of route.gates) {
        expect(gate.entry).toBeGreaterThan(0);
        expect(gate.exit).toBeLessThan(route.length);
      }
    }
  });

  it('stops and queues cars at a red crossing, then releases them', () => {
    const sim = new StreetMotion(0, 2);
    const [car, follower] = sim.cars;
    follower.route = car.route;
    const gate = car.route.gates.find((g) => g.crossing.id === 'quay')!;
    sim.time = 34;
    car.distance = gate.entry - 16;
    follower.distance = car.distance - 14;
    run(sim, 10);
    expect(car.distance + car.length / 2).toBeLessThanOrEqual(gate.entry - 0.49);
    expect(follower.distance + follower.length / 2 + 2).toBeLessThan(car.distance - car.length / 2);
    expect(car.waiting).toBe(true);
    const stopped = car.distance;
    run(sim, 35);
    expect(car.distance).toBeGreaterThan(stopped + 10);
  });

  it('keeps a pedestrian at red, and lets them finish after the start window ends', () => {
    const sim = new StreetMotion(0, 0);
    sim.setDensity(1, 0);
    const person = sim.pedestrians[0];
    person.route = WALK_ROUTES.find((r) => r.id === 'bridge-promenade')!;
    const gate = person.route.gates[0];
    person.distance = gate.entry - 2;
    run(sim, 12);
    expect(person.distance + person.length / 2).toBeLessThan(gate.entry);
    sim.time = 43;
    run(sim, 23);
    expect(person.distance).toBeGreaterThan(gate.exit);
  });

  it('waits for a vehicle already in the crossing before admitting a pedestrian', () => {
    const sim = new StreetMotion(1, 1);
    const person = sim.pedestrians[0], car = sim.cars[0];
    person.route = WALK_ROUTES.find((r) => r.id === 'bridge-promenade')!;
    const walkGate = person.route.gates[0];
    const carGate = car.route.gates.find((g) => g.crossing.id === 'quay')!;
    person.distance = walkGate.entry - person.length / 2 - 0.5;
    car.distance = carGate.entry + 0.5;
    sim.time = 34;
    const start = person.distance;
    run(sim, 1);
    expect(person.distance).toBeCloseTo(start, 6);
    run(sim, 7);
    expect(person.distance).toBeGreaterThan(walkGate.entry);
  });

  it('has the same motion at 30 and 60 rendered frames per second', () => {
    const a = new StreetMotion(20, 6), b = new StreetMotion(20, 6);
    run(a, 20, 1 / 30); run(b, 20, 1 / 60);
    expect(a.time).toBeCloseTo(b.time, 8);
    a.cars.forEach((actor, i) => expect(actor.distance).toBeCloseTo(b.cars[i].distance, 8));
  });

  it('keeps cars separated and out of the esplanade and bridge through density changes', () => {
    const sim = new StreetMotion();
    for (let frame = 0; frame < 30 * 180; frame++) {
      if (frame === 900) sim.setDensity(56, 12);
      if (frame === 1800) sim.setDensity(160, 32);
      sim.update(1 / 30);
      if (frame % 15) continue;
      for (const crossing of CROSSINGS) {
        const occupies = (actor: typeof sim.cars[number]) => actor.route.gates.some((gate) => gate.crossing === crossing && actor.distance + actor.length / 2 > gate.entry && actor.distance - actor.length / 2 < gate.exit);
        expect(sim.cars.some(occupies) && sim.pedestrians.some(occupies)).toBe(false);
      }
      sim.cars.forEach((car) => {
        const pose = sampleStreet(car.route, car.distance);
        expect(Number.isFinite(pose.x + pose.y + pose.z)).toBe(true);
        expect(Math.abs(pose.x) > 150 || pose.z > 150 || pose.z < -790).toBe(true);
        expect(pose.z).toBeLessThan(180);
        for (const ahead of sim.cars) {
          if (ahead === car || ahead.route !== car.route) continue;
          const gap = (ahead.distance - car.distance + car.route.length) % car.route.length;
          expect(gap).toBeGreaterThan((car.length + ahead.length) / 2 + 2);
        }
      });
    }
    expect(sim.cars.every((car) => car.travelled > 100)).toBe(true);
    expect(sim.pedestrians.every((person) => Number.isFinite(person.distance))).toBe(true);
  });
});
