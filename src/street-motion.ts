/** Local, metre-scale scene traffic. These paths are a site study, not live road/navigation data. */
export type StreetPoint = readonly [x: number, z: number, y?: number];
export interface Crossing {
  id: string;
  x: number;
  z: number;
  /** Direction in which vehicles travel across the crossing. */
  axis: 'x' | 'z';
  offset: number;
}
export const CROSSINGS: readonly Crossing[] = [
  { id: 'quay', x: 0, z: 170, axis: 'x', offset: 0 },
  { id: 'west', x: -170, z: -145, axis: 'z', offset: 19 },
  { id: 'east', x: 170, z: -145, axis: 'z', offset: 38 },
];

// Ten seconds to start walking, then twenty-four seconds to clear a 24 m crossing.
export const SIGNAL_CYCLE = 72;
export function signalAt(time: number, crossing: Crossing) {
  const phase = ((time + crossing.offset) % SIGNAL_CYCLE + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  return { vehicle: phase < 28 ? 'green' : phase < 31 ? 'amber' : 'red', walk: phase >= 34 && phase < 44, phase } as const;
}

export interface Gate { crossing: Crossing; entry: number; exit: number }
export interface StreetRoute {
  id: string;
  kind: 'car' | 'pedestrian';
  points: readonly StreetPoint[];
  distances: number[];
  length: number;
  gates: Gate[];
}
const mod = (n: number, length: number) => ((n % length) + length) % length;

export function streetRoute(id: string, kind: StreetRoute['kind'], points: readonly StreetPoint[]): StreetRoute {
  const distances = [0];
  const ground = kind === 'car' ? 0.34 : 0.25;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    distances.push(distances[i] + Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] ?? ground) - (a[2] ?? ground)));
  }
  const gates: Gate[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (const crossing of CROSSINGS) {
      const axis = (crossing.axis === 'x') === (kind === 'car') ? 0 : 1;
      const other = axis === 0 ? 1 : 0;
      const centre = axis === 0 ? crossing.x : crossing.z;
      const lateral = other === 0 ? crossing.x : crossing.z;
      const delta = b[axis] - a[axis];
      if (Math.abs(delta) < 1e-6) continue;
      const t = (centre - a[axis]) / delta;
      if (t <= 0 || t >= 1 || Math.abs(a[other] + (b[other] - a[other]) * t - lateral) > (kind === 'car' ? 8 : 4)) continue;
      const segment = distances[i + 1] - distances[i];
      const at = distances[i] + segment * t;
      const half = (kind === 'car' ? 8.4 : 12) * segment / Math.abs(delta);
      gates.push({ crossing, entry: at - half, exit: at + half });
    }
  }
  return { id, kind, points, distances, length: distances.at(-1)!, gates };
}

export function sampleStreet(route: StreetRoute, distance: number) {
  const d = mod(distance, route.length);
  let i = 0;
  while (i + 1 < route.points.length && route.distances[i + 1] <= d) i++;
  const a = route.points[i], b = route.points[(i + 1) % route.points.length];
  const t = (d - route.distances[i]) / (route.distances[i + 1] - route.distances[i]);
  const ground = route.kind === 'car' ? 0.34 : 0.25;
  return {
    x: a[0] + (b[0] - a[0]) * t,
    z: a[1] + (b[1] - a[1]) * t,
    y: (a[2] ?? ground) + ((b[2] ?? ground) - (a[2] ?? ground)) * t,
    heading: Math.atan2(b[0] - a[0], b[1] - a[1]),
  };
}

function vehicleLoop(outer: boolean) {
  const radius = outer ? 22 : 14;
  const points: StreetPoint[] = [];
  const corners = [[-152, 152], [152, 152], [152, -792], [-152, -792]];
  corners.forEach(([x, z], c) => {
    for (let i = 0; i <= 8; i++) {
      const angle = Math.PI - c * Math.PI / 2 - i / 8 * Math.PI / 2;
      points.push([x + Math.cos(angle) * radius, z + Math.sin(angle) * radius]);
    }
  });
  if (outer) points.reverse();
  return streetRoute(outer ? 'outer-lane' : 'inner-lane', 'car', points);
}

const rectangle = (x0: number, z0: number, x1: number, z1: number): StreetPoint[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
export const CAR_ROUTES = [vehicleLoop(false), vehicleLoop(true)];
export const WALK_ROUTES = [
  streetRoute('esplanade', 'pedestrian', rectangle(-27, -72, 27, 72)),
  streetRoute('tower-approach', 'pedestrian', rectangle(-8, -115, 8, 105)),
  streetRoute('champ-de-mars', 'pedestrian', rectangle(-3, -740, 3, -115)),
  streetRoute('park-east', 'pedestrian', rectangle(0, -340, 94, -210)),
  streetRoute('park-west', 'pedestrian', rectangle(-94, -620, 0, -475)),
  streetRoute('east-garden', 'pedestrian', rectangle(72, -80, 155, 75)),
  streetRoute('west-garden', 'pedestrian', rectangle(-155, -80, -72, 75)),
  streetRoute('bridge-promenade', 'pedestrian', [
    [-2, 75], [-2, 158], [-2, 182], [-2, 201, 1.04], [-2, 354, 1.04], [-2, 374], [-2, 410],
    [2, 410], [2, 374], [2, 354, 1.04], [2, 201, 1.04], [2, 182], [2, 158], [2, 75],
  ]),
  ...[-1, 1].map((sign) => streetRoute(sign < 0 ? 'west-crossing' : 'east-crossing', 'pedestrian', [
    [sign * 155, -80], [sign * 155, -143.5], [sign * 158, -143.5], [sign * 182, -143.5],
    [sign * 193, -143.5], [sign * 193, -180], [sign * 196, -180], [sign * 196, -146.5],
    [sign * 182, -146.5], [sign * 158, -146.5], [sign * 155, -146.5],
  ])),
];

export interface StreetActor {
  id: number;
  route: StreetRoute;
  distance: number;
  speed: number;
  desiredSpeed: number;
  length: number;
  travelled: number;
  waiting: boolean;
}

/** Independent of the city simulation; fixed steps keep signals and queues stable across frame rates. */
export class StreetMotion {
  time = 0;
  pedestrians: StreetActor[] = [];
  cars: StreetActor[] = [];
  private remainder = 0;
  private seed = 1847;
  private pedestrianId = 0;
  private carId = 0;

  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  constructor(pedestrians = 160, cars = 32) { this.setDensity(pedestrians, cars); }

  setDensity(pedestrians: number, cars: number) {
    this.pedestrians.length = Math.min(this.pedestrians.length, pedestrians);
    this.cars.length = Math.min(this.cars.length, cars);
    for (const [actors, count, routes, car] of [[this.pedestrians, pedestrians, WALK_ROUTES, false], [this.cars, cars, CAR_ROUTES, true]] as const) {
      while (actors.length < count) {
        const id = car ? this.carId++ : this.pedestrianId++;
        const route = routes[id % routes.length];
        const peers = actors.filter((a) => a.route === route).sort((a, b) => a.distance - b.distance);
        // Spawn in the widest gap, never on top of a vehicle that remained after a quality change.
        let distance = this.random() * route.length;
        if (peers.length) {
          let gap = -1;
          peers.forEach((a, i) => {
            const length = peers.length === 1 ? route.length : mod(peers[(i + 1) % peers.length].distance - a.distance, route.length);
            if (length > gap) { gap = length; distance = mod(a.distance + length / 2, route.length); }
          });
        }
        for (const gate of route.gates) {
          if (distance > gate.entry - 8 && distance < gate.exit + 8) distance = gate.exit + 9;
        }
        actors.push({ id, route, distance, speed: 0, desiredSpeed: car ? 6 + this.random() * 2 : 1.15 + this.random() * 0.55,
          length: car ? 3.8 + this.random() * 1.2 : 0.65, travelled: 0, waiting: false });
      }
    }
  }

  update(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.remainder += Math.min(dt, 0.25);
    while (this.remainder + 1e-9 >= 1 / 30) {
      this.step(1 / 30);
      this.remainder -= 1 / 30;
    }
  }

  private step(dt: number) {
    this.time += dt;
    const occupied = (actors: StreetActor[], crossing: Crossing) => actors.some((actor) => actor.route.gates.some((gate) =>
      gate.crossing === crossing && actor.distance + actor.length / 2 > gate.entry && actor.distance - actor.length / 2 < gate.exit));
    const pedestrianOccupancy = CROSSINGS.map((crossing) => occupied(this.pedestrians, crossing));
    const vehicleOccupancy = CROSSINGS.map((crossing) => occupied(this.cars, crossing));
    for (const [actors, car] of [[this.cars, true], [this.pedestrians, false]] as const) {
      const positions = actors.map((actor) => actor.distance);
      actors.forEach((actor, index) => {
        let room = Infinity;
        actors.forEach((ahead, j) => {
          if (index === j || actor.route !== ahead.route) return;
          const gap = mod(positions[j] - actor.distance, actor.route.length) - (actor.length + ahead.length) / 2 - (car ? 2.2 : 0.45);
          room = Math.min(room, Math.max(0, gap));
        });
        for (const gate of actor.route.gates) {
          // A committed crossing always clears; a newly red signal never freezes someone in the road.
          if (actor.distance + actor.length / 2 > gate.entry && actor.distance < gate.exit + actor.length / 2) continue;
          const signal = signalAt(this.time, gate.crossing);
          const i = CROSSINGS.indexOf(gate.crossing);
          const blocked = car ? signal.vehicle !== 'green' || pedestrianOccupancy[i] : !signal.walk || vehicleOccupancy[i];
          if (blocked) room = Math.min(room, Math.max(0, mod(gate.entry - actor.distance, actor.route.length) - actor.length / 2 - 0.5));
        }
        const desired = Math.min(actor.desiredSpeed, Math.sqrt(Math.max(0, room) * (car ? 4 : 3)));
        actor.speed = Math.min(desired, actor.speed + (car ? 1.8 : 2.5) * dt);
        const advance = Math.min(room, actor.speed * dt);
        actor.waiting = advance < 0.01;
        actor.distance = mod(actor.distance + advance, actor.route.length);
        actor.travelled += advance;
      });
    }
  }
}
