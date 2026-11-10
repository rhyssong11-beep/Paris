import type { CityData, Place } from './types';
import { RoadGraph } from './roads';
import { Metro, type Leg, type Rider } from './metro';
import { gauss, makeRng, PointGrid, type Rng } from './util';

export const DAY = 86400;
const WALK_SPEED = 1.35; // m/s
const DETOUR = 1.3; // street distance / crow-fly distance, for estimates
const STATION_RADIUS = 1100; // how far people will walk to a station (m)
const TRANSFER_WALK = 60; // s to change platforms
const START_TIME = 5.5 * 3600;

export const enum State {
  Idle,
  Walk,
  Wait,
  Ride,
}
export type Activity = 'home' | 'work' | 'leisure' | 'sight';

interface Visit {
  place: Place;
  activity: Activity;
  /** when to set off for this place */
  leaveAt: number;
}
type Step = { walk: number[] } | { ride: Leg };

export class Agent implements Rider {
  x = 0;
  y = 0;
  state = State.Idle;
  activity: Activity = 'home';
  plan: Visit[] = [];
  planIdx = 0;
  arrivedAt = 0;
  // current trip
  steps: Step[] = [];
  stepIdx = 0;
  dest: Visit | null = null;
  tripStart = 0;
  usedMetro = false;
  // walking
  pts: number[] = [];
  seg = 0;
  segPos = 0;
  // metro
  leg: Leg | null = null;
  readyAt = 0;
  aboard = false;
  station = -1;
  plannedDay = -1;

  constructor(
    readonly id: number,
    readonly tourist: boolean,
    readonly home: Place,
    readonly work: Place | null,
  ) {
    this.x = home.x;
    this.y = home.y;
  }
}

export interface Stats {
  idle: number;
  walking: number;
  waiting: number;
  riding: number;
  atHome: number;
  atWork: number;
  out: number;
  tripsWalk: number;
  tripsMetro: number;
  /** rolling mean door-to-door duration of metro / walking trips, seconds */
  avgMetroTrip: number;
  avgWalkTrip: number;
}

/** Where jobs cluster: [x, y] metres from the centre. */
const JOB_CENTRES: [number, number][] = [
  [-1400, 2000], // Opéra / Saint-Lazare
  [-3200, 1900], // Champs-Élysées / 8e
  [300, 800], // Châtelet / Marais
  [-2000, -1200], // Montparnasse
  [2400, -1300], // Gare de Lyon / Bercy
  [1700, -2500], // Bibliothèque / 13e
  [-4600, 2700], // Porte Maillot
];

export class Simulation {
  readonly roads: RoadGraph;
  readonly metro: Metro<Agent>;
  agents: Agent[] = [];
  time = START_TIME;
  rain = false;
  stats: Stats = {
    idle: 0, walking: 0, waiting: 0, riding: 0, atHome: 0, atWork: 0, out: 0,
    tripsWalk: 0, tripsMetro: 0, avgMetroTrip: 0, avgWalkTrip: 0,
  };
  /** share of the population travelling, sampled every 10 simulated minutes over the last 24 h */
  readonly history = new Float32Array(144);

  private rng: Rng;
  private stationGrid: PointGrid;
  private stationNode: Int32Array;
  private leisure: Place[];
  private sights: Place[];
  private nextSample = 0;

  constructor(
    readonly data: CityData,
    population: number,
    seed = 1,
  ) {
    this.roads = new RoadGraph(data.roads);
    this.metro = new Metro<Agent>(data.metro);
    this.rng = makeRng(seed);
    const st = data.metro.stations;
    this.stationGrid = new PointGrid(st.map((s) => s.x), st.map((s) => s.y), 600);
    // Stations beyond the city limits have no streets in the data set: they can be ridden through but not walked to.
    this.stationNode = Int32Array.from(st, (s) => {
      const n = this.roads.nearestNode(s.x, s.y);
      return n >= 0 && Math.hypot(this.roads.nodeX[n] - s.x, this.roads.nodeY[n] - s.y) < 250 ? n : -1;
    });
    this.sights = data.pois.map((p) => this.placeAt(p.x, p.y));
    this.leisure = [
      ...this.sights,
      ...data.green.slice(0, 40).map((g) => {
        let x = 0;
        let y = 0;
        for (let i = 0; i < g.ring.length; i += 2) {
          x += g.ring[i];
          y += g.ring[i + 1];
        }
        return this.placeAt((x / g.ring.length) * 2, (y / g.ring.length) * 2);
      }),
    ];
    this.setPopulation(population);
  }

  // ------------------------------------------------------------------ population

  setPopulation(n: number) {
    for (const q of this.metro.waiting) q.length = 0;
    this.metro.trains = [];
    this.agents = [];
    for (let i = 0; i < n; i++) {
      const tourist = this.rng() < 0.15;
      const home = tourist ? this.randomPlace([[0, 600]], 4) : this.randomPlace(null, 1);
      const work = tourist || this.rng() < 0.2 ? null : this.randomPlace(JOB_CENTRES, 3);
      this.agents.push(new Agent(i, tourist, home, work));
    }
    this.metro.capacity = Math.max(6, Math.round(n / 120));
    this.stats.tripsMetro = this.stats.tripsWalk = 0;
    this.stats.avgMetroTrip = this.stats.avgWalkTrip = 0;
    this.history.fill(0);
    this.nextSample = this.time;
  }

  private placeAt(x: number, y: number): Place {
    return { x, y, node: this.roads.nearestNode(x, y) };
  }

  /** A random spot on the street network. With `centres`, the best of `tries` draws (closest to a random centre) is kept. */
  private randomPlace(centres: [number, number][] | null, tries: number): Place {
    const { roads, rng } = this;
    const target = centres ? centres[Math.floor(rng() * centres.length)] : null;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < tries; i++) {
      const n = Math.floor(rng() * roads.nodeCount);
      const d = target ? Math.hypot(roads.nodeX[n] - target[0], roads.nodeY[n] - target[1]) : 0;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return { x: roads.nodeX[best] + (rng() - 0.5) * 50, y: roads.nodeY[best] + (rng() - 0.5) * 50, node: best };
  }

  // ------------------------------------------------------------------ daily plans

  private pick<T>(list: T[]): T {
    return list[Math.floor(this.rng() * list.length)];
  }

  private residentDay(a: Agent, base: number): Visit[] {
    const { rng } = this;
    const h = 3600;
    const plan: Visit[] = [];
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    let t: number;
    if (a.work) {
      const out = clamp(gauss(rng, 8.2 * h, 0.8 * h), 5.75 * h, 11 * h);
      plan.push({ place: a.work, activity: 'work', leaveAt: base + out });
      t = clamp(gauss(rng, 17.9 * h, 0.9 * h), out + 6 * h, 21.5 * h);
    } else {
      t = clamp(gauss(rng, 11 * h, 2 * h), 8 * h, 16 * h);
    }
    if (rng() < (a.work ? 0.35 : 0.9)) {
      const place = rng() < 0.5 ? this.pick(this.leisure) : this.randomPlace([[0, 500]], 2);
      plan.push({ place, activity: 'leisure', leaveAt: base + t });
      t += clamp(gauss(rng, 1.6 * h, 0.5 * h), 0.5 * h, 3.5 * h);
    }
    plan.push({ place: a.home, activity: 'home', leaveAt: base + t });
    return plan;
  }

  private touristDay(a: Agent, base: number): Visit[] {
    const { rng } = this;
    const h = 3600;
    const plan: Visit[] = [];
    let t = Math.max(7.5 * h, gauss(rng, 9.7 * h, 0.8 * h));
    const visits = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < visits; i++) {
      plan.push({ place: this.pick(this.sights), activity: 'sight', leaveAt: base + t });
      t += Math.max(0.75 * h, gauss(rng, 1.9 * h, 0.5 * h));
    }
    plan.push({ place: a.home, activity: 'home', leaveAt: base + t });
    if (rng() < 0.4 && t < 19 * h) {
      const out = Math.max(t + 0.75 * h, gauss(rng, 19.8 * h, 0.5 * h));
      plan.push({ place: this.pick(this.leisure), activity: 'leisure', leaveAt: base + out });
      plan.push({ place: a.home, activity: 'home', leaveAt: base + out + Math.max(h, gauss(rng, 2.2 * h, 0.5 * h)) });
    }
    return plan;
  }

  // ------------------------------------------------------------------ trip planning

  private walkPath(fromX: number, fromY: number, fromNode: number, toX: number, toY: number, toNode: number): number[] {
    const mid = fromNode >= 0 && toNode >= 0 ? this.roads.path(fromNode, toNode) : null;
    return mid ? [fromX, fromY, ...mid, toX, toY] : [fromX, fromY, toX, toY];
  }

  private nearStations(x: number, y: number, penalty: number): [number, number][] {
    const st = this.data.metro.stations;
    const out: [number, number][] = [];
    for (const s of this.stationGrid.near(x, y, STATION_RADIUS, 4)) {
      if (this.stationNode[s] < 0) continue;
      out.push([s, ((Math.hypot(st[s].x - x, st[s].y - y) * DETOUR) / WALK_SPEED) * penalty]);
    }
    return out;
  }

  /** Decide how to get from (x, y) to `dest` and load the steps into the agent. */
  private startTrip(a: Agent, dest: Visit, fromStation = -1) {
    const st = this.data.metro.stations;
    const to = dest.place;
    // Walking feels longer than riding, and much longer in the rain.
    const penalty = this.rain ? 2.4 : 1.2;
    const walkCost = ((Math.hypot(to.x - a.x, to.y - a.y) * DETOUR) / WALK_SPEED) * penalty;
    const fromNode = fromStation >= 0 ? this.stationNode[fromStation] : this.roads.nearestNode(a.x, a.y);

    const sources: [number, number][] = fromStation >= 0 ? [[fromStation, 0]] : this.nearStations(a.x, a.y, penalty);
    const targets = this.nearStations(to.x, to.y, penalty);
    const metro = sources.length && targets.length ? this.metro.plan(sources, targets, this.time) : null;

    a.steps = [];
    a.stepIdx = -1;
    a.dest = dest;
    if (fromStation < 0) {
      a.tripStart = this.time;
      a.usedMetro = false;
    }
    if (metro && metro.cost < walkCost) {
      a.usedMetro = true;
      if (metro.first !== fromStation) {
        const s = st[metro.first];
        a.steps.push({ walk: this.walkPath(a.x, a.y, fromNode, s.x, s.y, this.stationNode[metro.first]) });
      }
      for (const leg of metro.legs) a.steps.push({ ride: leg });
      const s = st[metro.last];
      a.steps.push({ walk: this.walkPath(s.x, s.y, this.stationNode[metro.last], to.x, to.y, to.node) });
    } else {
      a.steps.push({ walk: this.walkPath(a.x, a.y, fromNode, to.x, to.y, to.node) });
    }
    this.nextStep(a);
  }

  private nextStep(a: Agent) {
    a.stepIdx++;
    const step = a.steps[a.stepIdx];
    if (!step) {
      // Arrived.
      const dest = a.dest!;
      a.state = State.Idle;
      a.activity = dest.activity;
      a.x = dest.place.x;
      a.y = dest.place.y;
      a.arrivedAt = this.time;
      a.dest = null;
      a.leg = null;
      const dur = this.time - a.tripStart;
      const s = this.stats;
      if (a.usedMetro) {
        s.tripsMetro++;
        s.avgMetroTrip += (dur - s.avgMetroTrip) / Math.min(s.tripsMetro, 500);
      } else {
        s.tripsWalk++;
        s.avgWalkTrip += (dur - s.avgWalkTrip) / Math.min(s.tripsWalk, 500);
      }
      return;
    }
    if ('walk' in step) {
      a.state = State.Walk;
      a.pts = step.walk;
      a.seg = 0;
      a.segPos = 0;
      a.leg = null;
    } else {
      a.state = State.Wait;
      a.leg = step.ride;
      a.station = step.ride.from;
      const s = this.data.metro.stations[a.station];
      a.x = s.x;
      a.y = s.y;
      this.metro.waiting[a.station].push(a);
    }
  }

  /** Called by the metro when an agent leaves a train. */
  private alight = (a: Agent, station: number, forced: boolean) => {
    const s = this.data.metro.stations[station];
    a.x = s.x;
    a.y = s.y;
    a.readyAt = this.time + TRANSFER_WALK;
    if (forced) this.replan(a, station);
    else this.nextStep(a);
  };

  private replan(a: Agent, station: number) {
    a.leg = null;
    if (this.stationNode[station] < 0) {
      // Stranded outside the mapped city: wait for whatever still runs from here.
      const plan = this.metro.plan([[station, 0]], this.nearStations(a.dest!.place.x, a.dest!.place.y, 1.5), this.time);
      if (!plan) {
        // Nothing runs: walk back as the crow flies.
        a.steps = [{ walk: [a.x, a.y, a.dest!.place.x, a.dest!.place.y] }];
        a.stepIdx = -1;
        this.nextStep(a);
        return;
      }
    }
    this.startTrip(a, a.dest!, station);
  }

  // ------------------------------------------------------------------ events

  setLineClosed(line: number, closed: boolean) {
    for (const a of this.metro.setClosed(line, closed)) this.replan(a, a.station);
  }

  // ------------------------------------------------------------------ main loop

  /** Advance the simulation by dt seconds (dt should stay small: a few seconds). */
  step(dt: number) {
    this.time += dt;
    const t = this.time;
    // The planning day rolls over at 03:00, when nearly everyone is home.
    const day = Math.floor((t - 3 * 3600) / DAY);
    this.metro.update(t, dt, this.alight);

    const s = this.stats;
    s.idle = s.walking = s.waiting = s.riding = s.atHome = s.atWork = s.out = 0;
    const walk = WALK_SPEED * dt;
    const serviceRunning = this.metro.headway(t) > 0;
    for (const a of this.agents) {
      switch (a.state) {
        case State.Idle: {
          s.idle++;
          if (a.activity === 'home') s.atHome++;
          else if (a.activity === 'work') s.atWork++;
          else s.out++;
          const next = a.plan[a.planIdx];
          if (!next) {
            if (a.plannedDay < day) {
              a.plannedDay = day;
              a.plan = a.tourist ? this.touristDay(a, day * DAY) : this.residentDay(a, day * DAY);
              a.planIdx = 0;
            }
          } else if (t >= next.leaveAt && t >= a.arrivedAt + 600) {
            a.planIdx++;
            this.startTrip(a, next);
          }
          break;
        }
        case State.Walk: {
          s.walking++;
          let left = walk;
          const p = a.pts;
          for (;;) {
            const i = a.seg * 2;
            if (i + 3 >= p.length) {
              this.nextStep(a);
              break;
            }
            const dx = p[i + 2] - p[i];
            const dy = p[i + 3] - p[i + 1];
            const len = Math.hypot(dx, dy);
            if (a.segPos + left < len) {
              a.segPos += left;
              const f = a.segPos / len;
              a.x = p[i] + dx * f;
              a.y = p[i + 1] + dy * f;
              break;
            }
            left -= len - a.segPos;
            a.seg++;
            a.segPos = 0;
          }
          break;
        }
        case State.Wait:
          if (a.aboard) {
            a.state = State.Ride;
            s.riding++;
            break;
          }
          s.waiting++;
          // Last train gone: give up and walk.
          if (!serviceRunning) {
            const q = this.metro.waiting[a.station];
            q.splice(q.indexOf(a), 1);
            this.replan(a, a.station);
          }
          break;
        case State.Ride:
          s.riding++;
          break;
      }
    }
    for (const tr of this.metro.trains)
      for (const a of tr.riders) {
        a.x = tr.x;
        a.y = tr.y;
      }

    if (t >= this.nextSample) {
      this.nextSample += 600;
      const slot = Math.floor((((t % DAY) + DAY) % DAY) / 600) % 144;
      this.history[slot] = this.agents.length ? (s.walking + s.waiting + s.riding) / this.agents.length : 0;
    }
  }
}
