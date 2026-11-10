import * as THREE from 'three';

/**
 * The setting of the Louvre: the Seine and its quays to the south with three bridges, the arcaded
 * street to the north, the Tuileries garden to the west, and city blocks fading into the haze.
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
  const CELL = 84;
  const walls: THREE.Matrix4[] = [];
  const roofs: THREE.Matrix4[] = [];
  const tints: THREE.Color[] = [];
  const q = new THREE.Quaternion();
  for (let gx = -R_OUT; gx <= R_OUT; gx += CELL) {
    for (let gz = -R_OUT; gz <= R_OUT; gz += CELL) {
      if (Math.hypot(gx, gz) > R_OUT) continue;
      const m = CELL * 0.45;
      if (gx > PALACE.x0 - m && gx < PALACE.x1 + m && gz > PALACE.z0 - m && gz < PALACE.z1 + m) continue;
      if (gx > GARDEN.x0 - m && gx < GARDEN.x1 + m && gz > GARDEN.z0 - m && gz < GARDEN.z1 + m) continue;
      if (gz > RIVER[0] - 30 && gz < RIVER[1] + 46) continue; // river and both quays
      if (rand() < 0.07) continue;
      const height = 18 + rand() * 10;
      const bw = 58 + rand() * 10;
      const bd = 54 + rand() * 12;
      // Three wings around a small courtyard.
      for (const [dx, dz, w, d] of [[0, -bd * 0.32, bw, bd * 0.36], [-bw * 0.34, bd * 0.1, bw * 0.32, bd * 0.52], [bw * 0.34, bd * 0.1, bw * 0.32, bd * 0.52]]) {
        const h = height + (rand() - 0.5) * 2;
        const roofH = 3.4 + rand() * 2;
        walls.push(new THREE.Matrix4().compose(new THREE.Vector3(gx + dx, h / 2, gz + dz), q, new THREE.Vector3(w, h, d)));
        roofs.push(new THREE.Matrix4().compose(new THREE.Vector3(gx + dx, h + roofH / 2, gz + dz), q, new THREE.Vector3(w + 0.5, roofH, d + 0.5)));
        tints.push(new THREE.Color().setHSL(0.09 + rand() * 0.025, 0.12 + rand() * 0.12, 0.75 + rand() * 0.16));
      }
    }
  }
  // Façade texture: rows of tall windows; a second map lights some of them at night.
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
  group.add(wallMesh, roofMesh);

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
      roofMat.color.set(night ? 0x182030 : 0x697985);
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
