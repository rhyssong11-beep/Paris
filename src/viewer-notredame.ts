import * as THREE from 'three';

/**
 * The setting of Notre-Dame: the eastern half of the Île de la Cité between the two arms of the Seine,
 * the parvis in front of the west towers, the garden behind the apse, six bridges, the Île Saint-Louis
 * beyond the tip, and city blocks on both banks. Coordinates match the cathedral model: +x east (the
 * apse), +z south, the origin at the middle of the nave. The real axis points a little south of east;
 * here everything is laid out square to it.
 */

/** z range of the two arms of the river */
const SOUTH_ARM: [number, number] = [58, 105];
const NORTH_ARM: [number, number] = [-235, -150];
/** Bridges you can walk across: centre x, width, and the z range of the deck. */
const BRIDGES: { x: number; w: number; z0: number; z1: number; iron?: boolean }[] = [
  { x: -78, w: 18, z0: 50, z1: 112, iron: true }, // Pont au Double, off the parvis
  { x: -190, w: 20, z0: 50, z1: 112 }, // Petit-Pont
  { x: 80, w: 17, z0: 46, z1: 112 }, // Pont de l'Archevêché
  { x: -130, w: 20, z0: -242, z1: -142 }, // Pont d'Arcole
  { x: -250, w: 20, z0: -242, z1: -142 }, // Pont Notre-Dame
];
/** Pont Saint-Louis, the footbridge between the two islands. */
const LINK = { x0: 192, x1: 258, z0: -70, z1: -54 };

function inside(poly: [number, number][], x: number, z: number) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

export function buildNotreDameSurroundings(H: number) {
  const group = new THREE.Group();
  const rand = (() => {
    let a = 11630412;
    return () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
  })();
  const R = H * 6;
  const CITE: [number, number][] = [[-R * 1.1, -150], [60, -150], [150, -112], [205, -52], [192, 4], [140, 44], [60, 58], [-R * 1.1, 58]];
  const SAINT_LOUIS: [number, number][] = [[246, -72], [300, -150], [R * 1.1, -150], [R * 1.1, 46], [330, 46], [256, -8]];
  const onBridge = (x: number, z: number, m = 0) =>
    BRIDGES.some((b) => Math.abs(x - b.x) < b.w / 2 - m && z > b.z0 && z < b.z1) || (x > LINK.x0 && x < LINK.x1 && z > LINK.z0 + m && z < LINK.z1 - m);

  // ---------------------------------------------------------------- materials
  const offset = (factor: number) => ({ polygonOffset: true, polygonOffsetFactor: factor, polygonOffsetUnits: factor * 2 });
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x4f7379, roughness: 0.28, metalness: 0.15, ...offset(-1) });
  const quayMat = new THREE.MeshStandardMaterial({ color: 0xa9a394, roughness: 0.95, ...offset(-2) });
  const parvisMat = new THREE.MeshStandardMaterial({ color: 0xcdc6b6, roughness: 0.95, ...offset(-3) });
  const lawnMat = new THREE.MeshStandardMaterial({ color: 0x6f8151, roughness: 1, ...offset(-3) });
  const pathMat = new THREE.MeshStandardMaterial({ color: 0xbfb294, roughness: 1, ...offset(-2.5) });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xb9b2a2, roughness: 0.9 });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x4d5a52, roughness: 0.6, metalness: 0.5 });
  const flat = (x0: number, z0: number, x1: number, z1: number, y: number, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  const shape = (poly: [number, number][], y: number, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)))), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  const block = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };

  // ---------------------------------------------------------------- river, islands, parvis, garden
  flat(-R * 1.1, NORTH_ARM[0], R * 1.1, SOUTH_ARM[1], 0.02, waterMat);
  shape(CITE, 0.04, quayMat);
  shape(SAINT_LOUIS, 0.04, quayMat);
  flat(-200, -46, -62, 50, 0.06, parvisMat); // the parvis
  flat(-62, -46, 70, -26, 0.06, parvisMat); // rue du Cloître-Notre-Dame
  shape([[66, -42], [150, -100], [196, -50], [184, 2], [138, 38], [66, 50]], 0.06, pathMat); // square Jean-XXIII and the tip of the island
  shape([[72, -30], [146, -84], [182, -46], [172, -2], [132, 28], [72, 40]], 0.08, lawnMat);
  flat(-40, 40, 62, 52, 0.08, lawnMat); // the strip of garden along the south flank
  // Fontaine de la Vierge, behind the apse
  const fountain = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.4, 0.7, 8), stoneMat);
  fountain.position.set(96, 0.35, 0);
  const spirelet = new THREE.Mesh(new THREE.ConeGeometry(1.5, 11, 6), stoneMat);
  spirelet.position.set(96, 6.2, 0);
  fountain.castShadow = spirelet.castShadow = true;
  group.add(fountain, spirelet);

  // ---------------------------------------------------------------- bridges and parapets
  for (const b of BRIDGES) {
    block(b.x - b.w / 2, 0, b.z0, b.x + b.w / 2, 0.22, b.z1, b.iron ? ironMat : stoneMat);
    for (const s of [-1, 1]) block(b.x + s * (b.w / 2) - 0.25, 0, b.z0 + 6, b.x + s * (b.w / 2) + 0.25, 1.15, b.z1 - 6, b.iron ? ironMat : stoneMat);
  }
  block(LINK.x0, 0, LINK.z0, LINK.x1, 0.22, LINK.z1, ironMat);
  for (const z of [LINK.z0, LINK.z1]) block(LINK.x0 + 8, 0, z - 0.2, LINK.x1 - 8, 1.15, z + 0.2, ironMat);
  // Stone parapets along every quay, in short lengths that leave the bridgeheads open.
  const rails: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const edge = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 6));
    q.setFromAxisAngle(yAxis, -Math.atan2(bz - az, bx - ax));
    for (let i = 0; i < n; i++) {
      const x = ax + ((bx - ax) * (i + 0.5)) / n;
      const z = az + ((bz - az) * (i + 0.5)) / n;
      if (Math.hypot(x, z) > R || BRIDGES.some((b) => Math.abs(x - b.x) < b.w / 2 + 3 && z > b.z0 - 4 && z < b.z1 + 4)) continue;
      if (x > LINK.x0 - 4 && x < LINK.x1 + 4 && z > LINK.z0 - 6 && z < LINK.z1 + 6) continue;
      rails.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.55, z), q, new THREE.Vector3(len / n + 0.3, 1.1, 0.5)));
    }
  };
  for (const poly of [CITE, SAINT_LOUIS]) for (let i = 0; i < poly.length; i++) edge(...poly[i], ...poly[(i + 1) % poly.length]);
  edge(-R, SOUTH_ARM[1], R, SOUTH_ARM[1]);
  edge(-R, NORTH_ARM[0], R, NORTH_ARM[0]);
  const railMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), stoneMat, rails.length);
  rails.forEach((m, i) => railMesh.setMatrixAt(i, m));
  railMesh.castShadow = railMesh.receiveShadow = true;
  group.add(railMesh);

  // ---------------------------------------------------------------- buildings
  const walls: THREE.Matrix4[] = [];
  const roofs: THREE.Matrix4[] = [];
  const tints: THREE.Color[] = [];
  const unit = new THREE.Quaternion();
  const house = (x: number, z: number, w: number, d: number, h: number) => {
    const roofH = 3.2 + rand() * 2;
    walls.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h / 2, z), unit, new THREE.Vector3(w, h, d)));
    roofs.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h + roofH / 2, z), unit, new THREE.Vector3(w + 0.5, roofH, d + 0.5)));
    tints.push(new THREE.Color().setHSL(0.09 + rand() * 0.025, 0.12 + rand() * 0.12, 0.75 + rand() * 0.16));
  };
  // Named neighbours on the island: the Hôtel-Dieu north of the parvis, the Préfecture west of it,
  // and the houses of the old cloister quarter north of the cathedral.
  for (let x = -188; x < -80; x += 36) for (const z of [-124, -82]) house(x + 18, z, 33, 36, 21 + rand() * 2);
  for (let z = -40; z < 40; z += 40) house(-262, z + 20, 78, 37, 24);
  for (let x = -56; x < 130; x += 31) {
    const zEdge = x < 44 ? -150 : -150 + (x - 44) * 0.42; // the quay cuts in towards the tip
    for (let z = -62; z > zEdge + 26; z -= 30) house(x + 15, z - 12, 28, 26, 16 + rand() * 6);
  }
  const CELL = 84;
  for (let gx = -R; gx <= R; gx += CELL) {
    for (let gz = -R; gz <= R; gz += CELL) {
      if (Math.hypot(gx, gz) > R || rand() < 0.07) continue;
      const m = CELL * 0.48;
      const bank = gz - m > SOUTH_ARM[1] + 16 || gz + m < NORTH_ARM[0] - 16;
      const farCite = gx + m < -310 && gz - m > -140 && gz + m < 48;
      const stLouis = gx - m > 296 && gz - m > -140 && gz + m < 36;
      if (!bank && !farCite && !stLouis) continue;
      const height = 18 + rand() * 10;
      const bw = 58 + rand() * 10;
      const bd = 54 + rand() * 12;
      for (const [dx, dz, w, d] of [[0, -bd * 0.32, bw, bd * 0.36], [-bw * 0.34, bd * 0.1, bw * 0.32, bd * 0.52], [bw * 0.34, bd * 0.1, bw * 0.32, bd * 0.52]]) {
        house(gx + dx, gz + dz, w, d, height + (rand() - 0.5) * 2);
      }
    }
  }
  const facade = document.createElement('canvas');
  const lit = document.createElement('canvas');
  facade.width = lit.width = facade.height = lit.height = 128;
  const fg = facade.getContext('2d')!;
  const lg = lit.getContext('2d')!;
  fg.fillStyle = '#e6e0d5';
  fg.fillRect(0, 0, 128, 128);
  lg.fillStyle = '#000';
  lg.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 5; row++) {
    const y = 7 + row * 24;
    fg.fillStyle = '#b2a99a';
    fg.fillRect(0, y + 18, 128, 2);
    for (let col = 0; col < 8; col++) {
      const x = 4 + col * 16;
      fg.fillStyle = '#f8f3e8';
      fg.fillRect(x - 1, y - 1, 10, 16);
      fg.fillStyle = '#56616a';
      fg.fillRect(x, y, 8, 14);
      if (rand() < 0.28) {
        lg.fillStyle = '#ffd09a';
        lg.fillRect(x, y, 8, 14);
      }
    }
  }
  const facadeMap = new THREE.CanvasTexture(facade);
  const lightMap = new THREE.CanvasTexture(lit);
  facadeMap.colorSpace = lightMap.colorSpace = THREE.SRGBColorSpace;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf0e9dc, map: facadeMap, emissiveMap: lightMap, roughness: 0.92 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x697985, roughness: 0.72, metalness: 0.12 });
  const wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wallMat, walls.length);
  const roofMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4), roofMat, roofs.length);
  walls.forEach((m, i) => {
    wallMesh.setMatrixAt(i, m);
    wallMesh.setColorAt(i, tints[i]);
    roofMesh.setMatrixAt(i, roofs[i]);
  });
  wallMesh.castShadow = wallMesh.receiveShadow = roofMesh.castShadow = true;
  group.add(wallMesh, roofMesh);

  // ---------------------------------------------------------------- trees
  const trees: [number, number][] = [];
  for (let x = 78; x < 176; x += 13) for (let z = -76; z < 34; z += 13) {
    if (inside([[72, -30], [146, -84], [182, -46], [172, -2], [132, 28], [72, 40]], x, z) && Math.hypot(x - 96, z) > 14 && rand() < 0.7) trees.push([x + rand() * 4, z + rand() * 4]);
  }
  for (let x = -36; x < 60; x += 12) trees.push([x, 46]);
  for (let x = -196; x < -70; x += 14) trees.push([x, -42], [x, 46]); // the rows edging the parvis
  for (let x = -R; x < R; x += 20) trees.push([x, SOUTH_ARM[1] + 12], [x, NORTH_ARM[0] - 12]);
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x455f37, roughness: 1 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d4d42, roughness: 1 });
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), crownMat, trees.length);
  crowns.name = 'Tree_Foliage';
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.6, 7, 5), trunkMat, trees.length);
  trees.forEach(([x, z], i) => {
    const r = 4 + rand() * 1.6;
    crowns.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, 10, z), unit, new THREE.Vector3(r, r * 1.15, r)));
    trunks.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 3.5, z));
  });
  crowns.castShadow = trunks.castShadow = true;
  group.add(crowns, trunks);

  return {
    group,
    /** On foot you stay on the islands, the bridges and the two banks; the parapets stop you before the water does. */
    allowed: (x: number, z: number) =>
      z > SOUTH_ARM[1] + 1 || z < NORTH_ARM[0] - 1 || onBridge(x, z, 0.6) || (z > -149 && z < 57 && inside(CITE, x, z)) || inside(SAINT_LOUIS, x, z),
    setNight(night: boolean) {
      wallMat.color.set(night ? 0x32394a : 0xf0e9dc);
      wallMat.emissive.set(night ? 0xffe0b4 : 0x000000);
      wallMat.emissiveIntensity = night ? 0.3 : 0;
      roofMat.color.set(night ? 0x182030 : 0x697985);
      waterMat.color.set(night ? 0x101e30 : 0x4f7379);
      quayMat.color.set(night ? 0x2c2e36 : 0xa9a394);
      parvisMat.color.set(night ? 0x3b3a3e : 0xcdc6b6);
      lawnMat.color.set(night ? 0x17251f : 0x6f8151);
      pathMat.color.set(night ? 0x33343d : 0xbfb294);
      stoneMat.color.set(night ? 0x373a44 : 0xb9b2a2);
      crownMat.color.set(night ? 0x15221a : 0x455f37);
    },
  };
}

/** Night lighting: warm floods up the west front and towers, along both flanks and round the apse, and on the spire. */
export function buildNotreDameNightLights() {
  const group = new THREE.Group();
  const flood = (x: number, y: number, z: number, tx: number, ty: number, tz: number, intensity: number, reach = 190, angle = 0.8) => {
    const light = new THREE.SpotLight(0xffc98a, intensity, reach, angle, 0.85, 1.6);
    light.position.set(x, y, z);
    light.target.position.set(tx, ty, tz);
    group.add(light, light.target);
  };
  for (const z of [-14, 0, 14]) flood(-92, 1.5, z, -64, 26, z, 300);
  for (const z of [-14, 14]) flood(-100, 1.5, z * 1.6, -60, 58, z, 520, 220, 0.5);
  for (const s of [-1, 1]) {
    for (const x of [-34, -6, 15, 36]) flood(x, 1.5, s * 46, x, 22, s * 8, 210);
    flood(74, 1.5, s * 24, 50, 22, s * 4, 210);
    flood(15, 36, s * 12, 15, 78, 0, 260, 120, 0.42); // the spire, from the roof valleys
  }
  flood(84, 1.5, 0, 56, 22, 0, 210);
  return group;
}

const TEXTURES: Record<string, { file: string; glow?: boolean; tile?: boolean; tint: number }> = {
  Stone: { file: 'ashlar', tile: true, tint: 0xfff6e6 },
  Roof_Lead: { file: 'lead', tile: true, tint: 0xb9c2ca },
  Spire_Lead: { file: 'lead', tile: true, tint: 0xa2acb5 },
  Portal_Tympanum_Stone: { file: 'tympanum', tint: 0xffffff },
  Portal_Door_Wood: { file: 'door', tint: 0xffffff },
  Vitrail_Glow_RoseWest: { file: 'rose-west', glow: true, tint: 0xffffff },
  Vitrail_Glow_RoseNorth: { file: 'rose-north', glow: true, tint: 0xffffff },
  Vitrail_Glow_RoseSouth: { file: 'rose-south', glow: true, tint: 0xffffff },
  Vitrail_Glow_Lancet: { file: 'lancet', glow: true, tint: 0xffffff },
};

/**
 * Dresses the model in its image textures (generated with Higgsfield): limestone courses, lead sheets,
 * the three rose windows, the lancets, the portal tympanum and doors. Each material keeps its plain
 * colour until its picture arrives, and stays that way if it never does. Stained glass also gets its
 * picture as an emissive map, so at night the windows glow with their own colours.
 */
export function applyNotreDameTextures(model: THREE.Object3D, baseUrl: string, anisotropy: number, own: (dispose: () => void) => void) {
  const loader = new THREE.TextureLoader();
  const seen = new Set<THREE.Material>();
  model.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    const spec = mat && !Array.isArray(mat) ? TEXTURES[mat.name] : undefined;
    if (!mat || !spec || seen.has(mat)) return;
    seen.add(mat);
    const texture = loader.load(`${baseUrl}${spec.file}.webp`, () => {
      mat.map = texture;
      mat.color.set(spec.tint);
      if (spec.glow) mat.emissiveMap = texture;
      mat.needsUpdate = true;
    });
    texture.flipY = false; // glTF texture coordinates
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    if (spec.tile) texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
    own(() => texture.dispose());
  });
}
