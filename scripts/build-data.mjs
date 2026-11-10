// Turns the raw open-data extracts in data/raw/ into the compact file the app loads:
// public/data/paris.json (see src/types.ts for the shape).
// Usage: node scripts/build-data.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { proj, dist, simplify, ringArea, centroid, inRing, flat, outerRings } from './geo.mjs';

const raw = (name) => JSON.parse(readFileSync(new URL(`../data/raw/${name}.geojson`, import.meta.url))).features;
const clean = (s) => s.replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- arrondissements
const arrondissements = raw('arrondissements')
  .map((f) => {
    const ring = outerRings(f.geometry)[0];
    const [cx, cy] = proj([f.properties.geom_x_y.lon, f.properties.geom_x_y.lat]);
    return { n: f.properties.c_ar, name: f.properties.l_aroff, cx: Math.round(cx), cy: Math.round(cy), ringPts: ring };
  })
  .sort((a, b) => a.n - b.n);
const inParis = (p) => arrondissements.some((a) => inRing(p, a.ringPts));

// ---------------------------------------------------------------- water
const water = raw('water')
  .flatMap((f) => outerRings(f.geometry))
  .filter((r) => ringArea(r) > 400)
  .map((r) => flat(simplify(r, 2)));

// ---------------------------------------------------------------- parks, woods, cemeteries
const GREEN_KINDS = new Set(['Parc', 'Jardin', 'Bois', 'Square', 'Promenade', 'Cimetière', 'Esplanade', 'Pelouse', 'Ile', 'Arboretum']);
const green = [];
for (const f of raw('green')) {
  if (!GREEN_KINDS.has(f.properties.categorie)) continue;
  for (const ring of outerRings(f.geometry)) {
    if (ringArea(ring) < 6000 || !inParis(centroid(ring))) continue;
    green.push({ name: clean(f.properties.nom_ev ?? ''), area: ringArea(ring), ring: flat(simplify(ring, 4)) });
  }
}
green.sort((a, b) => b.area - a.area);

// ---------------------------------------------------------------- streets
const streetInfo = new Map(raw('streets').map((f) => [f.properties.n_sq_vo, f.properties]));
const NOT_WALKABLE = new Set(['PER', 'AUT', 'SOUT', 'ECH']); // ring road, motorways, tunnels, interchanges
const MAJOR = new Set(['BD', 'AV', 'QU', 'CRS', 'PONT']);

const nodeIds = new Map();
const nodes = [];
const nodeId = (p) => {
  const key = `${Math.round(p[0])},${Math.round(p[1])}`;
  let id = nodeIds.get(key);
  if (id === undefined) {
    id = nodes.length;
    nodes.push([Math.round(p[0]), Math.round(p[1])]);
    nodeIds.set(key, id);
  }
  return id;
};
let edges = [];
for (const f of raw('roads')) {
  if (f.geometry?.type !== 'LineString' || f.properties.c_niveau === -1) continue;
  const kind = streetInfo.get(f.properties.n_sq_vo)?.c_desi;
  if (NOT_WALKABLE.has(kind)) continue;
  const pts = simplify(f.geometry.coordinates.map(proj), 1.5);
  const a = nodeId(pts[0]);
  const b = nodeId(pts[pts.length - 1]);
  if (a === b) continue;
  edges.push({ a, b, cls: MAJOR.has(kind) ? 0 : 1, mid: pts.slice(1, -1) });
}
// Keep the largest connected component so every place is reachable on foot.
{
  const parent = nodes.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (const e of edges) parent[find(e.a)] = find(e.b);
  const size = new Map();
  for (const e of edges) size.set(find(e.a), (size.get(find(e.a)) ?? 0) + 1);
  const main = [...size].sort((x, y) => y[1] - x[1])[0][0];
  const before = edges.length;
  edges = edges.filter((e) => find(e.a) === main);
  console.log(`roads: dropped ${before - edges.length} edges outside the main network`);
}
const remap = new Map();
const roadNodes = [];
const keepNode = (i) => {
  let id = remap.get(i);
  if (id === undefined) {
    id = roadNodes.length / 2;
    roadNodes.push(nodes[i][0], nodes[i][1]);
    remap.set(i, id);
  }
  return id;
};
const roadEdges = edges.map((e) => [keepNode(e.a), keepNode(e.b), e.cls, ...flat(e.mid)]);

// ---------------------------------------------------------------- metro
const stationFeatures = raw('metroStations');
const lineFeatures = raw('metroLines');
const stations = [];
const stationByName = new Map();
{
  const groups = new Map();
  for (const f of stationFeatures) {
    const name = clean(f.properties.nom_gares);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(proj(f.geometry.coordinates));
  }
  for (const [name, pts] of groups) {
    const [x, y] = centroid(pts);
    stationByName.set(name, stations.length);
    stations.push({ name, x: Math.round(x), y: Math.round(y) });
  }
}

const refOrder = (r) => parseFloat(r) + (r.endsWith('bis') ? 0.5 : 0);
const refs = [...new Set(lineFeatures.map((f) => f.properties.indice_lig))]
  .filter((ref) => lineFeatures.filter((f) => f.properties.indice_lig === ref).reduce((s, f) => s + f.properties.shape_leng, 0) > 500)
  .sort((a, b) => refOrder(a) - refOrder(b));

function buildLine(ref) {
  const feats = lineFeatures.filter((f) => f.properties.indice_lig === ref);
  const lineStations = stationFeatures
    .filter((f) => f.properties.indice_lig === ref)
    .map((f) => ({ idx: stationByName.get(clean(f.properties.nom_gares)), p: proj(f.geometry.coordinates) }));

  // Graph of track segments: vertices are (clustered) segment end points.
  const V = [];
  const vid = (p) => {
    let i = V.findIndex((v) => dist(v, p) < 40);
    if (i < 0) i = V.push(p) - 1;
    return i;
  };
  const E = feats.map((f) => {
    const pts = simplify(f.geometry.coordinates.map(proj), 1.5);
    return { a: vid(pts[0]), b: vid(pts[pts.length - 1]), pts, len: pts.reduce((s, p, i) => (i ? s + dist(p, pts[i - 1]) : 0), 0) };
  });
  const degree = () => {
    const d = V.map(() => 0);
    for (const e of E) {
      d[e.a]++;
      d[e.b]++;
    }
    return d;
  };
  // Bridge small gaps in the source data (dangling ends that should meet).
  {
    const d = degree();
    const leaves = V.map((_, i) => i).filter((i) => d[i] === 1);
    for (let i = 0; i < leaves.length; i++)
      for (let j = i + 1; j < leaves.length; j++) {
        const gap = dist(V[leaves[i]], V[leaves[j]]);
        if (gap < 400) E.push({ a: leaves[i], b: leaves[j], pts: [V[leaves[i]], V[leaves[j]]], len: gap, bridge: true });
      }
  }
  const vStation = V.map((v) => {
    const best = lineStations.reduce((b, s) => (dist(s.p, v) < dist(b.p, v) ? s : b));
    return dist(best.p, v) < 120 ? best.idx : -1;
  });

  const adj = V.map(() => []);
  E.forEach((e, i) => {
    adj[e.a].push(i);
    adj[e.b].push(i);
  });
  // Dijkstra over the tiny line graph; `penalised` edges cost 4x so the return trip prefers the other side of a loop.
  const shortest = (src, dst, penalised = new Set()) => {
    const d = V.map(() => Infinity);
    const via = V.map(() => -1);
    const done = V.map(() => false);
    d[src] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < V.length; i++) if (!done[i] && d[i] < Infinity && (u < 0 || d[i] < d[u])) u = i;
      if (u < 0 || u === dst) break;
      done[u] = true;
      for (const ei of adj[u]) {
        const e = E[ei];
        const v = e.a === u ? e.b : e.a;
        const c = d[u] + e.len * (penalised.has(ei) ? 4 : 1);
        if (c < d[v]) {
          d[v] = c;
          via[v] = ei;
        }
      }
    }
    if (dst < 0) return { edges: [], dist: d };
    if (d[dst] === Infinity) return null;
    const path = [];
    for (let v = dst; v !== src; ) {
      const e = E[via[v]];
      path.push(via[v]);
      v = e.a === v ? e.b : e.a;
    }
    return { edges: path.reverse(), dist: d };
  };

  const toRoute = (src, edgeIdx) => {
    const path = [];
    const stops = [];
    const at = [];
    let length = 0;
    let u = src;
    let sharpest = 0;
    let prevDir = null;
    const visit = (v) => {
      if (vStation[v] >= 0 && stops[stops.length - 1] !== vStation[v]) {
        stops.push(vStation[v]);
        at.push(Math.round(length));
      }
    };
    visit(u);
    for (const ei of edgeIdx) {
      const e = E[ei];
      const pts = e.a === u ? e.pts : [...e.pts].reverse();
      const far = (from, sign) => {
        // direction over roughly the first / last 80 m of the segment
        let i = from;
        while (i + sign >= 0 && i + sign < pts.length && dist(pts[from], pts[i]) < 80) i += sign;
        return sign > 0 ? [pts[i][0] - pts[from][0], pts[i][1] - pts[from][1]] : [pts[from][0] - pts[i][0], pts[from][1] - pts[i][1]];
      };
      const dirIn = far(0, 1);
      if (prevDir && !e.bridge) {
        const cos = (dirIn[0] * prevDir[0] + dirIn[1] * prevDir[1]) / (Math.hypot(...dirIn) * Math.hypot(...prevDir) || 1);
        sharpest = Math.max(sharpest, (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI);
      }
      if (!e.bridge) prevDir = far(pts.length - 1, -1);
      for (let i = path.length ? 1 : 0; i < pts.length; i++) {
        if (path.length) length += dist(pts[i], path[path.length - 1]);
        path.push(pts[i]);
      }
      u = e.a === u ? e.b : e.a;
      visit(u);
    }
    return { stops, at, path: flat(path), sharpest };
  };

  const d = degree();
  const terminals = V.map((_, i) => i).filter((i) => d[i] === 1 && vStation[i] >= 0);
  if (terminals.length === 1) {
    // Loop line: use the point furthest from the only terminus as the turn-around.
    const { dist: dd } = shortest(terminals[0], -1);
    terminals.push(dd.indexOf(Math.max(...dd.filter((x) => x < Infinity))));
  }
  const routes = [];
  for (let i = 0; i < terminals.length; i++)
    for (let j = i + 1; j < terminals.length; j++) {
      const out = shortest(terminals[i], terminals[j]);
      if (!out) continue;
      const fwd = toRoute(terminals[i], out.edges);
      if (fwd.sharpest > 100) continue; // would reverse at a junction: branch-to-branch, not a real service
      const back = shortest(terminals[j], terminals[i], new Set(out.edges));
      routes.push(fwd, toRoute(terminals[j], back.edges));
    }
  const served = new Set(routes.flatMap((r) => r.stops));
  const missing = lineStations.filter((s) => !served.has(s.idx)).map((s) => stations[s.idx].name);
  console.log(
    `metro ${ref}: ${routes.length} routes, ${served.size}/${new Set(lineStations.map((s) => s.idx)).size} stations` +
      (missing.length ? `, unserved: ${missing.join(', ')}` : '') +
      ` | ${routes.map((r) => `${stations[r.stops[0]].name} → ${stations[r.stops.at(-1)].name} (${r.stops.length})`).join('; ')}`,
  );
  return {
    ref,
    color: `#${feats[0].properties.colourweb_hexa}`,
    routes: routes.map(({ stops, at, path }) => ({ stops, at, path })),
  };
}
const lines = refs.map(buildLine);
// Drop stations no route calls at (e.g. lines not yet open).
{
  const used = new Set(lines.flatMap((l) => l.routes.flatMap((r) => r.stops)));
  const map = new Map();
  const kept = stations.filter((_, i) => used.has(i) && map.set(i, map.size));
  for (const l of lines) for (const r of l.routes) r.stops = r.stops.map((s) => map.get(s));
  stations.length = 0;
  stations.push(...kept);
}

// ---------------------------------------------------------------- landmarks
const pois = [
  ['Tour Eiffel', 2.2945, 48.8584],
  ['Musée du Louvre', 2.3376, 48.8606],
  ['Notre-Dame', 2.3499, 48.853],
  ['Sacré-Cœur', 2.3431, 48.8867],
  ['Arc de Triomphe', 2.295, 48.8738],
  ["Musée d'Orsay", 2.3266, 48.86],
  ['Centre Pompidou', 2.3522, 48.8607],
  ['Panthéon', 2.3461, 48.8462],
  ['Opéra Garnier', 2.3316, 48.872],
  ['Les Invalides', 2.3126, 48.8566],
  ['Jardin du Luxembourg', 2.3372, 48.8462],
  ['Place de la Concorde', 2.3212, 48.8656],
  ['Jardin des Tuileries', 2.3275, 48.8635],
  ['Champs-Élysées', 2.3075, 48.8698],
  ['Tour Montparnasse', 2.322, 48.8421],
  ['Père-Lachaise', 2.3933, 48.8614],
  ['Parc de la Villette', 2.39, 48.8938],
  ['Place de la Bastille', 2.3691, 48.8532],
  ['Place des Vosges', 2.3655, 48.8556],
  ['Buttes-Chaumont', 2.3828, 48.8809],
  ['Jardin des Plantes', 2.3596, 48.844],
  ['Trocadéro', 2.2885, 48.862],
  ['Grand Palais', 2.3125, 48.8661],
  ['Canal Saint-Martin', 2.3655, 48.8722],
  ['Sainte-Chapelle', 2.345, 48.8554],
  ['Moulin Rouge', 2.3322, 48.8841],
].map(([name, lon, lat]) => {
  const [x, y] = proj([lon, lat]);
  return { name, x: Math.round(x), y: Math.round(y) };
});

// ---------------------------------------------------------------- output
const xs = arrondissements.flatMap((a) => a.ringPts.map((p) => p[0]));
const ys = arrondissements.flatMap((a) => a.ringPts.map((p) => p[1]));
const out = {
  attribution: [
    'Arrondissements, voies, voies d’eau, espaces verts © Ville de Paris (opendata.paris.fr), ODbL',
    'Tracés et gares du métro © Île-de-France Mobilités (data.iledefrance-mobilites.fr), Licence Ouverte v2.0',
  ],
  bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round),
  arrondissements: arrondissements.map(({ ringPts, ...a }) => ({ ...a, ring: flat(simplify(ringPts, 4)) })),
  water,
  green: green.map(({ name, ring }) => ({ name, ring })),
  roads: { nodes: roadNodes, edges: roadEdges },
  metro: { stations, lines },
  pois,
};
const dir = new URL('../public/data/', import.meta.url);
mkdirSync(dir, { recursive: true });
const json = JSON.stringify(out);
writeFileSync(new URL('paris.json', dir), json);
console.log(
  `wrote public/data/paris.json: ${(json.length / 1e6).toFixed(2)} MB — ${roadNodes.length / 2} road nodes, ${roadEdges.length} road edges, ` +
    `${stations.length} stations, ${lines.length} lines, ${green.length} green areas, ${water.length} water polygons`,
);
