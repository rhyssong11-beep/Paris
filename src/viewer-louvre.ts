import * as THREE from 'three';

/**
 * The setting of the Louvre: the Seine and its quays to the south with its bridges, the Tuileries garden
 * to the west, and blocks of Haussmann-style buildings round their courtyards fading into the haze.
 * Coordinates match the Louvre model: +x east, +z south, pyramid at the origin.
 */
export function buildLouvreSurroundings(H: number) {
  const group = new THREE.Group();
  const rand = (() => {
    let a = 17930810;
    return () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
  })();
  const R_OUT = H * 6;
  const RIVER: [number, number] = [158, 300]; // z range of the Seine
  const PALACE = { x0: -520, x1: 330, z0: -160, z1: 158 }; // the model's own footprint, kept clear
  const GARDEN = { x0: -1250, x1: PALACE.x0, z0: -165, z1: 150 }; // Jardin des Tuileries

  // ---------------------------------------------------------------- city blocks
  // Each block is a ring of buildings round a courtyard, as in Haussmann's Paris: six or seven storeys of
  // stone, a slate mansard with a zinc top, and chimney walls where one building meets the next.
  const CELL = 84;
  const GROUND_FLOOR = 4.4; // shops and carriage doors
  const STOREY = 3.2;
  const TILE_W = 12; // metres of façade covered by one repeat of the texture: four windows
  const TILE_H = 24;
  const q = new THREE.Quaternion();
  const wall = { pos: [] as number[], uv: [] as number[], col: [] as number[] };
  const roof = { pos: [] as number[], col: [] as number[] };
  type P3 = [number, number, number];
  /** Adds a flat polygon facing `n` (the shadow bias needs outward normals), with a colour and optional UVs. */
  const face = (out: { pos: number[]; col: number[]; uv?: number[] }, pts: P3[], n: P3, c: THREE.Color, uvs?: [number, number][]) => {
    const [a, b, d] = pts;
    const g = [(b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]), (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]), (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])];
    const flip = g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0;
    for (let i = 1; i + 1 < pts.length; i++) {
      for (const k of flip ? [0, i + 1, i] : [0, i, i + 1]) {
        out.pos.push(...pts[k]);
        out.col.push(c.r, c.g, c.b);
        if (out.uv) out.uv.push(...(uvs ? uvs[k] : [0, 0]));
      }
    }
  };
  const SLATE = new THREE.Color(0x4f5a66);
  const ZINC = new THREE.Color(0xa9b4bd);
  const CHIMNEY = new THREE.Color(0xc9b99c);
  const tmp = new THREE.Color();
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: THREE.Color) => {
    face(roof, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1], c);
    face(roof, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], c);
    face(roof, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], c);
    face(roof, [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [1, 0, 0], c);
    face(roof, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0], c);
  };
  /** One building: `alongX` says which way its street front runs. `detail` adds dormers and chimneys. */
  const building = (x0: number, z0: number, x1: number, z1: number, alongX: boolean, detail: number) => {
    const storeys = 4 + Math.floor(rand() * 3);
    const h = GROUND_FLOOR + storeys * STOREY + 0.5;
    const tint = new THREE.Color().setHSL(0.085 + rand() * 0.03, 0.14 + rand() * 0.14, 0.76 + rand() * 0.16);
    const u0 = Math.floor(rand() * 4) / 4;
    const side = (ax: number, az: number, bx: number, bz: number, n: P3) => {
      const len = Math.hypot(bx - ax, bz - az) / TILE_W;
      face(wall, [[ax, 0, az], [bx, 0, bz], [bx, h, bz], [ax, h, az]], n, tint, [[u0, 0], [u0 + len, 0], [u0 + len, h / TILE_H], [u0, h / TILE_H]]);
    };
    side(x0, z0, x1, z0, [0, 0, -1]); side(x0, z1, x1, z1, [0, 0, 1]); side(x0, z0, x0, z1, [-1, 0, 0]); side(x1, z0, x1, z1, [1, 0, 0]);
    // Mansard: steep slate either side, then a shallow zinc top. `at` maps (along, across, height) to the world.
    const len = alongX ? x1 - x0 : z1 - z0, depth = alongX ? z1 - z0 : x1 - x0;
    const at = (s: number, d: number, y: number): P3 => (alongX ? [x0 + s, y, z0 + d] : [x0 + d, y, z0 + s]);
    const dir = (ds: number, dy: number, dd: number): P3 => (alongX ? [ds, dy, dd] : [dd, dy, ds]);
    const rise = 3.1 + rand() * 0.6, inset = 1.5, top = h + rise, crown = top + 0.5;
    const slate = tmp.copy(SLATE).multiplyScalar(0.85 + rand() * 0.3).clone(), zinc = tmp.copy(ZINC).multiplyScalar(0.88 + rand() * 0.2).clone();
    face(roof, [at(0, 0, h), at(len, 0, h), at(len, inset, top), at(0, inset, top)], dir(0, 0.45, -1), slate);
    face(roof, [at(0, depth, h), at(len, depth, h), at(len, depth - inset, top), at(0, depth - inset, top)], dir(0, 0.45, 1), slate);
    face(roof, [at(0, inset, top), at(len, inset, top), at(len, depth / 2, crown), at(0, depth / 2, crown)], [0, 1, 0], zinc);
    face(roof, [at(0, depth - inset, top), at(len, depth - inset, top), at(len, depth / 2, crown), at(0, depth / 2, crown)], [0, 1, 0], zinc);
    for (const s of [0, len]) face(roof, [at(s, 0, h), at(s, inset, top), at(s, depth / 2, crown), at(s, depth - inset, top), at(s, depth, h)], dir(s ? 1 : -1, 0, 0), CHIMNEY);
    if (detail < 1) return;
    // Chimney wall on the party wall at one end, with a row of pots.
    const cs = rand() < 0.5 ? 0.25 : len - 0.85;
    const [ca, cb] = [at(cs, depth * 0.18, 0), at(cs + 0.6, depth * 0.82, 0)];
    box(Math.min(ca[0], cb[0]), top - 0.5, Math.min(ca[2], cb[2]), Math.max(ca[0], cb[0]), crown + 1.5, Math.max(ca[2], cb[2]), CHIMNEY);
    if (detail < 2) return;
    // Dormers along both slopes.
    for (let s = 2.2; s < len - 1.5; s += 3) {
      for (const d of [0.55, depth - 0.55 - 1.3]) {
        const [a, b] = [at(s, d, 0), at(s + 1.1, d + 1.3, 0)];
        box(Math.min(a[0], b[0]), h + 0.5, Math.min(a[2], b[2]), Math.max(a[0], b[0]), h + 2.3, Math.max(a[2], b[2]), zinc);
      }
    }
  };
  for (let gx = -R_OUT; gx <= R_OUT; gx += CELL) {
    for (let gz = -R_OUT; gz <= R_OUT; gz += CELL) {
      const far = Math.hypot(gx, gz);
      if (far > R_OUT) continue;
      const m = CELL * 0.45;
      if (gx > PALACE.x0 - m && gx < PALACE.x1 + m && gz > PALACE.z0 - m && gz < PALACE.z1 + m) continue;
      if (gx > GARDEN.x0 - m && gx < GARDEN.x1 + m && gz > GARDEN.z0 - m && gz < GARDEN.z1 + m) continue;
      if (gz > RIVER[0] - 30 && gz < RIVER[1] + 46) continue; // river and both quays
      if (rand() < 0.05) continue; // a square now and then
      const bw = 60 + rand() * 8, bd = 58 + rand() * 9, deep = 12 + rand() * 2;
      const x0 = gx - bw / 2, x1 = gx + bw / 2, z0 = gz - bd / 2, z1 = gz + bd / 2;
      const detail = far < 750 ? 2 : far < 1350 ? 1 : 0;
      const pieces = detail === 2 ? 3 : detail === 1 ? 2 : 1;
      /** Cuts a side into buildings of uneven widths. */
      const split = (a: number, b: number, n: number) => {
        const cuts = [a];
        for (let i = 1; i < n; i++) cuts.push(a + ((b - a) * (i + (rand() - 0.5) * 0.4)) / n);
        return [...cuts, b];
      };
      const xs = split(x0, x1, pieces), zs = split(z0 + deep, z1 - deep, Math.max(1, pieces - 1));
      for (let i = 0; i + 1 < xs.length; i++) { building(xs[i], z0, xs[i + 1], z0 + deep, true, detail); building(xs[i], z1 - deep, xs[i + 1], z1, true, detail); }
      for (let i = 0; i + 1 < zs.length; i++) { building(x0, zs[i], x0 + deep, zs[i + 1], false, detail); building(x1 - deep, zs[i], x1, zs[i + 1], false, detail); }
    }
  }
  // Façade texture, 12 m wide and 24 m tall: shopfronts, then storeys of tall windows with iron balconies.
  // A second map lights some of the windows at night.
  const facade = document.createElement('canvas');
  const lit = document.createElement('canvas');
  facade.width = lit.width = 512;
  facade.height = lit.height = 1024;
  const fg = facade.getContext('2d')!;
  const lg = lit.getContext('2d')!;
  const PX = facade.width / TILE_W, PY = facade.height / TILE_H;
  /** Rectangle given in metres from the bottom left of the façade. */
  const rect = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, style: string) => { g.fillStyle = style; g.fillRect(x * PX, facade.height - (y + h) * PY, w * PX, h * PY); };
  rect(fg, 0, 0, TILE_W, TILE_H, '#ece5d6');
  rect(lg, 0, 0, TILE_W, TILE_H, '#000');
  for (let i = 0; i < 260; i++) rect(fg, rand() * TILE_W, rand() * TILE_H, 0.3 + rand() * 1.4, 0.2 + rand() * 0.5, `rgba(${rand() < 0.5 ? '120,105,80' : '255,250,235'},0.05)`); // uneven stone
  const BAYS = 4, bay = TILE_W / BAYS;
  const AWNINGS = ['#7a2420', '#23402f', '#2a3050', '#3c3a37', '#8a6a2c', '#5a1f33'];
  for (let i = 0; i < BAYS; i++) {
    const x = i * bay;
    if (i === 2) { // carriage door
      rect(fg, x + 0.55, 0, bay - 1.1, 3.6, '#f4eee0'); rect(fg, x + 0.75, 0, bay - 1.5, 3.4, '#1f3a34'); rect(fg, x + bay / 2 - 0.03, 0, 0.06, 3.4, '#142622');
    } else {
      rect(fg, x + 0.2, 0.25, bay - 0.4, 2.9, '#2c3338'); rect(fg, x + 0.2, 3.15, bay - 0.4, 0.65, AWNINGS[Math.floor(rand() * AWNINGS.length)]);
      rect(fg, x + 0.35, 0.35, bay - 0.7, 1.3, 'rgba(255,240,200,0.16)');
      if (rand() < 0.7) rect(lg, x + 0.2, 0.25, bay - 0.4, 2.9, '#ffdfae');
    }
  }
  rect(fg, 0, GROUND_FLOOR - 0.3, TILE_W, 0.3, '#d5ccb9'); rect(fg, 0, GROUND_FLOOR - 0.38, TILE_W, 0.08, '#a39a88');
  for (let k = 0; k < 7; k++) {
    const y = GROUND_FLOOR + k * STOREY, grand = k === 1 || k === 4; // the second and fifth storeys carry the long balconies
    rect(fg, 0, y + STOREY - 0.16, TILE_W, 0.16, '#d8cfbc'); rect(fg, 0, y + STOREY - 0.22, TILE_W, 0.06, '#a8a08e');
    for (let i = 0; i < BAYS; i++) {
      const x = i * bay + bay / 2, w = 1.15, hgt = grand ? 2.45 : 2.2, sill = 0.35;
      rect(fg, x - w / 2 - 0.14, y + sill - 0.05, w + 0.28, hgt + 0.25, '#f7f2e6'); // surround
      rect(fg, x - w / 2, y + sill, w, hgt, rand() < 0.3 ? '#77828a' : '#4a555f');
      rect(fg, x - w / 2, y + sill + hgt * 0.55, w, hgt * 0.45, 'rgba(170,190,205,0.18)'); // sky in the upper panes
      rect(fg, x - 0.03, y + sill, 0.06, hgt, '#eee9dd'); rect(fg, x - w / 2, y + sill + hgt * 0.62, w, 0.05, '#eee9dd');
      if (!grand) for (let b = 0; b < 7; b++) rect(fg, x - w / 2 - 0.1 + (b * (w + 0.2)) / 6 - 0.02, y + sill, 0.04, 0.85, '#23272a');
      if (!grand) rect(fg, x - w / 2 - 0.12, y + sill + 0.85, w + 0.24, 0.05, '#23272a');
      if (rand() < 0.26) rect(lg, x - w / 2, y + sill, w, hgt, '#ffd09a');
    }
    if (grand) {
      rect(fg, 0, y - 0.1, TILE_W, 0.2, '#bdb4a2'); rect(fg, 0, y + 0.1, TILE_W, 0.05, '#23272a'); rect(fg, 0, y + 1.05, TILE_W, 0.06, '#23272a');
      for (let b = 0; b < 80; b++) rect(fg, (b * TILE_W) / 80, y + 0.1, 0.035, 0.95, '#2a2e31');
    }
  }
  const facadeMap = new THREE.CanvasTexture(facade);
  const lightMap = new THREE.CanvasTexture(lit);
  for (const t of [facadeMap, lightMap]) { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8; }
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf0e9dc, map: facadeMap, emissiveMap: lightMap, roughness: 0.92, vertexColors: true });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.15, vertexColors: true });
  const merged = (src: { pos: number[]; col: number[]; uv?: number[] }, mat: THREE.Material) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(src.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(src.col, 3));
    if (src.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(src.uv, 2));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  };
  group.add(merged(wall, wallMat), merged(roof, roofMat));

  // ---------------------------------------------------------------- ground surfaces
  const offset = (factor: number) => ({ polygonOffset: true, polygonOffsetFactor: factor, polygonOffsetUnits: factor * 2 });
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x557a81, roughness: 0.3, metalness: 0.12, ...offset(-1) });
  const lawnMat = new THREE.MeshStandardMaterial({ color: 0x6f8151, roughness: 1, ...offset(-1) });
  const pathMat = new THREE.MeshStandardMaterial({ color: 0xbfb294, roughness: 1, ...offset(-1.5) });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xb4ad9d, roughness: 0.9 });
  const flat = (x0: number, z0: number, x1: number, z1: number, y: number, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  const block = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  // The Seine sits below street level between stone quay walls.
  flat(-R_OUT * 1.1, RIVER[0], R_OUT * 1.1, RIVER[1], 0.02, waterMat);
  block(-R_OUT * 1.1, 0, RIVER[0] - 3, R_OUT * 1.1, 1.3, RIVER[0], stoneMat); // parapet, north bank
  block(-R_OUT * 1.1, 0, RIVER[1], R_OUT * 1.1, 1.3, RIVER[1] + 3, stoneMat);
  // Bridges: Pont Royal, Pont du Carrousel, Pont des Arts (an iron footbridge), Pont Neuf further east.
  for (const [x, w, iron] of [[-470, 17, false], [-262, 33, false], [150, 11, true], [520, 22, false]] as const) {
    block(x - w / 2, 0.6, RIVER[0] - 3, x + w / 2, 1.5, RIVER[1] + 3, iron ? new THREE.MeshStandardMaterial({ color: 0x4d5a52, roughness: 0.6, metalness: 0.5 }) : stoneMat);
    const piers = iron ? 6 : 3;
    for (let i = 1; i <= piers; i++) {
      const z = RIVER[0] + ((RIVER[1] - RIVER[0]) * i) / (piers + 1);
      block(x - w / 2 - 1, 0, z - (iron ? 0.8 : 3), x + w / 2 + 1, 0.6, z + (iron ? 0.8 : 3), stoneMat);
    }
  }

  // Jardin des Tuileries: gravel, two ranks of lawns either side of the central walk, a round basin.
  flat(GARDEN.x0, GARDEN.z0, GARDEN.x1, GARDEN.z1, 0.03, pathMat);
  for (const s of [-1, 1]) {
    for (let x = GARDEN.x1 - 150; x > GARDEN.x0 + 40; x -= 96) {
      flat(x - 78, Math.min(s * 16, s * 78), x, Math.max(s * 16, s * 78), 0.06, lawnMat);
      flat(x - 78, Math.min(s * 92, s * 142), x, Math.max(s * 92, s * 142), 0.06, lawnMat);
    }
  }
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 0.5, 40), stoneMat);
  basin.position.set(GARDEN.x1 - 75, 0.25, 0);
  const pool = new THREE.Mesh(new THREE.CylinderGeometry(28.5, 28.5, 0.52, 40), waterMat);
  pool.position.copy(basin.position);
  group.add(basin, pool);

  // Trees: clipped ranks in the Tuileries, and a line along the far quay.
  const trees: [number, number][] = [];
  for (let x = GARDEN.x1 - 160; x > GARDEN.x0 + 30; x -= 15) for (const z of [-150, -134, -86, 86, 134]) trees.push([x, z + (rand() - 0.5) * 2]);
  for (let x = -R_OUT; x < R_OUT; x += 22) trees.push([x, RIVER[1] + 14]);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x455f37, roughness: 1 }), trees.length);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.6, 7, 5), new THREE.MeshStandardMaterial({ color: 0x5d4d42, roughness: 1 }), trees.length);
  trees.forEach(([x, z], i) => {
    const r = 4 + rand() * 1.6;
    crowns.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, 10, z), q, new THREE.Vector3(r, r * 1.15, r)));
    trunks.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 3.5, z));
  });
  group.add(crowns, trunks);

  return {
    group,
    /** On foot the river is out of bounds; the parapet stops you before the water does. */
    allowed: (_x: number, z: number) => z < RIVER[0] - 3.5,
    setNight(night: boolean) {
      wallMat.color.set(night ? 0x32394a : 0xf0e9dc);
      wallMat.emissive.set(night ? 0xffe0b4 : 0x000000);
      wallMat.emissiveIntensity = night ? 0.3 : 0;
      roofMat.color.set(night ? 0x2a3040 : 0xffffff);
      waterMat.color.set(night ? 0x101e30 : 0x557a81);
      lawnMat.color.set(night ? 0x17251f : 0x6f8151);
      pathMat.color.set(night ? 0x33343d : 0xbfb294);
      stoneMat.color.set(night ? 0x373a44 : 0xb4ad9d);
    },
  };
}

/** Night lighting of the palace: warm floods washing up the courtyard façades, and the pyramid lit from within. */
export function buildLouvreNightLights() {
  const group = new THREE.Group();
  const flood = (x: number, z: number, tx: number, tz: number, intensity = 650) => {
    const light = new THREE.SpotLight(0xffc98a, intensity, 150, 0.95, 0.8, 1.6);
    light.position.set(x, 1.2, z);
    light.target.position.set(tx, 20, tz);
    group.add(light, light.target);
  };
  for (const x of [-95, -40, 15, 70]) {
    flood(x, -44, x, -64);
    flood(x, 44, x, 64);
  }
  flood(92, -20, 114, -20);
  flood(92, 20, 114, 20);
  flood(-275, 0, -262, 0, 220); // Carrousel arch, from the west...
  flood(-249, 0, -262, 0, 220); // ...and the east
  const hall = new THREE.PointLight(0xffe2b0, 260, 70, 1.7); // the hall under the pyramid
  hall.position.set(0, 5, 0);
  group.add(hall);
  return group;
}

/** Texture file under models/louvre/ for each palace material; the model's UVs are in tiles of a few metres. */
const TEXTURES: Record<string, string> = {
  Louvre_Stone: 'stone', Louvre_Stone_Trim: 'trim', Louvre_Sculpture: 'trim', Louvre_Roof_Slate: 'slate', Louvre_Roof_Lead: 'lead',
};

/** Puts the masonry, slate and lead textures on the palace. Until one loads its material keeps its plain colour. */
export function applyLouvreTextures(model: THREE.Object3D, baseUrl: string, anisotropy: number, own: (dispose: () => void) => void) {
  const loader = new THREE.TextureLoader();
  const loaded = new Map<string, THREE.Texture>();
  const seen = new Set<THREE.Material>();
  model.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    const file = mat && !Array.isArray(mat) ? TEXTURES[mat.name] : undefined;
    if (!mat || !file || seen.has(mat)) return;
    seen.add(mat);
    let texture = loaded.get(file);
    if (!texture) {
      texture = loader.load(`${baseUrl}${file}.png`);
      texture.flipY = false; // glTF texture coordinates
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = anisotropy;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      loaded.set(file, texture);
      own(() => loaded.get(file)!.dispose());
    }
    mat.map = texture;
    mat.needsUpdate = true;
  });
}
